import { useEffect, useState } from 'react'
import {
  AudioLines,
  CircleAlert,
  CircleStop,
  FileVideo,
  RotateCw,
  WifiOff,
} from 'lucide-react'
import type {
  BackendFile,
  BackendFileStatus,
  BackendJobPhase,
  BackendStatusResponse,
} from '../types'
import {
  fileErrorMessage,
  jobErrorMessage,
} from '../lib/transcriptionMessages'
import { DriveProcessingIcon } from './DriveProcessingIcon'

interface ProcessingViewProps {
  status: BackendStatusResponse
  submitError: string | null
  pollError: string | null
  recoveryNotice: string | null
  isFailed: boolean
  isSubmitting: boolean
  isLoadingFiles: boolean
  isCancelling: boolean
  cancelError: string | null
  canRetryJob: boolean
  onRetryStatus: () => void
  onRetryJob: () => void
  onCancel: () => void
  onChangeFolder: () => void
}

const phaseCopy: Record<BackendJobPhase | 'idle', string> = {
  idle: 'Starting',
  queued: 'Queued',
  listing: 'Finding Media',
  downloading: 'Downloading Files',
  extracting: 'Preparing Audio',
  transcribing: 'Creating Transcripts',
  writing: 'Saving Transcripts',
  waiting_resources: 'Creating Transcripts',
  ready: 'Preparing Your Files',
  failed: 'Transcription Stopped',
  cancelled: 'Transcription Cancelled',
  abandoned: 'Transcription Interrupted',
}

