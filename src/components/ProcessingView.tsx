import { useEffect, useState } from 'react'
import {
  AudioLines,
  CircleAlert,
  FileVideo,
  RotateCw,
  WifiOff,
} from 'lucide-react'
import type { BackendStatusResponse } from '../types'
import { Brand } from './Brand'
import { DriveProcessingIcon } from './DriveProcessingIcon'

interface ProcessingViewProps {
  status: BackendStatusResponse
  pollError: string | null
  isFailed: boolean
  isSubmitting: boolean
  isLoadingFiles: boolean
  onRetryStatus: () => void
  onRetryJob: () => void
  onChangeFolder: () => void
}

const statusCopy = {
  idle: 'Starting transcription',
  listing: 'Finding media',
  downloading: 'Downloading files',
  transcribing: 'Creating transcripts',
  waiting: 'Waiting for capacity',
  ready: 'Preparing your files',
  failed: 'Transcription stopped',
} as const

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
  isFailed,
  isSubmitting,
  isLoadingFiles,
  onRetryStatus,
  onRetryJob,
  onChangeFolder,
}: ProcessingViewProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const progress = Math.min(100, Math.max(0, status.progress))
  const title = isLoadingFiles ? 'Preparing your files' : statusCopy[status.status]
  const readyCount = status.files.filter((file) => file.status === 'completed').length

  return (
    <main className="processing-page">
      <header className="site-header">
        <Brand />
      </header>

      <section className="processing-stage" aria-labelledby="processing-title">
        <div className="processing-heading">
          <span
            className="processing-heading__icon"
            data-state={isFailed ? 'failed' : 'active'}
            aria-hidden="true"
          >
            {isFailed ? (
              <CircleAlert />
            ) : prefersReducedMotion || pollError ? (
              <AudioLines />
            ) : (
              <DriveProcessingIcon key={status.status} />
            )}
          </span>
          <div>
            <h1 id="processing-title">{isFailed ? 'Transcription stopped' : 'Working on it'}</h1>
            <p>
              {isFailed
                ? 'Check that the folder is public and contains supported media.'
                : 'Large folders can take a while. You can leave this tab open.'}
            </p>
          </div>
        </div>

        <div className="progress-panel" aria-live="polite">
          <div className="progress-panel__top">
            <div>
              <span className="progress-label">{title}</span>
              {readyCount > 0 && !isFailed && (
                <span className="progress-ready">
                  {readyCount} {readyCount === 1 ? 'source' : 'sources'} ready
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

          <div className="current-file">
            <span className="current-file__icon" aria-hidden="true">
              <FileVideo />
            </span>
            <div>
              <span className="current-file__label">Current file</span>
              <strong>{status.current ?? (isLoadingFiles ? 'building file list' : 'getting ready')}</strong>
            </div>
          </div>

          {!pollError && !isFailed && (
            <p className="poll-note">Progress refreshes every 3 seconds.</p>
          )}

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

          {isFailed && (
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
