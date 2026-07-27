import {
  CircleAlert,
  CircleCheck,
  Clock3,
  FolderPlus,
  History,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { listJobs } from '../lib/transcriberApi'
import type { BackendJobStatus, BackendJobSummary } from '../types'
import { Brand, BrandMark } from './Brand'

const cacheDuration = 60_000
const visibleJobLimit = 30
const folderNameCacheKey = 'drive-transcripts:folder-names'
const folderNameCacheLimit = 100
const folderNameLengthLimit = 200
const historyDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const statusLabel: Record<BackendJobStatus, string> = {
  active: 'In Progress',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
  abandoned: 'Interrupted',
}

interface AppSidebarProps {
  expanded: boolean
  currentJob: BackendJobSummary | null
  currentFolderName: string | null
  navigationLocked: boolean
  selectedJobId: string | null
  selectionError: string | null
  onOpen: () => void
  onClose: () => void
  onNewFolder: () => void
  onSelect: (job: BackendJobSummary) => void
}

function formatDate(timestamp: number) {
  return historyDateFormatter.format(new Date(timestamp * 1000))
}

function historyErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return null
  return 'History could not be loaded. Try again.'
}

function normalizeFolderName(value: unknown) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name ? name.slice(0, folderNameLengthLimit) : null
}

function readFolderNames(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(folderNameCacheKey) ?? '{}',
    )
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

    const entries: Array<[string, string]> = []
    for (const [jobId, storedName] of Object.entries(value)) {
      const name = normalizeFolderName(storedName)
      if (name) entries.push([jobId, name])
    }

    return Object.fromEntries(
      entries.slice(-folderNameCacheLimit),
    )
  } catch {
    return {}
  }
}

function folderNameForJob(
  job: BackendJobSummary,
  currentJobId: string | undefined,
  currentFolderName: string | null,
  folderNames: Record<string, string>,
) {
  const currentName = normalizeFolderName(currentFolderName)
  if (job.job_id === currentJobId && currentName) {
    return currentName
  }
  return folderNames[job.job_id] ?? null
}

