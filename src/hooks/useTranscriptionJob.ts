import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getJob,
  getStatus,
  listFiles,
  startJob,
} from '../lib/transcriberApi'
import { fileErrorMessage } from '../lib/transcriptionMessages'
import type {
  BackendFile,
  BackendStatusResponse,
  ExplorerFile,
  JobPhase,
} from '../types'

const pollInterval = 2500
const maxPollInterval = 30_000

const initialStatus: BackendStatusResponse = {
  status: 'idle',
  phase: 'idle',
  progress: 0,
  current_file: null,
  error: null,
  files: [],
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isTransientPollError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.kind === 'timeout' ||
      error.kind === 'network' ||
      error.status === 408 ||
      error.status === 429 ||
      (error.status !== undefined && error.status >= 500))
  )
}

function hasJobId(status: BackendStatusResponse): status is BackendStatusResponse & {
  job_id: string
} {
  return 'job_id' in status && typeof status.job_id === 'string'
}

function isTerminal(status: BackendStatusResponse['status']) {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'abandoned'
  )
}

function fileStem(name: string) {
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

function fileError(file: BackendFile) {
  return fileErrorMessage(file.error)
}

function createExplorerFiles(
  files: BackendFile[],
  jobStatus: BackendStatusResponse['status'],
): ExplorerFile[] {
  const rows = files.flatMap<ExplorerFile>((file) => {
    const stem = fileStem(file.name)
    const isReady = file.status === 'completed'
    const status = isReady ? 'ready' : 'failed'
    const error = isReady ? undefined : fileError(file)

    return [
      {
        key: `${file.id}:srt`,
        backendId: file.id,
        name: `${stem}.srt`,
        type: 'srt',
        status,
        error,
      },
      {
        key: `${file.id}:txt`,
        backendId: file.id,
        name: `${stem}.txt`,
        type: 'txt',
        status,
        error,
      },
    ]
  })

  if (jobStatus === 'completed' && files.some((file) => file.status === 'completed')) {
    rows.push(
      {
        key: 'combined:txt',
        backendId: null,
        name: 'combined.txt',
        type: 'combined',
        status: 'ready',
      },
      {
        key: 'combined:srt',
        backendId: null,
        name: 'combined.srt',
        type: 'srt',
        status: 'ready',
      },
    )
  }

  return rows
}

function apiErrorMessage(error: unknown, context: 'start' | 'poll' | 'files') {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'The app cannot authenticate with the transcription service. Check the Vercel settings.'
    }
    if (error.status === 404) {
      return context === 'files'
        ? 'The transcript outputs were not found.'
        : 'This transcription job was not found.'
    }
    if (error.status === 409) {
      return context === 'start'
        ? 'Another folder is already being processed.'
        : 'The requested result is not ready yet.'
    }
    if (error.status === 422) {
      return 'Enter a valid public Google Drive folder link.'
    }
    if (error.status === 507) {
      return 'The transcription server needs more free disk space before it can start.'
    }
    if (error.kind === 'timeout') {
      return context === 'start'
        ? 'The start request timed out. The app checked for an active job before allowing another try.'
        : 'The request took too long. Check your connection, then retry.'
    }
    if (error.kind === 'network') {
      return 'The transcription service could not be reached. Check your connection, then retry.'
    }
  }

  if (context === 'files') {
    return 'The transcripts are ready, but the file list did not load.'
  }
  if (context === 'poll') {
    return 'Could not refresh progress. Check your connection, then retry.'
  }
  return 'The transcription could not start. Check the link, then try again.'
}

