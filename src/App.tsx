import { CircleAlert, CircleCheck, FolderInput } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brand } from './components/Brand'
import { FileExplorer } from './components/FileExplorer'
import { FileViewer } from './components/FileViewer'
import { ProcessingView } from './components/ProcessingView'
import { StartView } from './components/StartView'
import { useTranscriptionJob } from './hooks/useTranscriptionJob'
import { BoundedLruCache } from './lib/boundedLruCache'
import {
  ApiError,
  downloadCombined,
  getFile,
} from './lib/transcriberApi'
import { jobErrorMessage } from './lib/transcriptionMessages'
import type {
  ExplorerFile,
  FileContentResponse,
  ViewerState,
} from './types'

type CacheEntry =
  | { kind: 'file'; payload: FileContentResponse }
  | { kind: 'combined'; content: string; fileName: string }

function cacheEntrySize(entry: CacheEntry) {
  if (entry.kind === 'combined') return entry.content.length * 2
  return (entry.payload.srt.length + entry.payload.text.length) * 2
}

function contentErrorMessage(error: unknown, file: ExplorerFile) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'The app cannot authenticate with the transcription service. Check the Vercel settings.'
    }
    if (error.status === 404) {
      return 'This transcript is no longer available. Refresh the folder results.'
    }
    if (error.status === 409) {
      return file.backendId === null
        ? 'The combined transcript is still being prepared. Try again shortly.'
        : 'This transcript is not ready yet. Try again shortly.'
    }
    if (error.kind === 'timeout') {
      return 'The request took too long. Check your connection and try again.'
    }
  }

  return 'The transcript could not be loaded. Check your connection and try again.'
}