export function AppSidebar({
  expanded,
  currentJob,
  currentFolderName,
  navigationLocked,
  selectedJobId,
  selectionError,
  onOpen,
  onClose,
  onNewFolder,
  onSelect,
}: AppSidebarProps) {
  const [jobs, setJobs] = useState<BackendJobSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [folderNames, setFolderNames] = useState<Record<string, string>>(
    readFolderNames,
  )
  const loadedAt = useRef(0)
  const request = useRef<Promise<void> | null>(null)
  const controller = useRef<AbortController | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const wasExpanded = useRef(false)

  const load = useCallback((force = false) => {
    if (!force && Date.now() - loadedAt.current < cacheDuration) {
      return Promise.resolve()
    }
    if (request.current) return request.current

    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setIsLoading(true)
    setLoadError(null)

    const nextRequest = listJobs(nextController.signal)
      .then((response) => {
        setJobs(response.jobs)
        loadedAt.current = Date.now()
      })
      .catch((error: unknown) => {
        const message = historyErrorMessage(error)
        if (message) setLoadError(message)
      })
      .finally(() => {
        if (controller.current === nextController) {
          controller.current = null
          request.current = null
          setIsLoading(false)
        }
      })

    request.current = nextRequest
    return nextRequest
  }, [])

  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  useEffect(
    () => () => {
      const activeController = controller.current
      controller.current = null
      request.current = null
      activeController?.abort()
    },
    [],
  )

  useEffect(() => {
    if (!expanded) {
      if (wasExpanded.current) {
        window.requestAnimationFrame(() => openButton.current?.focus())
      }
      wasExpanded.current = false
      return
    }

    wasExpanded.current = true
    closeButton.current?.focus()
    const compactLayout = window.matchMedia('(max-width: 759px)').matches
    const previousOverflow = document.body.style.overflow
    if (compactLayout) document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (compactLayout) document.body.style.overflow = previousOverflow
    }
  }, [expanded, onClose])

  useEffect(() => {
    const jobId = currentJob?.job_id
    const name = normalizeFolderName(currentFolderName)
    if (!jobId || !name) return

    setFolderNames((current) => {
      if (current[jobId] === name) return current

      const entries = Object.entries(current).filter(([key]) => key !== jobId)
      entries.push([jobId, name])
      const next = Object.fromEntries(entries.slice(-folderNameCacheLimit))
      try {
        window.localStorage.setItem(folderNameCacheKey, JSON.stringify(next))
      } catch {
        // The in-memory label still improves this session.
      }
      return next
    })
  }, [currentFolderName, currentJob?.job_id])

  const visibleJobs = useMemo(() => {
    const merged = new Map(jobs.map((job) => [job.job_id, job]))
    if (currentJob) merged.set(currentJob.job_id, currentJob)

    return [...merged.values()]
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, visibleJobLimit)
  }, [currentJob, jobs])

  const handleListKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()

    const direction = event.key === 'ArrowDown' ? 1 : -1
    const buttons = [
      ...(sidebar.current?.querySelectorAll<HTMLButtonElement>(
        '.history-job:not(:disabled)',
      ) ?? []),
    ]
    const currentIndex = buttons.indexOf(event.currentTarget)
    buttons[
      Math.min(buttons.length - 1, Math.max(0, currentIndex + direction))
    ]?.focus()
  }

  return (
    <>
      <button
        className="sidebar-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close Sidebar"
        tabIndex={expanded ? 0 : -1}
      />

      <aside
        ref={sidebar}
        className="app-sidebar"
        data-expanded={expanded || undefined}
        aria-label="Sidebar"
      >
        {expanded ? (
          <div className="sidebar-panel">
            <header className="sidebar-header">
              <Brand />
              <div className="sidebar-header__actions">
                <button
                  ref={closeButton}
                  type="button"
                  onClick={onClose}
                  aria-label="Close Sidebar"
                >
                  <PanelLeftClose aria-hidden="true" />
                </button>
              </div>
            </header>

            <nav className="sidebar-navigation" aria-label="Transcription Navigation">
              <button
                className="sidebar-new-button"
                type="button"
                onClick={onNewFolder}
                disabled={navigationLocked}
              >
                <FolderPlus aria-hidden="true" />
                <span>New Folder</span>
              </button>
            </nav>

            <section className="history-section" aria-labelledby="history-title">
              <div className="history-section__header">
                <h2 id="history-title">History</h2>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  disabled={isLoading}
                  aria-label="Refresh History"
                >
                  <RefreshCw
                    className={isLoading ? 'spin' : undefined}
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="history-content">
                {navigationLocked && (
                  <div className="history-notice" role="status">
                    <Clock3 aria-hidden="true" />
                    <p>Past jobs are available when the current job finishes.</p>
                  </div>
                )}

                {(loadError || selectionError) && (
                  <div className="history-error" role="alert">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <strong>
                        {selectionError
                          ? 'Could Not Open Job'
                          : 'Could Not Load History'}
                      </strong>
                      <p>{selectionError ?? loadError}</p>
                    </div>
                    {loadError && !selectionError && (
                      <button type="button" onClick={() => void load(true)}>
                        Try Again
                      </button>
                    )}
                  </div>
                )}

                {isLoading && visibleJobs.length === 0 && (
                  <div
                    className="history-skeletons"
                    aria-label="Loading Transcription History"
                  >
                    {Array.from({ length: 5 }, (_, index) => (
                      <div className="history-skeleton" key={index}>
                        <span />
                        <div>
                          <span />
                          <span />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!isLoading && !loadError && visibleJobs.length === 0 && (
                  <div className="history-empty">
                    <Clock3 aria-hidden="true" />
                    <h3>No Transcriptions Yet</h3>
                    <p>Completed jobs will appear here.</p>
                  </div>
                )}

                {visibleJobs.length > 0 && (
                  <ul className="history-list" aria-label="Recent Transcriptions">
                    {visibleJobs.map((job) => {
                      const isCurrent = job.job_id === currentJob?.job_id
                      const isBusy = job.job_id === selectedJobId
                      const folderName = folderNameForJob(
                        job,
                        currentJob?.job_id,
                        currentFolderName,
                        folderNames,
                      )
                      const label =
                        folderName ?? `Folder from ${formatDate(job.created_at)}`
                      const isDisabled =
                        Boolean(selectedJobId) ||
                        (navigationLocked && !isCurrent)

                      return (
                        <li key={job.job_id}>
                          <button
                            className="history-job"
                            type="button"
                            onClick={() => onSelect(job)}
                            onKeyDown={handleListKeyDown}
                            disabled={isDisabled}
                            data-current={isCurrent || undefined}
                            aria-current={isCurrent ? 'true' : undefined}
                          >
                            <span
                              className="history-job__icon"
                              data-status={job.status}
                              aria-hidden="true"
                            >
                              {isBusy ? (
                                <LoaderCircle className="spin" />
                              ) : job.status === 'completed' ? (
                                <CircleCheck />
                              ) : job.status === 'active' ? (
                                <Clock3 />
                              ) : (
                                <CircleAlert />
                              )}
                            </span>
                            <span className="history-job__body">
                              <strong title={label}>{label}</strong>
                              <span>
                                {folderName
                                  ? formatDate(job.created_at)
                                  : 'Google Drive Folder'}
                              </span>
                            </span>
                            <span
                              className="history-job__status"
                              data-status={job.status}
                            >
                              {statusLabel[job.status]}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>
        ) : (
          <nav className="sidebar-rail" aria-label="Sidebar Shortcuts">
            <button
              ref={openButton}
              className="sidebar-brand-toggle"
              type="button"
              onClick={onOpen}
              aria-label="Open Sidebar"
              aria-expanded="false"
              data-tooltip="Open Sidebar"
            >
              <BrandMark />
              <PanelLeftOpen className="sidebar-brand-toggle__icon" aria-hidden="true" />
            </button>
            <button
              className="sidebar-rail__action"
              type="button"
              onClick={onNewFolder}
              disabled={navigationLocked}
              aria-label="New Folder"
              data-tooltip="New Folder"
            >
              <FolderPlus aria-hidden="true" />
            </button>
            <button
              className="sidebar-rail__action"
              type="button"
              onClick={onOpen}
              aria-label="History"
              data-tooltip="History"
            >
              <History aria-hidden="true" />
            </button>
          </nav>
        )}
      </aside>
    </>
  )
}