const fileStatusCopy: Record<BackendFileStatus, string> = {
  pending: 'Queued',
  downloading: 'Downloading',
  extracting: 'Preparing Audio',
  transcribing: 'Transcribing',
  writing: 'Saving',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const activeFileStatuses = new Set<BackendFileStatus>([
  'downloading',
  'extracting',
  'transcribing',
  'writing',
])

const stoppedStatuses = new Set<BackendStatusResponse['status']>([
  'failed',
  'cancelled',
  'abandoned',
])

function clampProgress(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
}

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, value)
  let unit = 0

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }

  const precision = unit === 0 || size >= 100 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unit]}`
}

function formatDuration(value: number) {
  const seconds = Math.max(1, Math.round(value))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function downloadDetails(file: BackendFile, now: number) {
  const total = file.expected_size !== null && file.expected_size > 0
    ? file.expected_size
    : null
  const downloaded = total
    ? Math.min(file.downloaded_bytes, total)
    : file.downloaded_bytes
  const startedAt = file.download_started_at
  const finishedAt = file.download_finished_at
  const elapsed = startedAt !== null
    ? Math.max(0, (finishedAt ?? now) - startedAt)
    : null
  const bytesForSpeed = finishedAt && total ? total : downloaded
  const speed = elapsed && elapsed > 0 ? bytesForSpeed / elapsed : null
  const progress = total ? clampProgress((downloaded / total) * 100) : null
  const summary: string[] = []

  if (total) {
    summary.push(
      file.status === 'downloading'
        ? `${formatBytes(downloaded)} of ${formatBytes(total)}`
        : formatBytes(total),
    )
  } else if (downloaded > 0) {
    summary.push(formatBytes(downloaded))
  }

  if (elapsed !== null && elapsed > 0) {
    summary.push(
      finishedAt
        ? `Downloaded in ${formatDuration(elapsed)}`
        : `${formatDuration(elapsed)} Elapsed`,
    )
  }
  if (speed !== null && speed > 0) summary.push(`${formatBytes(speed)}/s`)

  return { progress, summary: summary.join(' · ') }
}

function overallProgress(status: BackendStatusResponse) {
  const reported = clampProgress(status.progress)
  if (status.files.length === 0) return reported

  const fileAverage =
    status.files.reduce((total, file) => total + clampProgress(file.progress), 0) /
    status.files.length

  return Math.max(reported, fileAverage)
}

function stoppedCopy(status: BackendStatusResponse['status']) {
  if (status === 'cancelled') {
    return {
      title: 'Transcription Cancelled',
      description: 'This job was cancelled before it finished.',
    }
  }

  if (status === 'abandoned') {
    return {
      title: 'Transcription Interrupted',
      description: 'The server stopped while this job was active.',
    }
  }

  return {
    title: 'Transcription Stopped',
    description: 'Review the details below, then try again.',
  }
}

function fileStatusLabel(status: BackendFileStatus, stopped: boolean) {
  return stopped && activeFileStatuses.has(status)
    ? 'Interrupted'
    : fileStatusCopy[status]
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)

    mediaQuery.addEventListener('change', updatePreference)
    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  return prefersReducedMotion
}

export function ProcessingView({
  status,
  submitError,
  pollError,
  recoveryNotice,
  isFailed,
  isSubmitting,
  isLoadingFiles,
  isCancelling,
  cancelError,
  canRetryJob,
  onRetryStatus,
  onRetryJob,
  onCancel,
  onChangeFolder,
}: ProcessingViewProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [now, setNow] = useState(() => Date.now() / 1000)
  const stopped = isFailed || stoppedStatuses.has(status.status)
  const isDownloading = !stopped && status.files.some(
    (file) =>
      file.status === 'downloading' && file.download_started_at !== null,
  )

  useEffect(() => {
    if (!isDownloading) return

    setNow(Date.now() / 1000)
    const interval = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(interval)
  }, [isDownloading])

  const progress = overallProgress(status)
  const timelineNow =
    stopped && 'job_id' in status
      ? status.finished_at ?? status.updated_at
      : now
  const heading = stoppedCopy(status.status)
  const title = isLoadingFiles
    ? 'Preparing Your Files'
    : phaseCopy[status.phase]
  const readyCount = status.files.filter((file) => file.status === 'completed').length
  const failedCount = status.files.filter((file) => file.status === 'failed').length
  const activeFiles = status.files.filter((file) => activeFileStatuses.has(file.status))
  const currentLabel =
    activeFiles.length > 0
      ? activeFiles.length === 1
        ? 'Current file'
        : 'Current files'
      : 'Current step'

  return (
    <main className="processing-page">
      <section className="processing-stage" aria-labelledby="processing-title">
        <div className="processing-heading">
          <span
            className="processing-heading__icon"
            data-state={stopped ? 'failed' : 'active'}
            aria-hidden="true"
          >
            {stopped ? (
              <CircleAlert />
            ) : prefersReducedMotion || pollError ? (
              <AudioLines />
            ) : (
              <DriveProcessingIcon />
            )}
          </span>
          <div>
            <h1 id="processing-title">{stopped ? heading.title : 'Working on It'}</h1>
            <p>
              {stopped
                ? heading.description
                : 'Large folders can take a while. You can leave this tab open.'}
            </p>
          </div>
        </div>

        <div className="progress-panel">
          <div className="progress-panel__top">
            <div className="progress-panel__summary" aria-live="polite">
              <span className="progress-label">{title}</span>
              {status.files.length > 0 && (
                <span className="progress-ready">
                  {readyCount} of {status.files.length} Ready
                  {failedCount > 0 && `, ${failedCount} Failed`}
                </span>
              )}
            </div>
            <div className="progress-panel__actions">
              <strong>{Math.round(progress)}%</strong>
              {status.status === 'active' && !stopped && (
                <button
                  className="cancel-button"
                  type="button"
                  onClick={onCancel}
                  disabled={isCancelling || status.cancel_requested}
                >
                  {isCancelling ? (
                    <RotateCw className="spin" aria-hidden="true" />
                  ) : (
                    <CircleStop aria-hidden="true" />
                  )}
                  <span>
                    {isCancelling || status.cancel_requested
                      ? 'Cancelling'
                      : 'Cancel'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {cancelError && (
            <p className="cancel-error" role="alert">
              {cancelError}
            </p>
          )}

          <div
            className="progress-track"
            role="progressbar"
            aria-label="Transcription progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ transform: `scaleX(${progress / 100})` }} />
          </div>

          <div className="active-files">
            <span className="active-files__icon" aria-hidden="true">
              <FileVideo />
            </span>
            <div className="active-files__body">
              <span className="active-files__label">{currentLabel}</span>
              {activeFiles.length > 0 ? (
                <ul className="active-files__list">
                  {activeFiles.map((file) => (
                    <li key={file.id}>
                      <strong title={file.name}>{file.name}</strong>
                      <span>{fileStatusLabel(file.status, stopped)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <strong>
                  {status.current_file ??
                    (isLoadingFiles ? 'Building File List' : title)}
                </strong>
              )}
            </div>
          </div>

          {pollError && (
            <div className="status-error" role="alert">
              <WifiOff aria-hidden="true" />
              <div>
                <strong>Progress Paused</strong>
                <p>{pollError}</p>
              </div>
              <button type="button" onClick={onRetryStatus}>
                <RotateCw aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {recoveryNotice && (
            <div className="job-message" data-state="info" role="status">
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>Active Job Found</strong>
                <p>{recoveryNotice}</p>
              </div>
            </div>
          )}

          {status.error && (
            <div
              className="job-message"
              data-state={status.status === 'completed' ? 'summary' : 'error'}
              role={status.status === 'completed' ? 'status' : 'alert'}
            >
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>
                  {status.status === 'completed'
                    ? 'Completed With Issues'
                    : 'Job Details'}
                </strong>
                <p>{jobErrorMessage(status.error)}</p>
              </div>
            </div>
          )}

          <section className="processing-files" aria-labelledby="file-progress-title">
            <div className="processing-files__header">
              <div>
                <h2 id="file-progress-title">File Progress</h2>
                <p>
                  {status.files.length === 0
                    ? 'Files will appear after the folder is checked.'
                    : `${status.files.length} ${
                        status.files.length === 1 ? 'File' : 'Files'
                      }`}
                </p>
              </div>
            </div>

            {status.files.length > 0 ? (
              <ul
                className="processing-file-list"
                aria-label="Transcription files"
                tabIndex={0}
              >
                {status.files.map((file) => {
                  const fileProgress = clampProgress(file.progress)
                  const download = downloadDetails(file, timelineNow)

                  return (
                    <li className="processing-file" data-status={file.status} key={file.id}>
                      <span className="processing-file__icon" aria-hidden="true">
                        <FileVideo />
                      </span>
                      <div className="processing-file__content">
                        <div className="processing-file__title">
                          <strong title={file.name}>{file.name}</strong>
                          <span
                            className="processing-file__status"
                            data-status={file.status}
                          >
                            {fileStatusLabel(file.status, stopped)}
                          </span>
                        </div>
                        <div className="processing-file__meter">
                          <div
                            className="processing-file__track"
                            role="progressbar"
                            aria-label={`${file.name} progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(fileProgress)}
                          >
                            <span style={{ transform: `scaleX(${fileProgress / 100})` }} />
                          </div>
                          <span>{Math.round(fileProgress)}%</span>
                        </div>
                        {download.summary && (
                          <div className="processing-file__download">
                            <span>{download.summary}</span>
                            {file.status === 'downloading' && download.progress !== null && (
                              <div
                                className="processing-file__download-track"
                                role="progressbar"
                                aria-label={`${file.name} download progress`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(download.progress)}
                              >
                                <span
                                  style={{
                                    transform: `scaleX(${download.progress / 100})`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {file.error && (
                          <p className="processing-file__error">
                            {fileErrorMessage(file.error)}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="processing-files__empty">
                <FileVideo aria-hidden="true" />
                <div>
                  <strong>{stopped ? 'No Files Processed' : 'Finding Files'}</strong>
                  <p>
                    {stopped
                      ? 'No supported media could be prepared.'
                      : 'This can take a moment for larger folders.'}
                  </p>
                </div>
              </div>
            )}
          </section>

          {stopped && (
            <>
              {submitError && (
                <p className="cancel-error" role="alert">
                  {submitError}
                </p>
              )}
              <div className="failed-action">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onRetryJob}
                  disabled={isSubmitting || !canRetryJob}
                >
                  <RotateCw className={isSubmitting ? 'spin' : undefined} aria-hidden="true" />
                  {isSubmitting ? 'Starting' : 'Try Again'}
                </button>
                <button className="text-button" type="button" onClick={onChangeFolder}>
                  Change Folder
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
