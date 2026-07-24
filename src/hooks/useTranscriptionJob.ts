import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getFiles, getStatus, startProcess } from '../api'
import type {
  BackendFile,
  BackendStatusResponse,
  ExplorerFile,
  JobPhase,
} from '../types'

const initialStatus: BackendStatusResponse = {
  status: 'idle',
  progress: 0,
  current: null,
  error: null,
  files: [],
}

function fileStem(name: string) {
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

function createExplorerFiles(files: BackendFile[]): ExplorerFile[] {
  const rows = files.flatMap<ExplorerFile>((file) => {
    const stem = fileStem(file.name)
    const status = file.status === 'completed' ? 'ready' : 'failed'

    return [
      {
        key: `${file.id}:srt`,
        backendId: file.id,
        name: `${stem}.srt`,
        type: 'srt',
        status,
      },
      {
        key: `${file.id}:txt`,
        backendId: file.id,
        name: `${stem}.txt`,
        type: 'txt',
        status,
      },
    ]
  })

  if (files.some((file) => file.status === 'completed')) {
    rows.push({
      key: 'combined',
      backendId: null,
      name: 'combined.txt',
      type: 'combined',
      status: 'ready',
    })
  }

  return rows
}

function startErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.kind === 'configuration') {
      return 'The transcription service is not connected. Contact the site owner.'
    }
    if (error.status === 409) {
      return 'The service is already processing another folder. Try again when it finishes.'
    }
    if (error.status === 422) {
      return 'The folder link could not be read. Check the link and try again.'
    }
  }

  return 'Could not start transcription. Check your connection and try again.'
}

export function useTranscriptionJob(onNewJob: () => void) {
  const [phase, setPhase] = useState<JobPhase>('initial')
  const [status, setStatus] = useState<BackendStatusResponse>(initialStatus)
  const [files, setFiles] = useState<ExplorerFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [pollRun, setPollRun] = useState(0)
  const [lastUrl, setLastUrl] = useState('')
  const submitLock = useRef(false)
  const submitController = useRef<AbortController | null>(null)
  const filesController = useRef<AbortController | null>(null)

  const loadFiles = useCallback(async () => {
    filesController.current?.abort()
    const controller = new AbortController()
    filesController.current = controller
    setIsLoadingFiles(true)
    setFilesError(null)

    try {
      const response = await getFiles(controller.signal)
      setFiles(createExplorerFiles(response.files))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFiles([])
      setFilesError('The transcripts are ready, but the file list did not load.')
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingFiles(false)
        setPhase('results')
      }
    }
  }, [])

  useEffect(() => {
    if (phase !== 'processing' || !isPolling) return

    let active = true
    let timer: number | undefined
    let statusController: AbortController | null = null

    const poll = async () => {
      statusController = new AbortController()

      try {
        const response = await getStatus(statusController.signal)
        if (!active) return

        setStatus(response)
        setPollError(null)

        if (response.status === 'ready') {
          setIsPolling(false)
          await loadFiles()
          return
        }

        if (response.status === 'failed') {
          setIsPolling(false)
          setPhase('failed')
          return
        }

        timer = window.setTimeout(poll, 3000)
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        setIsPolling(false)
        setPollError('Could not refresh progress. Check your connection, then retry.')
      }
    }

    timer = window.setTimeout(poll, 3000)

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      statusController?.abort()
    }
  }, [isPolling, loadFiles, phase, pollRun])

  useEffect(
    () => () => {
      submitController.current?.abort()
      filesController.current?.abort()
    },
    [],
  )

  const start = useCallback(
    async (driveUrl: string) => {
      if (submitLock.current) return

      submitLock.current = true
      submitController.current?.abort()
      const controller = new AbortController()
      submitController.current = controller
      setIsSubmitting(true)
      setSubmitError(null)
      setPollError(null)
      setFilesError(null)
      setFiles([])
      setLastUrl(driveUrl)
      onNewJob()

      try {
        await startProcess(driveUrl, controller.signal)
        setStatus(initialStatus)
        setPhase('processing')
        setIsPolling(true)
        setPollRun((run) => run + 1)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSubmitError(startErrorMessage(error))
          setPhase('initial')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSubmitting(false)
          submitLock.current = false
        }
      }
    },
    [onNewJob],
  )

  const retryStatus = useCallback(() => {
    setPollError(null)
    setIsPolling(true)
    setPollRun((run) => run + 1)
  }, [])

  const retryJob = useCallback(() => {
    if (lastUrl) void start(lastUrl)
  }, [lastUrl, start])

  const clearSubmitError = useCallback(() => {
    setSubmitError(null)
  }, [])

  const reset = useCallback(() => {
    submitController.current?.abort()
    filesController.current?.abort()
    submitLock.current = false
    setPhase('initial')
    setStatus(initialStatus)
    setFiles([])
    setIsSubmitting(false)
    setIsLoadingFiles(false)
    setIsPolling(false)
    setSubmitError(null)
    setPollError(null)
    setFilesError(null)
    setLastUrl('')
    onNewJob()
  }, [onNewJob])

  return {
    phase,
    status,
    files,
    isSubmitting,
    isLoadingFiles,
    submitError,
    pollError,
    filesError,
    start,
    retryStatus,
    retryJob,
    retryFiles: loadFiles,
    clearSubmitError,
    reset,
  }
}
