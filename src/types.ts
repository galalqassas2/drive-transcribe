export type BackendJobStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'abandoned'

export type BackendJobPhase =
  | 'queued'
  | 'listing'
  | 'waiting_resources'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'writing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'abandoned'

export type BackendFileStatus =
  | 'pending'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'writing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface HealthResponse {
  ok: boolean
  free_disk_gb: number
  reserve_disk_gb: number
  accepting_jobs: boolean
  max_video_workers: number
  resource_limit_percent: number
}

export interface BackendFile {
  file_index: number
  name: string
  id: string
  status: BackendFileStatus
  progress: number
  error: string | null
  expected_size: number | null
}

export interface BackendJob {
  job_id: string
  folder_url: string
  status: BackendJobStatus
  phase: BackendJobPhase
  progress: number
  current_file: string | null
  error: string | null
  cancel_requested: boolean
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  files: BackendFile[]
}

export interface IdleStatusResponse {
  status: 'idle'
  phase: 'idle'
  progress: 0
  current_file: null
  error: null
  files: []
}

export type BackendStatusResponse = BackendJob | IdleStatusResponse
export type JobStatusResponse = BackendStatusResponse

export interface BackendJobSummary {
  job_id: string
  status: BackendJobStatus
  phase: BackendJobPhase
  progress: number
  current_file: string | null
  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

export interface ProcessResponse {
  status: 'started'
  job_id: string
}

export interface CancelResponse {
  status: 'cancellation_requested'
  job_id: string
}

export interface JobsResponse {
  jobs: BackendJobSummary[]
}

export type FilesResponse =
  | { files: BackendFile[] }
  | { job_id: string; files: BackendFile[] }

export interface FileContentResponse {
  id: string
  name: string
  srt: string
  text: string
}

export interface CombinedDownload {
  blob: Blob
  filename: string
}

export type TranscriptType = 'srt' | 'txt' | 'combined'
export type ExplorerFileStatus = 'ready' | 'failed'

export interface ExplorerFile {
  key: string
  backendId: string | null
  name: string
  type: TranscriptType
  status: ExplorerFileStatus
  error?: string
}

export type AppPhase = 'initial' | 'processing' | 'results' | 'failed'
export type JobPhase = AppPhase

export type ViewerState =
  | { status: 'idle'; content: null }
  | { status: 'loading'; content: null }
  | { status: 'ready'; content: string; fileName?: string }
  | { status: 'error'; content: null; message: string }
