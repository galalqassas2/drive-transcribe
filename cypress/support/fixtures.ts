import type {
  BackendFile,
  BackendJob,
  CancelResponse,
  FileContentResponse,
  FilesResponse,
  JobsResponse,
  ProcessResponse,
} from '../../src/types'

export const JOB_ID = 'aabbccdd11223344aabbccdd11223344'
export const FILE_ID_A = 'file-id-alpha-001'
export const FILE_ID_B = 'file-id-bravo-002'
export const DRIVE_URL =
  'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

const timestamp = 1_700_000_000

const completedFiles: BackendFile[] = [
  {
    file_index: 0,
    name: 'lecture-01.mp4',
    id: FILE_ID_A,
    status: 'completed',
    progress: 100,
    error: null,
    expected_size: null,
    downloaded_bytes: 0,
    download_started_at: null,
    download_finished_at: null,
  },
  {
    file_index: 1,
    name: 'lecture-02.mp4',
    id: FILE_ID_B,
    status: 'completed',
    progress: 100,
    error: null,
    expected_size: null,
    downloaded_bytes: 0,
    download_started_at: null,
    download_finished_at: null,
  },
]

function job(overrides: Partial<BackendJob>): BackendJob {
  return {
    job_id: JOB_ID,
    folder_url: DRIVE_URL,
    status: 'active',
    phase: 'transcribing',
    progress: 40,
    current_file: 'lecture-01.mp4',
    error: null,
    cancel_requested: false,
    created_at: timestamp,
    updated_at: timestamp,
    started_at: timestamp,
    finished_at: null,
    files: [
      { ...completedFiles[0], status: 'transcribing', progress: 40 },
      { ...completedFiles[1], status: 'pending', progress: 0 },
    ],
    ...overrides,
  }
}

export const processResponse: ProcessResponse = {
  status: 'started',
  job_id: JOB_ID,
}

export const cancelResponse: CancelResponse = {
  status: 'cancellation_requested',
  job_id: JOB_ID,
}

export const activeJob = job({})

export const completedJob = job({
  status: 'completed',
  phase: 'ready',
  progress: 100,
  current_file: null,
  finished_at: timestamp + 60,
  files: completedFiles,
})

export const cancelledJob = job({
  status: 'cancelled',
  phase: 'cancelled',
  error: 'cancelled by user',
  cancel_requested: true,
  finished_at: timestamp + 30,
})

export const abandonedJob = job({
  status: 'abandoned',
  phase: 'abandoned',
  error: 'application stopped while job was active',
  finished_at: timestamp + 30,
})

export const filesResponse: FilesResponse = {
  job_id: JOB_ID,
  files: completedFiles,
}

export const jobsResponse: JobsResponse = {
  jobs: [
    {
      job_id: JOB_ID,
      status: completedJob.status,
      phase: completedJob.phase,
      progress: completedJob.progress,
      current_file: completedJob.current_file,
      error: completedJob.error,
      created_at: completedJob.created_at,
      updated_at: completedJob.updated_at,
      finished_at: completedJob.finished_at,
    },
  ],
}

export function fileContent(
  id: string,
  stem: string,
): FileContentResponse {
  return {
    id,
    name: `${stem}.mp4`,
    srt: `1\n00:00:00,000 --> 00:00:05,000\nHello from ${stem}.\n`,
    text: `Hello from ${stem}.\n`,
  }
}
