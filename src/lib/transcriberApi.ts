import type {
  BackendFile,
  BackendFileStatus,
  BackendJob,
  BackendJobPhase,
  BackendJobStatus,
  BackendJobSummary,
  BackendStatusResponse,
  CancelResponse,
  CombinedDownload,
  DriveFolderResponse,
  FileContentResponse,
  FilesResponse,
  HealthResponse,
  JobsResponse,
  ProcessResponse,
} from '../types'

export type ApiErrorKind = 'network' | 'timeout' | 'response' | 'validation'
export type CombinedFormat = 'srt' | 'txt'

type Operation =
  | 'health'
  | 'process'
  | 'status'
  | 'jobs'
  | 'job'
  | 'cancel'
  | 'files'
  | 'file'
  | 'combined'
  | 'folder_name'

type QueryValue = string | undefined

const API_PATH = '/api/transcriber'
const DEFAULT_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const jobIdPattern = /^[a-f0-9]{32}$/i

const jobStatuses = new Set<BackendJobStatus>([
  'active',
  'completed',
  'failed',
  'cancelled',
  'abandoned',
])

const jobPhases = new Set<BackendJobPhase>([
  'queued',
  'listing',
  'waiting_resources',
  'downloading',
  'extracting',
  'transcribing',
  'writing',
  'ready',
  'failed',
  'cancelled',
  'abandoned',
])

const fileStatuses = new Set<BackendFileStatus>([
  'pending',
  'downloading',
  'extracting',
  'transcribing',
  'writing',
  'completed',
  'failed',
  'cancelled',
])

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: ApiErrorKind = 'response',
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && jobIdPattern.test(value)
}

function invalidResponse(message: string): never {
  throw new ApiError(message)
}

function requireJobId(jobId: string) {
  if (!isJobId(jobId)) {
    throw new ApiError('Job ID must be a 32-character hexadecimal value', undefined, 'validation')
  }
}

function endpoint(operation: Operation, query: Record<string, QueryValue> = {}) {
  const params = new URLSearchParams({ operation })

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value)
  }

  return `${API_PATH}?${params.toString()}`
}

function validationMessage(detail: unknown) {
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return null

  const messages = detail.flatMap((entry) =>
    isRecord(entry) && typeof entry.msg === 'string' ? [entry.msg] : [],
  )

  return messages.length > 0 ? messages.join('. ') : null
}

async function readError(response: Response) {
  const fallback = `Request failed with status ${response.status}`

  try {
    const text = await response.text()
    if (!text) return fallback

    const payload: unknown = JSON.parse(text)
    if (!isRecord(payload)) return fallback

    return validationMessage(payload.detail) ?? fallback
  } catch {
    return fallback
  }
}

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    invalidResponse('The API returned an unexpected response')
  }

  try {
    return (await response.json()) as unknown
  } catch {
    return invalidResponse('The API returned invalid JSON')
  }
}

async function request<T>(
  operation: Operation,
  parse: (response: Response) => Promise<T>,
  {
    query,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...init
  }: RequestInit & {
    query?: Record<string, QueryValue>
    timeoutMs?: number
  } = {},
) {
  const controller = new AbortController()
  let timedOut = false

  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(endpoint(operation, query), {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new ApiError(await readError(response), response.status)
    }

    return await parse(response)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) {
      throw new ApiError('The request timed out', undefined, 'timeout')
    }
    if (signal?.aborted) {
      throw new DOMException('The request was aborted', 'AbortError')
    }

    throw new ApiError('The transcription service could not be reached', undefined, 'network')
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

function parseHealth(value: unknown): HealthResponse {
  if (
    !isRecord(value) ||
    typeof value.ok !== 'boolean' ||
    !isFiniteNumber(value.free_disk_gb) ||
    !isFiniteNumber(value.reserve_disk_gb) ||
    typeof value.accepting_jobs !== 'boolean' ||
    !isFiniteNumber(value.max_video_workers) ||
    !isFiniteNumber(value.resource_limit_percent)
  ) {
    return invalidResponse('The API returned invalid health information')
  }

  return {
    ok: value.ok,
    free_disk_gb: value.free_disk_gb,
    reserve_disk_gb: value.reserve_disk_gb,
    accepting_jobs: value.accepting_jobs,
    max_video_workers: value.max_video_workers,
    resource_limit_percent: value.resource_limit_percent,
  }
}

function parseFile(value: unknown): BackendFile {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.file_index) ||
    !isFiniteNumber(value.file_index) ||
    typeof value.name !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    !fileStatuses.has(value.status as BackendFileStatus) ||
    !isFiniteNumber(value.progress) ||
    !isNullableString(value.error) ||
    !isNullableNumber(value.expected_size)
  ) {
    return invalidResponse('The API returned invalid file metadata')
  }

  return {
    file_index: value.file_index,
    name: value.name,
    id: value.id,
    status: value.status as BackendFileStatus,
    progress: value.progress,
    error: value.error,
    expected_size: value.expected_size,
  }
}

