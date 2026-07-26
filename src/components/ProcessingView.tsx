import { useEffect, useState } from 'react'
import {
  AudioLines,
  CircleAlert,
  FileVideo,
  RotateCw,
  WifiOff,
} from 'lucide-react'
import type {
  BackendFileStatus,
  BackendJobPhase,
  BackendStatusResponse,
} from '../types'
import {
  fileErrorMessage,
  jobErrorMessage,
} from '../lib/transcriptionMessages'
import { Brand } from './Brand'
import { DriveProcessingIcon } from './DriveProcessingIcon'

interface ProcessingViewProps {
  status: BackendStatusResponse
  pollError: string | null
  recoveryNotice: string | null
  isFailed: boolean
  isSubmitting: boolean
  isLoadingFiles: boolean
  onRetryStatus: () => void
  onRetryJob: () => void
  onChangeFolder: () => void
}

const phaseCopy: Record<BackendJobPhase | 'idle', string> = {
  idle: 'Starting',
  queued: 'Queued',
  listing: 'Finding media',
  downloading: 'Downloading files',
  extracting: 'Preparing audio',
  transcribing: 'Creating transcripts',
  writing: 'Saving transcripts',
  waiting_resources: 'Creating transcripts',
  ready: 'Preparing your files',
  failed: 'Transcription stopped',
  cancelled: 'Transcription cancelled',
  abandoned: 'Transcription interrupted',
}

const fileStatusCopy: Record<BackendFileStatus, string> = {
  pending: 'queued',
  downloading: 'downloading',
  extracting: 'preparing audio',
  transcribing: 'transcribing',
  writing: 'saving',
  completed: 'ready',
  failed: 'failed',
  cancelled: 'cancelled',
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

function stoppedCopy(status: BackendStatusResponse['status']) {
  if (status === 'cancelled') {
    return {
      title: 'Transcription cancelled',
      description: 'This job was cancelled before it finished.',
    }
  }

  if (status === 'abandoned') {
    return {
      title: 'Transcription interrupted',
      description: 'The server stopped while this job was active.',
    }
  }

  return {
    title: 'Transcription stopped',
    description: 'Review the details below, then try again.',
  }
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
  pollError,
  recoveryNotice,
  isFailed,
  isSubmitting,
  isLoadingFiles,
  onRetryStatus,
  onRetryJob,
  onChangeFolder,
}: ProcessingViewProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const progress = clampProgress(status.progress)
  const stopped = isFailed || stoppedStatuses.has(status.status)
  const heading = stoppedCopy(status.status)
  const title = isLoadingFiles
    ? 'Preparing your files'
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
      <header className="site-header">
        <Brand />
      </header>

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
            <h1 id="processing-title">{stopped ? heading.title : 'Working on it'}</h1>
            <p>
              {stopped
                ? heading.description
                : 'Large folders can take a while. You can leave this tab open.'}
            </p>
          </div>
        </div>

        <div className="progress-panel">
          <div className="progress-panel__top" aria-live="polite">
            <div>
              <span className="progress-label">{title}</span>
              {status.files.length > 0 && (
                <span className="progress-ready">
                  {readyCount} of {status.files.length} ready
                  {failedCount > 0 && `, ${failedCount} failed`}
                </span>
              )}
            </div>
            <strong>{Math.round(progress)}%</strong>
          </div>

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
                      <span>{fileStatusCopy[file.status] ?? file.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <strong>
                  {status.current_file ??
                    (isLoadingFiles ? 'building file list' : title.toLowerCase())}
                </strong>
              )}
            </div>
          </div>

          {pollError && (
            <div className="status-error" role="alert">
              <WifiOff aria-hidden="true" />
              <div>
                <strong>Progress paused</strong>
                <p>{pollError}</p>
              </div>
              <button type="button" onClick={onRetryStatus}>
                <RotateCw aria-hidden="true" />
                retry
              </button>
            </div>
          )}

          {recoveryNotice && (
            <div className="job-message" data-state="info" role="status">
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>Active job found</strong>
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
                  {status.status === 'completed' ? 'Completed with issues' : 'Job details'}
                </strong>
                <p>{jobErrorMessage(status.error)}</p>
              </div>
            </div>
          )}

          <section className="processing-files" aria-labelledby="file-progress-title">
            <div className="processing-files__header">
              <div>
                <h2 id="file-progress-title">File progress</h2>
                <p>
                  {status.files.length === 0
                    ? 'Files will appear after the folder is checked.'
                    : `${status.files.length} ${
                        status.files.length === 1 ? 'file' : 'files'
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
                            {fileStatusCopy[file.status] ?? file.status}
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
                  <strong>{stopped ? 'No files processed' : 'Finding files'}</strong>
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
            <div className="failed-action">
              <button
                className="secondary-button"
                type="button"
                onClick={onRetryJob}
                disabled={isSubmitting}
              >
                <RotateCw className={isSubmitting ? 'spin' : undefined} aria-hidden="true" />
                {isSubmitting ? 'starting' : 'try again'}
              </button>
              <button className="text-button" type="button" onClick={onChangeFolder}>
                change folder
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
