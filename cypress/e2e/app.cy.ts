import { strFromU8, unzipSync } from 'fflate'
import {
  DRIVE_URL,
  FILE_ID_A,
  FILE_ID_B,
  JOB_ID,
  activeJob,
  abandonedJob,
  cancelledJob,
  cancelResponse,
  completedJob,
  fileContent,
  filesResponse,
  jobsResponse,
  processResponse,
} from '../support/fixtures'

const inputLabel = 'Google Drive Folder Link'
const jsonHeaders = { 'content-type': 'application/json' }
const transcriptA = fileContent(FILE_ID_A, 'lecture-01')
const transcriptB = fileContent(FILE_ID_B, 'lecture-02')

function api(operation: string, query: Record<string, string> = {}) {
  return `/api/transcriber?${new URLSearchParams({
    operation,
    ...query,
  }).toString()}`
}

function json(body: unknown, statusCode = 200) {
  return { statusCode, headers: jsonHeaders, body }
}

function stubFolderName() {
  cy.intercept(
    'GET',
    api('folder_name', { drive_url: DRIVE_URL }),
    json({ name: 'Test Folder' }),
  ).as('folderName')
}

function stubStart() {
  cy.intercept('POST', api('process'), (request) => {
    expect(request.body).to.deep.equal({ drive_url: DRIVE_URL })
    request.reply(json(processResponse))
  }).as('process')
  stubFolderName()
}

function stubCompletedFlow() {
  stubStart()
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(completedJob),
  ).as('job')
  cy.intercept('GET', api('files'), json(filesResponse)).as('files')
}

function submitFolder() {
  cy.findByLabelText(inputLabel).type(DRIVE_URL)
  cy.findByRole('button', { name: 'Process' }).click()
}

function openFile(name: RegExp) {
  cy.findByRole('button', { name }).click()
}

beforeEach(() => {
  cy.viewport(1280, 800)
})

it('validates and submits a Drive folder URL', () => {
  cy.visit('/')
  cy.findByLabelText(inputLabel).type('not-a-drive-url')
  cy.findByRole('button', { name: 'Process' }).should('be.disabled')
  cy.findByText('Enter a Google Drive folder link.').should('be.visible')

  stubStart()
  const legacyActiveJob = {
    ...activeJob,
    files: activeJob.files.map((file) => {
      const legacyFile: Partial<typeof file> = { ...file }
      delete legacyFile.downloaded_bytes
      delete legacyFile.download_started_at
      delete legacyFile.download_finished_at
      return legacyFile
    }),
  }
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(legacyActiveJob),
  ).as('job')

  cy.findByLabelText(inputLabel).clear().type(DRIVE_URL)
  cy.findByRole('button', { name: 'Process' }).click()

  cy.wait('@process').its('request.method').should('equal', 'POST')
  cy.wait('@job')
  cy.findByRole('heading', { name: 'Working on It' }).should('be.visible')
  cy.findByRole('progressbar', { name: 'Transcription progress' })
    .should('have.attr', 'aria-valuenow', '40')
})

it('shows live download size, time, speed, and byte progress', () => {
  const downloadingJob = {
    ...activeJob,
    phase: 'downloading' as const,
    current_file: 'lecture-01.mp4',
    files: [
      {
        ...activeJob.files[0],
        status: 'downloading' as const,
        progress: 5,
        expected_size: 256 * 1024 * 1024,
        downloaded_bytes: 64 * 1024 * 1024,
        download_started_at: Date.now() / 1000 - 8,
        download_finished_at: null,
      },
      activeJob.files[1],
    ],
  }

  stubStart()
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(downloadingJob),
  ).as('job')

  cy.visit('/')
  submitFolder()
  cy.wait('@job')

  cy.findByRole('progressbar', {
    name: 'lecture-01.mp4 download progress',
  }).should('have.attr', 'aria-valuenow', '25')
  cy.findByText(/64\.0 MB of 256 MB · \d+s Elapsed · \d+\.\d MB\/s/)
    .should('be.visible')
})

