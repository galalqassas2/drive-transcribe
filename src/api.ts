import type {
  BackendFile,
  BackendJobStatus,
  BackendStatusResponse,
  FileContentResponse,
  FilesResponse,
  ProcessResponse,
} from './types'

type ApiErrorKind = 'configuration' | 'network' | 'response'

const jobStatuses = new Set<BackendJobStatus>([
  'idle',
  'listing',
  'downloading',
  'transcribing',
  'waiting',
  'ready',
  'failed',
])

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

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

function endpoint(path: string) {
  if (!baseUrl) {
    throw new ApiError('API base URL is not configured', undefined, 'configuration')
  }

  return `${baseUrl}${path}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFile(value: unknown): BackendFile {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.status !== 'completed' && value.status !== 'failed')
  ) {
    throw new ApiError('The API returned invalid file metadata')
  }

  return {
    id: value.id,
    name: value.name,
    status: value.status,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

async function readError(response: Response) {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.detail === 'string') {
      return payload.detail
    }
  } catch {
    return `Request failed with status ${response.status}`
  }

  return `Request failed with status ${response.status}`
}

async function request(path: string, init: RequestInit = {}) {
  try {
    return await fetch(endpoint(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }

    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError('The API could not be reached', undefined, 'network')
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError('The API returned an unexpected response')
  }

  try {
    return await response.json()
  } catch {
    throw new ApiError('The API returned invalid JSON')
  }
}

export async function startProcess(driveUrl: string, signal?: AbortSignal): Promise<ProcessResponse> {
  const response = await request('/process', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ drive_url: driveUrl }),
  })
  const payload = await jsonResponse(response)

  if (!isRecord(payload) || payload.status !== 'started') {
    throw new ApiError('The API did not start the transcription job')
  }

  return { status: 'started' }
}

export async function getStatus(signal?: AbortSignal): Promise<BackendStatusResponse> {
  const response = await request('/status', { signal })
  const payload = await jsonResponse(response)

  if (
    !isRecord(payload) ||
    typeof payload.status !== 'string' ||
    !jobStatuses.has(payload.status as BackendJobStatus) ||
    typeof payload.progress !== 'number' ||
    !Number.isFinite(payload.progress) ||
    !(payload.current === null || typeof payload.current === 'string') ||
    !(payload.error === null || typeof payload.error === 'string') ||
    !Array.isArray(payload.files)
  ) {
    throw new ApiError('The API returned an invalid status response')
  }

  return {
    status: payload.status as BackendJobStatus,
    progress: payload.progress,
    current: payload.current,
    error: payload.error,
    files: payload.files.map(parseFile),
  }
}

export async function getFiles(signal?: AbortSignal): Promise<FilesResponse> {
  const response = await request('/files', { signal })
  const payload = await jsonResponse(response)

  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    throw new ApiError('The API returned an invalid file list')
  }

  return { files: payload.files.map(parseFile) }
}

export async function getFileContent(
  fileId: string,
  signal?: AbortSignal,
): Promise<FileContentResponse> {
  const response = await request(`/files/${encodeURIComponent(fileId)}`, { signal })
  const payload = await jsonResponse(response)

  if (
    !isRecord(payload) ||
    typeof payload.id !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.srt !== 'string' ||
    typeof payload.text !== 'string'
  ) {
    throw new ApiError('The API returned invalid transcript content')
  }

  return {
    id: payload.id,
    name: payload.name,
    srt: payload.srt,
    text: payload.text,
  }
}

export async function getCombined(signal?: AbortSignal): Promise<string> {
  const response = await request('/combined', {
    signal,
    headers: { Accept: 'text/plain' },
  })

  if (!response.ok) {
    throw new ApiError(await readError(response), response.status)
  }

  return response.text()
}
