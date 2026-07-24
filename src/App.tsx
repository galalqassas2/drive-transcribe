import { CircleCheck, FolderInput } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ApiError, getCombined, getFileContent } from './api'
import { Brand } from './components/Brand'
import { FileExplorer } from './components/FileExplorer'
import { FileViewer } from './components/FileViewer'
import { ProcessingView } from './components/ProcessingView'
import { StartView } from './components/StartView'
import { useTranscriptionJob } from './hooks/useTranscriptionJob'
import { BoundedLruCache } from './lib/boundedLruCache'
import type {
  ExplorerFile,
  FileContentResponse,
  ViewerState,
} from './types'

type CacheEntry =
  | { kind: 'file'; payload: FileContentResponse }
  | { kind: 'combined'; content: string }

function cacheEntrySize(entry: CacheEntry) {
  if (entry.kind === 'combined') return entry.content.length * 2
  return (entry.payload.srt.length + entry.payload.text.length) * 2
}

function contentErrorMessage(error: unknown, file: ExplorerFile) {
  if (file.type === 'combined' && error instanceof ApiError && error.status === 409) {
    return 'The combined transcript is still being prepared. Try again in a moment.'
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

    const cacheKey = file.type === 'combined' ? 'combined' : `file:${file.backendId}`
    const cached = force ? undefined : cache.current?.get(cacheKey)

    if (cached) {
      const content =
        cached.kind === 'combined'
          ? cached.content
          : file.type === 'srt'
            ? cached.payload.srt
            : cached.payload.text
      setViewerState({ status: 'ready', content })
      pendingFileKey.current = null
      return
    }

    const controller = new AbortController()
    requestController.current = controller

    try {
      if (file.type === 'combined') {
        const content = await getCombined(controller.signal)
        if (token !== requestToken.current) return

        cache.current?.set(cacheKey, { kind: 'combined', content })
        setViewerState({ status: 'ready', content })
        return
      }

      if (!file.backendId) throw new Error('Missing file identifier')
      const payload = await getFileContent(file.backendId, controller.signal)
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
  }, [])

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

  return (
    <main className="results-page">
      <header className="results-header">
        <Brand />
        <div className="results-header__status">
          <CircleCheck aria-hidden="true" />
          <span>transcripts ready</span>
          <small>{readyCount} files</small>
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