export function useTranscriptionJob(onNewJob: () => void) {
  const [phase, setPhase] = useState<JobPhase>('initial')
  const [status, setStatus] = useState<BackendStatusResponse>(initialStatus)
  const [jobId, setJobId] = useState<string | null>(null)
  const [files, setFiles] = useState<ExplorerFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [pollRun, setPollRun] = useState(0)
  const [lastUrl, setLastUrl] = useState('')
  const submitLock = useRef(false)
  const submitController = useRef<AbortController | null>(null)
  const filesController = useRef<AbortController | null>(null)
  const statusRef = useRef<BackendStatusResponse>(initialStatus)
  const jobIdRef = useRef<string | null>(null)

  const updateStatus = useCallback((nextStatus: BackendStatusResponse) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const loadFiles = useCallback(async () => {
    filesController.current?.abort()
    const controller = new AbortController()
    filesController.current = controller
    setIsLoadingFiles(true)
    setFilesError(null)

    try {
      const response = await listFiles(controller.signal)
      if (
        'job_id' in response &&
        response.job_id &&
        jobIdRef.current &&
        response.job_id !== jobIdRef.current
      ) {
        throw new ApiError('The file list belongs to a different job')
      }

      const merged = new Map(response.files.map((file) => [file.id, file]))
      for (const file of statusRef.current.files) {
        if (!merged.has(file.id)) merged.set(file.id, file)
      }

      setFiles(createExplorerFiles([...merged.values()], statusRef.current.status))
    } catch (error) {
      if (isAbortError(error)) return
      setFiles([])
      setFilesError(apiErrorMessage(error, 'files'))
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingFiles(false)
        setPhase('results')
      }
    }
  }, [])

  useEffect(() => {
    if (phase !== 'processing' || !isPolling || !jobId) return

    let active = true
    let timer: number | undefined
    let pollController: AbortController | null = null
    let failures = 0

    const poll = async () => {
      pollController = new AbortController()

      try {
        const response = await getJob(jobId, pollController.signal)
        if (!active) return

        updateStatus(response)
        setPollError(null)
        failures = 0

        if (isTerminal(response.status)) {
          setIsPolling(false)
          if (response.status === 'completed') {
            await loadFiles()
          } else {
            setPhase('failed')
          }
          return
        }

        timer = window.setTimeout(poll, pollInterval)
      } catch (error) {
        if (!active || isAbortError(error)) return
        const isTransient = isTransientPollError(error)
        setPollError(
          isTransient
            ? 'Progress refresh is delayed. Retrying automatically.'
            : apiErrorMessage(error, 'poll'),
        )

        if (isTransient) {
          failures += 1
          const delay = Math.min(pollInterval * 2 ** failures, maxPollInterval)
          timer = window.setTimeout(poll, delay)
          return
        }

        setIsPolling(false)
      }
    }

    void poll()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      pollController?.abort()
    }
  }, [isPolling, jobId, loadFiles, phase, pollRun, updateStatus])

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
      setRecoveryNotice(null)
      setFiles([])
      setLastUrl(driveUrl)
      onNewJob()

      try {
        const response = await startJob(driveUrl, controller.signal)
        const now = Date.now() / 1000
        const startedStatus: BackendStatusResponse = {
          job_id: response.job_id,
          folder_url: driveUrl,
          status: 'active',
          phase: 'queued',
          progress: 0,
          current_file: null,
          error: null,
          cancel_requested: false,
          created_at: now,
          updated_at: now,
          started_at: null,
          finished_at: null,
          files: [],
        }

        jobIdRef.current = response.job_id
        setJobId(response.job_id)
        updateStatus(startedStatus)
        setPhase('processing')
        setIsPolling(true)
        setPollRun((run) => run + 1)
      } catch (error) {
        if (isAbortError(error)) return

        const shouldRecover =
          error instanceof ApiError &&
          (error.status === 409 || error.kind === 'timeout')

        if (shouldRecover) {
          try {
            const current = await getStatus(controller.signal)
            if (hasJobId(current) && current.status !== 'idle') {
              setRecoveryNotice(
                'An active transcription was found. Its progress is shown here.',
              )
              jobIdRef.current = current.job_id
              setJobId(current.job_id)
              updateStatus(current)

              if (current.status === 'completed') {
                setPhase('processing')
                await loadFiles()
              } else if (isTerminal(current.status)) {
                setPhase('failed')
              } else {
                setPhase('processing')
                setIsPolling(true)
                setPollRun((run) => run + 1)
              }
              return
            }
          } catch (recoveryError) {
            if (isAbortError(recoveryError)) return
          }
        }

        setSubmitError(apiErrorMessage(error, 'start'))
        setPhase('initial')
      } finally {
        if (submitController.current === controller) {
          setIsSubmitting(false)
          submitLock.current = false
        }
      }
    },
    [loadFiles, onNewJob, updateStatus],
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
    jobIdRef.current = null
    statusRef.current = initialStatus
    setPhase('initial')
    setStatus(initialStatus)
    setJobId(null)
    setFiles([])
    setIsSubmitting(false)
    setIsLoadingFiles(false)
    setIsPolling(false)
    setSubmitError(null)
    setPollError(null)
    setFilesError(null)
    setRecoveryNotice(null)
    setLastUrl('')
    onNewJob()
  }, [onNewJob])

  return {
    phase,
    status,
    jobId,
    files,
    isSubmitting,
    isLoadingFiles,
    submitError,
    pollError,
    filesError,
    recoveryNotice,
    start,
    retryStatus,
    retryJob,
    retryFiles: loadFiles,
    clearSubmitError,
    reset,
  }
}