function parseJob(value: unknown): BackendJob {
  if (
    !isRecord(value) ||
    !isJobId(value.job_id) ||
    typeof value.folder_url !== 'string' ||
    typeof value.status !== 'string' ||
    !jobStatuses.has(value.status as BackendJobStatus) ||
    typeof value.phase !== 'string' ||
    !jobPhases.has(value.phase as BackendJobPhase) ||
    !isFiniteNumber(value.progress) ||
    !isNullableString(value.current_file) ||
    !isNullableString(value.error) ||
    typeof value.cancel_requested !== 'boolean' ||
    !isFiniteNumber(value.created_at) ||
    !isFiniteNumber(value.updated_at) ||
    !isNullableNumber(value.started_at) ||
    !isNullableNumber(value.finished_at) ||
    !Array.isArray(value.files)
  ) {
    return invalidResponse('The API returned invalid job information')
  }

  return {
    job_id: value.job_id,
    folder_url: value.folder_url,
    status: value.status as BackendJobStatus,
    phase: value.phase as BackendJobPhase,
    progress: value.progress,
    current_file: value.current_file,
    error: value.error,
    cancel_requested: value.cancel_requested,
    created_at: value.created_at,
    updated_at: value.updated_at,
    started_at: value.started_at,
    finished_at: value.finished_at,
    files: value.files.map(parseFile),
  }
}

function parseStatus(value: unknown): BackendStatusResponse {
  if (
    isRecord(value) &&
    value.status === 'idle' &&
    value.phase === 'idle' &&
    value.progress === 0 &&
    Array.isArray(value.files) &&
    value.files.length === 0
  ) {
    return {
      status: 'idle',
      phase: 'idle',
      progress: 0,
      current_file: null,
      error: null,
      files: [],
    }
  }

  return parseJob(value)
}

function parseJobSummary(value: unknown): BackendJobSummary {
  if (
    !isRecord(value) ||
    !isJobId(value.job_id) ||
    typeof value.status !== 'string' ||
    !jobStatuses.has(value.status as BackendJobStatus) ||
    typeof value.phase !== 'string' ||
    !jobPhases.has(value.phase as BackendJobPhase) ||
    !isFiniteNumber(value.progress) ||
    !isNullableString(value.current_file) ||
    !isNullableString(value.error) ||
    !isFiniteNumber(value.created_at) ||
    !isFiniteNumber(value.updated_at) ||
    !isNullableNumber(value.finished_at)
  ) {
    return invalidResponse('The API returned invalid job metadata')
  }

  return {
    job_id: value.job_id,
    status: value.status as BackendJobStatus,
    phase: value.phase as BackendJobPhase,
    progress: value.progress,
    current_file: value.current_file,
    error: value.error,
    created_at: value.created_at,
    updated_at: value.updated_at,
    finished_at: value.finished_at,
  }
}

function parseProcess(value: unknown): ProcessResponse {
  if (!isRecord(value) || value.status !== 'started' || !isJobId(value.job_id)) {
    return invalidResponse('The API did not return a valid job')
  }

  return { status: 'started', job_id: value.job_id }
}

function parseCancel(value: unknown): CancelResponse {
  if (
    !isRecord(value) ||
    value.status !== 'cancellation_requested' ||
    !isJobId(value.job_id)
  ) {
    return invalidResponse('The API did not confirm cancellation')
  }

  return { status: 'cancellation_requested', job_id: value.job_id }
}

function parseJobs(value: unknown): JobsResponse {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    return invalidResponse('The API returned an invalid job list')
  }

  return { jobs: value.jobs.map(parseJobSummary) }
}