it('opens TXT, SRT, and combined transcripts', () => {
  stubCompletedFlow()
  cy.intercept(
    'GET',
    api('file', { file_id: FILE_ID_A }),
    json(transcriptA),
  ).as('fileA')
  cy.intercept(
    'GET',
    api('combined', { format: 'txt', job_id: JOB_ID }),
    {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="combined.txt"',
      },
      body: `${transcriptA.text}${transcriptB.text}`,
    },
  ).as('combinedTxt')
  cy.intercept(
    'GET',
    api('combined', { format: 'srt', job_id: JOB_ID }),
    {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="combined.srt"',
      },
      body: `${transcriptA.srt}\n${transcriptB.srt}`,
    },
  ).as('combinedSrt')

  cy.visit('/')
  submitFolder()
  cy.wait('@files')

  cy.findByRole('list', { name: 'Transcript files' })
    .findAllByRole('listitem')
    .should('have.length', 6)

  openFile(/lecture-01\.txt/i)
  cy.wait('@fileA')
  cy.findByLabelText('lecture-01.txt transcript content')
    .should('have.text', transcriptA.text)

  openFile(/lecture-01\.srt/i)
  cy.findByLabelText('lecture-01.srt transcript content')
    .should('have.text', transcriptA.srt)

  openFile(/combined\.txt/i)
  cy.wait('@combinedTxt')
  cy.findByLabelText('combined.txt transcript content')
    .should('have.text', `${transcriptA.text}${transcriptB.text}`)

  openFile(/combined\.srt/i)
  cy.wait('@combinedSrt')
  cy.findByLabelText('combined.srt transcript content')
    .should('contain.text', transcriptB.srt.trim())
})

it('copies and downloads an open transcript', () => {
  stubCompletedFlow()
  cy.intercept(
    'GET',
    api('file', { file_id: FILE_ID_A }),
    json(transcriptA),
  ).as('fileA')

  cy.visit('/')
  submitFolder()
  cy.wait('@files')
  openFile(/lecture-01\.txt/i)
  cy.wait('@fileA')

  let downloadedBlob: Blob | undefined
  let downloadedName = ''

  cy.window().then((window) => {
    const writeText = cy.stub().resolves()
    cy.wrap(writeText).as('writeText')
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    cy.stub(window.URL, 'createObjectURL').callsFake((value) => {
      downloadedBlob = value as Blob
      return 'blob:test'
    })
    cy.stub(window.URL, 'revokeObjectURL')
    cy.stub(window.HTMLAnchorElement.prototype, 'click').callsFake(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download
    })
  })

  cy.findByRole('button', { name: 'Copy transcript' }).click()
  cy.get('@writeText').should('have.been.calledOnceWith', transcriptA.text)
  cy.findByText('Copied to Clipboard').should('be.visible')

  cy.findByRole('button', { name: 'Download transcript' }).click()
  cy.then(async () => {
    expect(downloadedName).to.equal('lecture-01.txt')
    expect(downloadedBlob).to.not.equal(undefined)
    expect(await downloadedBlob!.text()).to.equal(transcriptA.text)
  })
})

it('downloads all ready transcripts as a verified ZIP', () => {
  stubCompletedFlow()
  cy.intercept(
    'GET',
    api('files'),
    json({
      job_id: JOB_ID,
      files: [
        ...filesResponse.files,
        {
          file_index: 2,
          name: 'failed-recording.mp4',
          id: 'file-id-failed-003',
          status: 'failed',
          progress: 40,
          error: 'transcription failed',
          expected_size: null,
          downloaded_bytes: 0,
          download_started_at: null,
          download_finished_at: null,
        },
      ],
    }),
  ).as('files')
  cy.intercept(
    'GET',
    api('file', { file_id: FILE_ID_A }),
    json(transcriptA),
  ).as('fileA')
  cy.intercept(
    'GET',
    api('file', { file_id: FILE_ID_B }),
    json(transcriptB),
  ).as('fileB')

  cy.visit('/')
  submitFolder()
  cy.wait('@files')

  let downloadedBlob: Blob | undefined
  let downloadedName = ''

  cy.window().then((window) => {
    cy.stub(window.URL, 'createObjectURL').callsFake((value) => {
      downloadedBlob = value as Blob
      return 'blob:test'
    })
    cy.stub(window.URL, 'revokeObjectURL')
    cy.stub(window.HTMLAnchorElement.prototype, 'click').callsFake(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download
    })
  })

  cy.findByRole('button', {
    name: 'Download all 2 SRT transcripts as TXT files',
  }).click()
  cy.wait(['@fileA', '@fileB'])
  cy.findByText('2 Transcripts Downloaded').should('exist')
  cy.get('@folderName.all').should('have.length', 0)

  cy.then(async () => {
    expect(downloadedName).to.equal('transcripts.zip')
    expect(downloadedBlob).to.not.equal(undefined)

    const archive = unzipSync(
      new Uint8Array(await downloadedBlob!.arrayBuffer()),
    )
    expect(Object.keys(archive).sort()).to.deep.equal([
      'lecture-01.txt',
      'lecture-02.txt',
    ])
    expect(strFromU8(archive['lecture-01.txt'])).to.equal(transcriptA.srt)
    expect(strFromU8(archive['lecture-02.txt'])).to.equal(transcriptB.srt)
  })
})

