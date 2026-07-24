export type BackendJobStatus =
  | 'idle'
  | 'listing'
  | 'downloading'
  | 'transcribing'
  | 'waiting'
  | 'ready'
  | 'failed'

export type BackendFileStatus = 'completed' | 'failed'

export interface BackendFile {
  id: string
  name: string
  status: BackendFileStatus
  error?: string
}

export interface BackendStatusResponse {
  status: BackendJobStatus
  progress: number
  current: string | null
  error: string | null
  files: BackendFile[]
}

export interface ProcessResponse {
  status: 'started'
}

export interface FilesResponse {
  files: BackendFile[]
}

export interface FileContentResponse {
  id: string
  name: string
  srt: string
  text: string
}

export type TranscriptType = 'srt' | 'txt' | 'combined'
export type ExplorerFileStatus = 'ready' | 'failed'

export interface ExplorerFile {
  key: string
  backendId: string | null
  name: string
  type: TranscriptType
  status: ExplorerFileStatus
}

export type JobPhase = 'initial' | 'processing' | 'results' | 'failed'

export type ViewerState =
  | { status: 'idle'; content: null }
  | { status: 'loading'; content: null }
  | { status: 'ready'; content: string }
  | { status: 'error'; content: null; message: string }
