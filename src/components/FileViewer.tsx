import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  FolderOpen,
  RotateCw,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ExplorerFile, ViewerState } from '../types'
import { TranscriptFileIcon } from './TranscriptFileIcon'

interface FileViewerProps {
  selectedFile: ExplorerFile | null
  openedFile: ExplorerFile | null
  viewerState: ViewerState
  onRetry: () => void
  onClose: () => void
}

function viewerType(type: ExplorerFile['type']) {
  if (type === 'srt') return 'SRT subtitle'
  if (type === 'combined') return 'combined text'
  return 'plain text'
}

export function FileViewer({
  selectedFile,
  openedFile,
  viewerState,
  onRetry,
  onClose,
}: FileViewerProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const viewerRef = useRef<HTMLElement>(null)
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    setCopyState('idle')
  }, [openedFile?.key, viewerState.status])

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (openedFile) viewerRef.current?.focus({ preventScroll: true })
  }, [openedFile])

  const copyContent = async () => {
    if (viewerState.status !== 'ready') return

    try {
      await navigator.clipboard.writeText(viewerState.content)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }

    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => {
      setCopyState('idle')
      copyTimer.current = null
    }, 2200)
  }

  const downloadContent = () => {
    if (!openedFile || viewerState.status !== 'ready') return

    const blob = new Blob([viewerState.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = openedFile.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  if (!openedFile) {
    return (
      <section className="viewer-panel viewer-panel--empty" aria-label="Transcript viewer">
        {selectedFile ? (
          <div className="viewer-prompt">
            <span className="viewer-prompt__icon" aria-hidden="true">
              <TranscriptFileIcon type={selectedFile.type} />
            </span>
            <p className="viewer-prompt__type">{viewerType(selectedFile.type)}</p>
            <h2>{selectedFile.name}</h2>
            {selectedFile.status === 'ready' ? (
              <p>Press Enter to open this file.</p>
            ) : (
              <div className="viewer-unavailable">
                <CircleAlert aria-hidden="true" />
                <span>This source could not be transcribed.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="viewer-prompt">
            <span className="viewer-prompt__icon" aria-hidden="true">
              <FolderOpen />
            </span>
            <h2>Choose a transcript</h2>
            <p>Click a file to view its transcript.</p>
          </div>
        )}
      </section>
    )
  }

  const canUseContent = viewerState.status === 'ready'

  return (
    <section
      ref={viewerRef}
      className="viewer-panel"
      aria-label={`${openedFile.name} viewer`}
      tabIndex={-1}
    >
      <header className="viewer-header">
        <button
          className="viewer-back"
          type="button"
          onClick={onClose}
          aria-label="Back to transcript files"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        <span className="viewer-header__icon" data-type={openedFile.type} aria-hidden="true">
          <TranscriptFileIcon type={openedFile.type} />
        </span>
        <div className="viewer-header__title">
          <h2 title={openedFile.name}>{openedFile.name}</h2>
          <p>{viewerType(openedFile.type)}</p>
        </div>

        <div className="viewer-actions">
          {openedFile.status === 'ready' && (
            <>
              <button
                type="button"
                onClick={copyContent}
                disabled={!canUseContent}
                data-state={copyState === 'idle' ? undefined : copyState}
                aria-label={
                  copyState === 'copied'
                    ? 'Copied transcript'
                    : copyState === 'failed'
                      ? 'Copy failed. Try again'
                      : 'Copy transcript'
                }
                title={copyState === 'failed' ? 'copy failed' : undefined}
              >
                {copyState === 'copied' ? (
                  <Check aria-hidden="true" />
                ) : copyState === 'failed' ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
                <span>
                  {copyState === 'copied'
                    ? 'copied'
                    : copyState === 'failed'
                      ? 'copy failed'
                      : 'copy'}
                </span>
              </button>
              <button
                type="button"
                onClick={downloadContent}
                disabled={!canUseContent}
                aria-label="Download transcript"
              >
                <Download aria-hidden="true" />
                <span>download</span>
              </button>
            </>
          )}
          <button className="viewer-close" type="button" onClick={onClose} aria-label="Close file">
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      {copyState !== 'idle' && (
        <div
          className="copy-feedback"
          data-state={copyState}
          role="status"
          aria-live="polite"
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" />
          ) : (
            <CircleAlert aria-hidden="true" />
          )}
          <span>
            {copyState === 'copied'
              ? 'copied to clipboard'
              : 'copy failed, try again'}
          </span>
        </div>
      )}

      <div className="viewer-body">
        {openedFile.status === 'failed' && (
          <div className="viewer-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <h3>Transcript unavailable</h3>
            <p>This source could not be transcribed. Check the original media and try a new folder.</p>
          </div>
        )}

        {openedFile.status === 'ready' && viewerState.status === 'loading' && (
          <div className="viewer-loading" aria-label="Loading transcript">
            <div className="viewer-loading__line viewer-loading__line--short" />
            <div className="viewer-loading__line" />
            <div className="viewer-loading__line" />
            <div className="viewer-loading__line viewer-loading__line--medium" />
            <div className="viewer-loading__line" />
            <div className="viewer-loading__line viewer-loading__line--short" />
          </div>
        )}

        {openedFile.status === 'ready' && viewerState.status === 'error' && (
          <div className="viewer-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <h3>File did not load</h3>
            <p>{viewerState.message}</p>
            <button type="button" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              try again
            </button>
          </div>
        )}

        {openedFile.status === 'ready' && viewerState.status === 'ready' && (
          <pre
            className={openedFile.type === 'srt' ? 'transcript transcript--srt' : 'transcript transcript--txt'}
            aria-label={`${openedFile.name} transcript content`}
            tabIndex={0}
          >
            {viewerState.content}
          </pre>
        )}
      </div>
    </section>
  )
}