it('cancels an active job', () => {
  stubStart()
  let cancelRequested = false

  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    (request) => {
      request.reply(json(cancelRequested ? cancelledJob : activeJob))
    },
  ).as('job')
  cy.intercept(
    'POST',
    api('cancel', { job_id: JOB_ID }),
    (request) => {
      cancelRequested = true
      request.reply(json(cancelResponse))
    },
  ).as('cancel')

  cy.visit('/')
  submitFolder()
  cy.wait('@job')
  cy.findByRole('button', { name: 'Cancel' }).click()

  cy.wait('@cancel').its('request.method').should('equal', 'POST')
  cy.wait('@job')
  cy.findByRole('heading', { name: 'Transcription Cancelled' })
    .should('be.visible')
})

it('retries a failed progress request', () => {
  stubStart()
  let pollCount = 0

  cy.intercept('GET', api('job', { job_id: JOB_ID }), (request) => {
    pollCount += 1
    request.reply(
      pollCount === 1
        ? json({ detail: 'invalid status request' }, 400)
        : json(completedJob),
    )
  }).as('job')
  cy.intercept('GET', api('files'), json(filesResponse)).as('files')

  cy.visit('/')
  submitFolder()
  cy.wait('@job')
  cy.findByText('Progress Paused').should('be.visible')

  cy.findByRole('button', { name: 'Retry' }).click()
  cy.wait('@job')
  cy.wait('@files')
  cy.findByRole('heading', { name: 'Transcripts', level: 2 })
    .should('be.visible')
})

it('recovers an active job after a start conflict', () => {
  cy.intercept(
    'POST',
    api('process'),
    json({ detail: 'job already active' }, 409),
  ).as('process')
  cy.intercept('GET', api('status'), json(activeJob)).as('status')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(activeJob),
  ).as('job')
  stubFolderName()

  cy.visit('/')
  submitFolder()
  cy.wait('@status')

  cy.findByText('Active Job Found').should('be.visible')
  cy.findByRole('heading', { name: 'Working on It' }).should('be.visible')
})

it('resets the completed workspace', () => {
  stubCompletedFlow()

  cy.visit('/')
  submitFolder()
  cy.wait('@files')
  cy.findByRole('button', { name: 'Process another folder' }).click()

  cy.findByLabelText(inputLabel).should('have.value', '')
  cy.findByRole('button', { name: 'Process' }).should('be.disabled')
})

it('loads history on demand and reuses the recent response', () => {
  let historyRequests = 0

  cy.intercept('GET', api('jobs'), (request) => {
    historyRequests += 1
    request.reply(json(jobsResponse))
  }).as('jobs')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.get('.app-sidebar .brand').should('have.length', 1)
  cy.get('.app-shell__content .brand').should('not.exist')

  cy.findByRole('complementary', { name: 'Sidebar' }).within(() => {
    cy.findByRole('button', { name: 'Search History' }).should('not.exist')
    cy.findByRole('heading', { name: 'History' }).should('be.visible')
    cy.findByRole('list', { name: 'Recent Transcriptions' })
      .findAllByRole('listitem')
      .should('have.length', 1)
    cy.findByRole('button', { name: 'Refresh History' }).click()
    cy.wait('@jobs')
    cy.findByRole('button', { name: 'Close Sidebar' }).click()
  })

  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.findByRole('heading', { name: 'History' }).should('be.visible')
  cy.then(() => expect(historyRequests).to.equal(2))
})

it('retries a failed history request', () => {
  let historyRequests = 0

  cy.intercept('GET', api('jobs'), (request) => {
    historyRequests += 1
    request.reply(
      historyRequests === 1
        ? json({ detail: 'Service unavailable' }, 503)
        : json(jobsResponse),
    )
  }).as('jobs')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('alert').within(() => {
    cy.findByText('Could Not Load History').should('be.visible')
    cy.findByRole('button', { name: 'Try Again' }).click()
  })
  cy.wait('@jobs')
  cy.findByRole('list', { name: 'Recent Transcriptions' }).should('be.visible')
  cy.then(() => expect(historyRequests).to.equal(2))
})

