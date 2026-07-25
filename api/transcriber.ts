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

type UpstreamRequest = {
  method: 'GET' | 'POST'
  path: string
  accept: string
  body?: string
}

const operations = new Set<Operation>([
  'health',
  'process',
  'status',
  'jobs',
  'job',
  'cancel',
  'files',
  'file',
  'combined',
])

const methods: Record<Operation, 'GET' | 'POST'> = {
  health: 'GET',
  process: 'POST',
  status: 'GET',
  jobs: 'GET',
  job: 'GET',
  cancel: 'POST',
  files: 'GET',
  file: 'GET',
  combined: 'GET',
}

const jobIdPattern = /^[0-9a-f]{32}$/i

class RequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function errorResponse(status: number, detail: string, allow?: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })

  if (allow) {
    headers.set('Allow', allow)
  }

  return Response.json({ detail }, { status, headers })
}

function readOperation(params: URLSearchParams): Operation {
  const values = params.getAll('operation')

  if (values.length !== 1 || !operations.has(values[0] as Operation)) {
    throw new RequestError(400, 'A supported operation is required')
  }

  return values[0] as Operation
}

function readParameter(params: URLSearchParams, name: string, required: boolean) {
  const values = params.getAll(name)

  if (values.length > 1 || (required && values.length !== 1)) {
    throw new RequestError(400, `${name} is invalid`)
  }

  return values[0] ?? null
}

function assertAllowedParameters(params: URLSearchParams, allowed: readonly string[]) {
  const allowedSet = new Set(['operation', ...allowed])

  for (const name of params.keys()) {
    if (!allowedSet.has(name)) {
      throw new RequestError(400, `${name} is not supported`)
    }
  }
}

function validateJobId(value: string | null) {
  if (!value || !jobIdPattern.test(value)) {
    throw new RequestError(422, 'job_id must be a 32-character hexadecimal value')
  }

  return value
}

function validateFileId(value: string | null) {
  const hasControlCharacter =
    value && [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })

  if (!value || value.length > 512 || hasControlCharacter) {
    throw new RequestError(422, 'file_id is invalid')
  }

  return value
}

function validateDriveUrl(value: unknown) {
  if (typeof value !== 'string') {
    throw new RequestError(422, 'A Google Drive folder link is required')
  }

  const driveUrl = value.trim()

  if (!driveUrl || driveUrl.length > 2048) {
    throw new RequestError(422, 'The Google Drive folder link is invalid')
  }

  try {
    const url = new URL(driveUrl)
    const isDriveHost =
      url.hostname === 'drive.google.com' || url.hostname === 'www.drive.google.com'
    const hasFolderPath = /\/folders\/[^/]+/.test(url.pathname)
    const hasLegacyFolder =
      url.pathname.includes('folderview') && Boolean(url.searchParams.get('id'))

    if (
      url.protocol !== 'https:' ||
      !isDriveHost ||
      (!hasFolderPath && !hasLegacyFolder)
    ) {
      throw new Error()
    }
  } catch {
    throw new RequestError(422, 'The Google Drive folder link is invalid')
  }

  return driveUrl
}

async function createUpstreamRequest(
  request: Request,
  operation: Operation,
  params: URLSearchParams,
): Promise<UpstreamRequest> {
  switch (operation) {
    case 'health':
      assertAllowedParameters(params, [])
      return { method: 'GET', path: '/health', accept: 'application/json' }
    case 'process': {
      assertAllowedParameters(params, [])
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new RequestError(415, 'Content-Type must be application/json')
      }

      let payload: unknown
      try {
        payload = await request.json()
      } catch {
        throw new RequestError(400, 'The request body must be valid JSON')
      }

      const driveUrl =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? validateDriveUrl((payload as Record<string, unknown>).drive_url)
          : validateDriveUrl(undefined)

      return {
        method: 'POST',
        path: '/process',
        accept: 'application/json',
        body: JSON.stringify({ drive_url: driveUrl }),
      }
    }
    case 'status':
      assertAllowedParameters(params, [])
      return { method: 'GET', path: '/status', accept: 'application/json' }
    case 'jobs':
      assertAllowedParameters(params, [])
      return { method: 'GET', path: '/jobs', accept: 'application/json' }
    case 'job': {
      assertAllowedParameters(params, ['job_id'])
      const jobId = validateJobId(readParameter(params, 'job_id', true))
      return { method: 'GET', path: `/jobs/${jobId}`, accept: 'application/json' }
    }
    case 'cancel': {
      assertAllowedParameters(params, ['job_id'])
      const jobId = validateJobId(readParameter(params, 'job_id', true))
      return { method: 'POST', path: `/jobs/${jobId}/cancel`, accept: 'application/json' }
    }
    case 'files':
      assertAllowedParameters(params, [])
      return { method: 'GET', path: '/files', accept: 'application/json' }
    case 'file': {
      assertAllowedParameters(params, ['file_id'])
      const fileId = validateFileId(readParameter(params, 'file_id', true))
      return {
        method: 'GET',
        path: `/files/${encodeURIComponent(fileId)}`,
        accept: 'application/json',
      }
    }
    case 'combined': {
      assertAllowedParameters(params, ['job_id'])
      const value = readParameter(params, 'job_id', false)
      const query = value ? `?job_id=${encodeURIComponent(validateJobId(value))}` : ''
      return {
        method: 'GET',
        path: `/combined${query}`,
        accept: 'text/plain, application/octet-stream',
      }
    }
  }
}

function readConfiguration() {
  const upstreamValue = process.env.TRANSCRIBER_UPSTREAM_URL?.trim()
  const apiKey = process.env.TRANSCRIBER_API_KEY?.trim()

  if (!upstreamValue || !apiKey) {
    return null
  }

  try {
    const upstream = new URL(upstreamValue)
    if (
      upstream.protocol !== 'https:' ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== '/' ||
      upstream.search ||
      upstream.hash
    ) {
      return null
    }

    return { apiKey, baseUrl: upstream.origin }
  } catch {
    return null
  }
}

async function handle(request: Request) {
  const url = new URL(request.url)
  let operation: Operation
  let upstreamRequest: UpstreamRequest

  try {
    operation = readOperation(url.searchParams)
    const expectedMethod = methods[operation]

    if (request.method !== expectedMethod) {
      return errorResponse(405, 'Method not allowed', expectedMethod)
    }

    upstreamRequest = await createUpstreamRequest(request, operation, url.searchParams)
  } catch (error) {
    if (error instanceof RequestError) {
      return errorResponse(error.status, error.message)
    }

    return errorResponse(400, 'The request is invalid')
  }

  const configuration = readConfiguration()
  if (!configuration) {
    return errorResponse(500, 'The transcription service is not configured')
  }

  const headers = new Headers({
    Accept: upstreamRequest.accept,
    'X-API-Key': configuration.apiKey,
  })

  if (upstreamRequest.body) {
    headers.set('Content-Type', 'application/json')
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${configuration.baseUrl}${upstreamRequest.path}`, {
      method: upstreamRequest.method,
      headers,
      body: upstreamRequest.body,
      redirect: 'error',
      signal: request.signal,
    })
  } catch {
    return errorResponse(502, 'The transcription service could not be reached')
  }

  const responseHeaders = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  for (const name of ['Content-Type', 'Content-Disposition']) {
    const value = upstreamResponse.headers.get(name)
    if (value) {
      responseHeaders.set(name, value)
    }
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export default {
  fetch: handle,
}
