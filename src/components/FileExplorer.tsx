import {
  Check,
  CircleX,
  Folder,
  RotateCw,
} from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import type { ExplorerFile } from '../types'
import { TranscriptFileIcon } from './TranscriptFileIcon'

interface FileExplorerProps {
  files: ExplorerFile[]
  selectedKey: string | null
  isLoading: boolean
  error: string | null
  onSelect: (file: ExplorerFile) => void
  onOpen: (file: ExplorerFile) => void
  onRetry: () => void
}

function typeLabel(type: ExplorerFile['type']) {
  return type === 'combined' ? '.txt' : `.${type}`
}

export function FileExplorer({
  files,
  selectedKey,
  isLoading,
  error,
  onSelect,
  onOpen,
  onRetry,
}: FileExplorerProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    file: ExplorerFile,
  ) => {
    let nextIndex: number | null = null

    if (event.key === 'ArrowDown') nextIndex = Math.min(files.length - 1, index + 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = files.length - 1

    if (nextIndex !== null) {
      event.preventDefault()
      const nextFile = files[nextIndex]
      onSelect(nextFile)
      itemRefs.current[nextIndex]?.focus()
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(file)
    }
  }

  return (
    <aside className="explorer-panel" aria-label="Transcript explorer">
      <div className="explorer-header">
        <span className="folder-icon" aria-hidden="true">
          <Folder />
        </span>
        <div>
          <h2>transcripts</h2>
          <p>{isLoading ? 'loading files' : `${files.length} ${files.length === 1 ? 'file' : 'files'}`}</p>
        </div>
      </div>

      <div className="explorer-content">
        {isLoading && (
          <div className="file-skeletons" aria-label="Loading transcript files">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="file-skeleton" key={index}>
                <span />
                <div>
                  <span />
                  <span />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="explorer-state" role="alert">
            <CircleX aria-hidden="true" />
            <h3>Files did not load</h3>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              try again
            </button>
          </div>
        )}

        {!isLoading && !error && files.length === 0 && (
          <div className="explorer-state">
            <Folder aria-hidden="true" />
            <h3>No transcript files</h3>
            <p>Completed files will appear here.</p>
            <button type="button" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              refresh
            </button>
          </div>
        )}

        {!isLoading && !error && files.length > 0 && (
          <ul className="file-list" aria-label="Transcript files">
            {files.map((file, index) => {
              const isSelected = file.key === selectedKey
              const isCombined = file.backendId === null

              return (
                <li
                  className="file-row"
                  data-selected={isSelected || undefined}
                  data-combined={isCombined || undefined}
                  key={file.key}
                >
                  <button
                    ref={(element) => {
                      itemRefs.current[index] = element
                    }}
                    className="file-row__select"
                    type="button"
                    onClick={() => onOpen(file)}
                    onKeyDown={(event) => handleKeyDown(event, index, file)}
                    aria-current={isSelected ? 'true' : undefined}
                    tabIndex={isSelected || (!selectedKey && index === 0) ? 0 : -1}
                  >
                    <span className="file-row__icon" data-type={file.type} aria-hidden="true">
                      <TranscriptFileIcon type={file.type} />
                    </span>
                    <span className="file-row__details">
                      <strong title={file.name}>{file.name}</strong>
                      <span title={file.error ?? undefined}>
                        {file.error ?? `${typeLabel(file.type)} file`}
                      </span>
                    </span>
                    <span className="file-row__status" data-status={file.status}>
                      {file.status === 'ready' ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <CircleX aria-hidden="true" />
                      )}
                      {file.status}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