it('retries an interrupted history job by job ID', () => {
  const retriedJobId = 'bbccdd11223344aabbccdd11223344aa'
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json({ ...abandonedJob, folder_url: null }),
  ).as('historyJob')
  cy.intercept(
    'POST',
    api('retry', { job_id: JOB_ID }),
    json({ status: 'started', job_id: retriedJobId }),
  ).as('retry')
  cy.intercept(
    'GET',
    api('job', { job_id: retriedJobId }),
    json({ ...activeJob, job_id: retriedJobId, folder_url: null }),
  ).as('retriedJob')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Folder from/ }).click()
  cy.wait('@historyJob')
  cy.findByRole('button', { name: 'Try Again' }).click()
  cy.wait('@retry')
  cy.wait('@retriedJob')
  cy.findByRole('heading', { name: 'Working on It' }).should('be.visible')
})

it('shows an interrupted job retry failure', () => {
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json({ ...abandonedJob, folder_url: null }),
  ).as('historyJob')
  cy.intercept(
    'POST',
    api('retry', { job_id: JOB_ID }),
    json({ detail: 'Service unavailable' }, 503),
  ).as('retry')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Folder from/ }).click()
  cy.wait('@historyJob')
  cy.findByRole('button', { name: 'Try Again' }).click()
  cy.wait('@retry')
  cy.findByText('The transcription could not start. Check the link, then try again.')
    .should('be.visible')
})

it('freezes interrupted download timing and labels the file clearly', () => {
  const interrupted = {
    ...abandonedJob,
    folder_url: null,
    files: [
      {
        ...abandonedJob.files[0],
        status: 'downloading' as const,
        expected_size: 256 * 1024 * 1024,
        downloaded_bytes: 64 * 1024 * 1024,
        download_started_at: abandonedJob.finished_at! - 20,
        download_finished_at: null,
      },
    ],
  }
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(interrupted),
  ).as('historyJob')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Folder from/ }).click()
  cy.wait('@historyJob')
  cy.get('.processing-file__status').should('have.text', 'Interrupted')
  cy.findByText(/64\.0 MB of 256 MB .* 20s Elapsed/).should('be.visible')
  cy.wait(1100)
  cy.findByText(/20s Elapsed/).should('be.visible')
})

it('labels a failed history selection clearly', () => {
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json({ detail: 'Service unavailable' }, 503),
  ).as('historyJob')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Folder from/ }).click()
  cy.wait('@historyJob')
  cy.findByRole('alert').within(() => {
    cy.findByText('Could Not Open Job').should('be.visible')
    cy.findByRole('button', { name: 'Try Again' }).should('not.exist')
  })
})

it('opens a completed history job without requesting the latest file list', () => {
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')
  cy.intercept(
    'GET',
    api('job', { job_id: JOB_ID }),
    json(completedJob),
  ).as('historyJob')
  stubFolderName()

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Folder from/ }).click()
  cy.wait('@historyJob')
  cy.wait('@folderName')

  cy.findByRole('button', { name: /Test Folder/ }).should('be.visible')
  cy.findByRole('heading', { name: 'Transcripts', level: 2 }).should('be.visible')
  cy.findByRole('list', { name: 'Transcript files' })
    .findAllByRole('listitem')
    .should('have.length', 6)

  cy.reload()
  cy.findByRole('button', { name: 'Open Sidebar' }).click()
  cy.wait('@jobs')
  cy.findByRole('button', { name: /Test Folder/ }).should('be.visible')
})

it('closes the history sidebar with Escape on mobile', () => {
  cy.viewport(375, 667)
  cy.intercept('GET', api('jobs'), json(jobsResponse)).as('jobs')

  cy.visit('/')
  cy.findByRole('button', { name: 'Open Sidebar' })
    .then((button) => {
      const bounds = button[0].getBoundingClientRect()
      expect(bounds.width).to.be.at.least(44)
      expect(bounds.height).to.be.at.least(44)
    })
    .click()
  cy.wait('@jobs')
  cy.findByRole('complementary', { name: 'Sidebar' })
    .within(() => {
      cy.findByRole('heading', { name: 'History' }).should('be.visible')
      cy.findByRole('button', { name: 'Close Sidebar' }).then(
        (button) => {
          const bounds = button[0].getBoundingClientRect()
          expect(bounds.width).to.be.at.least(44)
          expect(bounds.height).to.be.at.least(44)
        },
      )
    })

  cy.get('body').type('{esc}')
  cy.get('.app-sidebar').should('not.have.attr', 'data-expanded')
  cy.findByRole('button', { name: 'Open Sidebar' })
    .should('have.focus')
})