function parseFiles(value: unknown): FilesResponse {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return invalidResponse('The API returned an invalid file list')
  }

  const files = value.files.map(parseFile)
  if (!Object.hasOwn(value, 'job_id')) return { files }
  if (!isJobId(value.job_id)) {
    return invalidResponse('The API returned an invalid file list')
  }

  return { job_id: value.job_id, files }
}

function parseFileContent(value: unknown): FileContentResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.srt !== 'string' ||
    typeof value.text !== 'string'
  ) {
    return invalidResponse('The API returned invalid transcript content')
  }

  return {
    id: value.id,
    name: value.name,
    srt: value.srt,
    text: value.text,
  }
}

function parseDriveFolder(value: unknown): DriveFolderResponse {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) {
    return invalidResponse('The API returned an invalid folder name')
  }

  return { name: value.name.trim() }
}

function safeFilename(value: string) {
  const filename = value.split(/[\\/]/).pop()
  if (!filename) return undefined

  return [...filename]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
}

function dispositionFilename(value: string | null) {
  if (!value) return null

  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      const filename = safeFilename(decodeURIComponent(encoded.replace(/^"|"$/g, '')))
      if (filename) return filename
    } catch {
      // Fall back to the basic filename parameter.
    }
  }

  const basic = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
  return safeFilename((basic?.[1] ?? basic?.[2] ?? '').trim()) || null
}

async function jsonRequest<T>(
  operation: Operation,
  parser: (value: unknown) => T,
  options?: Parameters<typeof request<T>>[2],
) {
  return request(operation, async (response) => parser(await readJson(response)), {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options?.headers,
    },
  })
}

export function health(signal?: AbortSignal) {
  return jsonRequest('health', parseHealth, { signal })
}

export function startJob(driveUrl: string, signal?: AbortSignal) {
  if (!driveUrl.trim()) {
    throw new ApiError('Drive folder URL is required', undefined, 'validation')
  }

  return jsonRequest('process', parseProcess, {
    method: 'POST',
    signal,
    timeoutMs: START_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drive_url: driveUrl.trim() }),
  })
}

export function getStatus(signal?: AbortSignal) {
  return jsonRequest('status', parseStatus, { signal })
}

export function listJobs(signal?: AbortSignal) {
  return jsonRequest('jobs', parseJobs, { signal })
}

export function getJob(jobId: string, signal?: AbortSignal) {
  requireJobId(jobId)
  return jsonRequest('job', parseJob, {
    query: { job_id: jobId },
    signal,
  })
}

export function cancelJob(jobId: string, signal?: AbortSignal) {
  requireJobId(jobId)
  return jsonRequest('cancel', parseCancel, {
    method: 'POST',
    query: { job_id: jobId },
    signal,
  })
}

export function listFiles(signal?: AbortSignal) {
  return jsonRequest('files', parseFiles, { signal })
}

export function getFile(fileId: string, signal?: AbortSignal) {
  const normalizedId = fileId.trim()
  if (!normalizedId) {
    throw new ApiError('File ID is required', undefined, 'validation')
  }

  return jsonRequest('file', parseFileContent, {
    query: { file_id: normalizedId },
    signal,
  })
}

export function getDriveFolderName(driveUrl: string, signal?: AbortSignal) {
  const normalizedUrl = driveUrl.trim()
  if (!normalizedUrl) {
    throw new ApiError('Drive URL is required', undefined, 'validation')
  }

  return jsonRequest('folder_name', parseDriveFolder, {
    query: { drive_url: normalizedUrl },
    signal,
  })
}

export function downloadCombined(
  format: CombinedFormat,
  jobId?: string,
  signal?: AbortSignal,
) {
  if (jobId !== undefined) requireJobId(jobId)

  return request<CombinedDownload>(
    'combined',
    async (response) => ({
      blob: await response.blob(),
      filename:
        dispositionFilename(response.headers.get('content-disposition')) ??
        `combined.${format}`,
    }),
    {
      query: { format, job_id: jobId },
      signal,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      headers: {
        Accept:
          format === 'srt'
            ? 'application/x-subrip, text/plain;q=0.9'
            : 'text/plain',
      },
    },
  )
}
