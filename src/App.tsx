import {
  CircleAlert,
  CircleCheck,
  Download,
  FolderInput,
  LoaderCircle,
} from 'lucide-react'
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
  getDriveFolderName,
  getFile,
} from './lib/transcriberApi'
import {
  archiveFilename,
  createTranscriptArchive,
  transcriptFilename,
} from './lib/transcriptArchive'
import { jobErrorMessage } from './lib/transcriptionMessages'
import type {
  ExplorerFile,
  FileContentResponse,
  ViewerState,
} from './types'

type CacheEntry =
  | { kind: 'file'; payload: FileContentResponse }
  | { kind: 'combined'; content: string; fileName: string }

type DownloadAllState =
  | { status: 'idle' }
  | { status: 'loading'; completed: number; total: number }
  | { status: 'success'; total: number }
  | { status: 'error'; message: string }

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

function downloadAllErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.kind === 'timeout') {
      return 'The download took too long. Check your connection and try again.'
    }
    if (error.status === 404) {
      return 'One or more transcripts are no longer available.'
    }
  }

  return 'The ZIP could not be prepared. Check your connection and try again.'
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const [driveUrl, setDriveUrl] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [openedFile, setOpenedFile] = useState<ExplorerFile | null>(null)
  const [viewerState, setViewerState] = useState<ViewerState>({
    status: 'idle',
    content: null,
  })
  const [folderName, setFolderName] = useState<string | null>(null)
  const [downloadAllState, setDownloadAllState] = useState<DownloadAllState>({
    status: 'idle',
  })
  const [mobileViewerOpen, setMobileViewerOpen] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const downloadController = useRef<AbortController | null>(null)
  const downloadFeedbackTimer = useRef<number | null>(null)
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
      downloadController.current?.abort()
      if (downloadFeedbackTimer.current !== null) {
        window.clearTimeout(downloadFeedbackTimer.current)
      }
    },
    [],
  )

  const clearWorkspace = useCallback(() => {
    requestToken.current += 1
    requestController.current?.abort()
    downloadController.current?.abort()
    downloadController.current = null
    if (downloadFeedbackTimer.current !== null) {
      window.clearTimeout(downloadFeedbackTimer.current)
      downloadFeedbackTimer.current = null
    }
    pendingFileKey.current = null
    cache.current?.clear()
    setFolderName(null)
    setDownloadAllState({ status: 'idle' })
    setSelectedKey(null)
    setOpenedFile(null)
    setViewerState({ status: 'idle', content: null })
    setMobileViewerOpen(false)
  }, [])

  const job = useTranscriptionJob(clearWorkspace)
  const folderUrl = 'folder_url' in job.status ? job.status.folder_url : null

  useEffect(() => {
    setFolderName(null)
    if (!folderUrl) return

    const controller = new AbortController()
    void getDriveFolderName(folderUrl, controller.signal)
      .then((folder) => setFolderName(folder.name))
      .catch(() => {})

    return () => controller.abort()
  }, [folderUrl])

  const selectedFile = useMemo(
    () => job.files.find((file) => file.key === selectedKey) ?? null,
    [job.files, selectedKey],
  )

  const downloadableFiles = useMemo(
    () =>
      job.files.filter(
        (file) =>
          file.backendId !== null &&
          file.type === 'srt' &&
          file.status === 'ready',
      ),
    [job.files],
  )

  const downloadAll = useCallback(async () => {
    if (
      downloadController.current ||
      downloadableFiles.length === 0
    ) {
      return
    }

    if (downloadFeedbackTimer.current !== null) {
      window.clearTimeout(downloadFeedbackTimer.current)
      downloadFeedbackTimer.current = null
    }

    const controller = new AbortController()
    downloadController.current = controller
    const total = downloadableFiles.length
    setDownloadAllState({ status: 'loading', completed: 0, total })

    try {
      const folderNameRequest =
        folderName || !folderUrl
          ? Promise.resolve(folderName)
          : getDriveFolderName(folderUrl, controller.signal)
              .then((folder) => folder.name)
              .catch(() => null)
      const transcripts: Array<{ sourceName: string; content: string }> = []
      let nextIndex = 0
      let completed = 0

      await Promise.all(
        Array.from({ length: Math.min(3, total) }, async () => {
          while (nextIndex < total) {
            const index = nextIndex
            nextIndex += 1
            const file = downloadableFiles[index]
            const fileId = file.backendId
            if (!fileId) throw new Error('Missing file identifier')

            const cacheKey = `file:${fileId}`
            const cached = cache.current?.get(cacheKey)
            const payload =
              cached?.kind === 'file'
                ? cached.payload
                : await getFile(fileId, controller.signal)

            if (cached?.kind !== 'file') {
              cache.current?.set(cacheKey, { kind: 'file', payload })
            }

            transcripts[index] = {
              sourceName: file.name,
              content: payload.srt,
            }
            completed += 1
            setDownloadAllState({ status: 'loading', completed, total })
          }
        }),
      )

      const resolvedFolderName = await folderNameRequest
      if (resolvedFolderName) setFolderName(resolvedFolderName)

      const usedNames = new Set<string>()
      const archive = await createTranscriptArchive(
        transcripts.map((transcript) => ({
          name: transcriptFilename(transcript.sourceName, usedNames),
          content: transcript.content,
        })),
        controller.signal,
      )

      if (controller.signal.aborted) return
      saveDownload(archive, archiveFilename())
      setDownloadAllState({ status: 'success', total })
      downloadFeedbackTimer.current = window.setTimeout(() => {
        setDownloadAllState({ status: 'idle' })
        downloadFeedbackTimer.current = null
      }, 2400)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      controller.abort()
      setDownloadAllState({
        status: 'error',
        message: downloadAllErrorMessage(error),
      })
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null
      }
    }
  }, [downloadableFiles, folderName, folderUrl])

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
        isCancelling={job.isCancelling}
        cancelError={job.cancelError}
        onRetryStatus={job.retryStatus}
        onRetryJob={job.retryJob}
        onCancel={() => void job.cancel()}
        onChangeFolder={resetApp}
      />
    )
  }

  const readyCount = job.files.filter((file) => file.status === 'ready').length
  const hasPartialFailures = job.files.some((file) => file.status === 'failed')
  const downloadAllLabel =
    downloadAllState.status === 'loading'
      ? `preparing ${downloadAllState.completed}/${downloadAllState.total}`
      : downloadAllState.status === 'success'
        ? 'downloaded'
        : downloadAllState.status === 'error'
          ? 'try again'
          : 'download all'
  const downloadAllMessage =
    downloadAllState.status === 'success'
      ? `${downloadAllState.total} transcripts downloaded`
      : downloadAllState.status === 'error'
        ? downloadAllState.message
        : ''

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
        <div className="results-header__actions">
          <button
            className="download-all-button"
            type="button"
            onClick={() => void downloadAll()}
            disabled={
              downloadAllState.status === 'loading' ||
              downloadableFiles.length === 0
            }
            data-state={
              downloadAllState.status === 'idle'
                ? undefined
                : downloadAllState.status
            }
            aria-label={`Download all ${downloadableFiles.length} SRT transcripts as TXT files`}
            title={
              downloadAllState.status === 'error'
                ? downloadAllState.message
                : `Download ${downloadableFiles.length} transcripts as TXT files`
            }
          >
            {downloadAllState.status === 'loading' ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : downloadAllState.status === 'success' ? (
              <CircleCheck aria-hidden="true" />
            ) : downloadAllState.status === 'error' ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            <span>{downloadAllLabel}</span>
          </button>
          <button
            className="new-folder-button"
            type="button"
            onClick={resetApp}
            aria-label="Process another folder"
          >
            <FolderInput aria-hidden="true" />
            <span>new folder</span>
          </button>
          <span className="visually-hidden" role="status" aria-live="polite">
            {downloadAllMessage}
          </span>
        </div>
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