function App() {
  const [driveUrl, setDriveUrl] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [openedFile, setOpenedFile] = useState<ExplorerFile | null>(null)
  const [viewerState, setViewerState] = useState<ViewerState>({
    status: 'idle',
    content: null,
  })
  const [mobileViewerOpen, setMobileViewerOpen] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const requestToken = useRef(0)
  const pendingFileKey = useRef<string | null>(null)
  const cache = useRef<BoundedLruCache<string, CacheEntry> | null>(null)

  if (!cache.current) {
    cache.current = new BoundedLruCache(6, 8 * 1024 * 1024, cacheEntrySize)
  }

  useEffect(
    () => () => {
      requestToken.current += 1
      requestController.current?.abort()
    },
    [],
  )

  const clearWorkspace = useCallback(() => {
    requestToken.current += 1
    requestController.current?.abort()
    pendingFileKey.current = null
    cache.current?.clear()
    setSelectedKey(null)
    setOpenedFile(null)
    setViewerState({ status: 'idle', content: null })
    setMobileViewerOpen(false)
  }, [])

  const job = useTranscriptionJob(clearWorkspace)

  const selectedFile = useMemo(
    () => job.files.find((file) => file.key === selectedKey) ?? null,
    [job.files, selectedKey],
  )

  const selectFile = useCallback(
    (file: ExplorerFile) => {
      setSelectedKey(file.key)

      if (openedFile?.key === file.key) return

      requestToken.current += 1
      requestController.current?.abort()
      pendingFileKey.current = null
      setOpenedFile(null)
      setViewerState({ status: 'idle', content: null })
      setMobileViewerOpen(false)
    },
    [openedFile?.key],
  )

  const openFile = useCallback(async (file: ExplorerFile, force = false) => {
    if (file.status !== 'ready') {
      requestToken.current += 1
      requestController.current?.abort()
      pendingFileKey.current = null
      setSelectedKey(file.key)
      setOpenedFile(file)
      setViewerState({ status: 'idle', content: null })
      setMobileViewerOpen(true)
      return
    }

    if (pendingFileKey.current === file.key) return
    pendingFileKey.current = file.key

    setSelectedKey(file.key)
    setOpenedFile(file)
    setMobileViewerOpen(true)
    setViewerState({ status: 'loading', content: null })

    requestToken.current += 1
    const token = requestToken.current
    requestController.current?.abort()

    const isCombined = file.backendId === null
    const format = file.type === 'srt' ? 'srt' : 'txt'
    const cacheKey = isCombined
      ? `combined:${job.jobId ?? 'latest'}:${format}`
      : `file:${file.backendId}`
    const cached = force ? undefined : cache.current?.get(cacheKey)

    if (cached) {
      const content =
        cached.kind === 'combined'
          ? cached.content
          : file.type === 'srt'
            ? cached.payload.srt
            : cached.payload.text
      setViewerState({
        status: 'ready',
        content,
        ...(cached.kind === 'combined' ? { fileName: cached.fileName } : {}),
      })
      pendingFileKey.current = null
      return
    }

    const controller = new AbortController()
    requestController.current = controller

    try {
      if (isCombined) {
        const download = await downloadCombined(
          format,
          job.jobId ?? undefined,
          controller.signal,
        )
        const content = await download.blob.text()
        if (token !== requestToken.current) return

        cache.current?.set(cacheKey, {
          kind: 'combined',
          content,
          fileName: download.filename,
        })
        setViewerState({
          status: 'ready',
          content,
          fileName: download.filename,
        })
        return
      }

      if (!file.backendId) throw new Error('Missing file identifier')
      const payload = await getFile(file.backendId, controller.signal)
      if (token !== requestToken.current) return

      cache.current?.set(cacheKey, { kind: 'file', payload })
      setViewerState({
        status: 'ready',
        content: file.type === 'srt' ? payload.srt : payload.text,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (token !== requestToken.current) return

      setViewerState({
        status: 'error',
        content: null,
        message: contentErrorMessage(error, file),
      })
    } finally {
      if (token === requestToken.current) pendingFileKey.current = null
    }
  }, [job.jobId])

  const closeFile = useCallback(() => {
    requestToken.current += 1
    requestController.current?.abort()
    pendingFileKey.current = null
    setOpenedFile(null)
    setViewerState({ status: 'idle', content: null })
    setMobileViewerOpen(false)
  }, [])

  const retryFile = useCallback(() => {
    if (openedFile) void openFile(openedFile, true)
  }, [openFile, openedFile])

  const resetApp = useCallback(() => {
    job.reset()
    setDriveUrl('')
  }, [job])

  if (job.phase === 'initial') {
    return (
      <StartView
        value={driveUrl}
        isSubmitting={job.isSubmitting}
        submitError={job.submitError}
        onChange={(value) => {
          setDriveUrl(value)
          job.clearSubmitError()
        }}
        onSubmit={(value) => void job.start(value)}
      />
    )
  }

  if (job.phase === 'processing' || job.phase === 'failed') {
    return (
      <ProcessingView
        status={job.status}
        pollError={job.pollError}
        recoveryNotice={job.recoveryNotice}
        isFailed={job.phase === 'failed'}
        isSubmitting={job.isSubmitting}
        isLoadingFiles={job.isLoadingFiles}
        onRetryStatus={job.retryStatus}
        onRetryJob={job.retryJob}
        onChangeFolder={resetApp}
      />
    )
  }

  const readyCount = job.files.filter((file) => file.status === 'ready').length
  const hasPartialFailures = job.files.some((file) => file.status === 'failed')

  return (
    <main className="results-page">
      <header className="results-header">
        <Brand />
        <div
          className="results-header__status"
          data-warning={hasPartialFailures || undefined}
          title={job.status.error ? jobErrorMessage(job.status.error) : undefined}
        >
          {hasPartialFailures ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <CircleCheck aria-hidden="true" />
          )}
          <span>transcripts ready</span>
          <small>{hasPartialFailures ? 'some files need attention' : `${readyCount} files`}</small>
        </div>
        <button
          className="new-folder-button"
          type="button"
          onClick={resetApp}
          aria-label="Process another folder"
        >
          <FolderInput aria-hidden="true" />
          <span>new folder</span>
        </button>
      </header>

      <div className="workspace-wrap">
        <div className="workspace" data-mobile-viewer={mobileViewerOpen || undefined}>
          <FileExplorer
            files={job.files}
            selectedKey={selectedKey}
            isLoading={job.isLoadingFiles}
            error={job.filesError}
            onSelect={selectFile}
            onOpen={(file) => void openFile(file)}
            onRetry={() => void job.retryFiles()}
          />
          <FileViewer
            selectedFile={selectedFile}
            openedFile={openedFile}
            viewerState={viewerState}
            onRetry={retryFile}
            onClose={closeFile}
          />
        </div>
      </div>
    </main>
  )
}

export default App
