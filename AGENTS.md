# AGENTS.md - Codex Drive App (Drive Transcripts)

## Executive Overview & Purpose

**Codex Drive App** (branded as **Drive Transcripts**) is a web application built to convert public Google Drive folders containing audio and video media into downloadable text (`.txt`) and SubRip subtitle (`.srt`) transcripts, as well as concatenated multi-file aggregate transcripts.

The project employs a **Backend-For-Frontend (BFF)** architecture:
1. A single-page application (SPA) built with **React 19**, **TypeScript 6**, and **Vite 8**.
2. A **Vercel Serverless Function** API gateway (`api/transcriber.ts`) serving as a proxy layer.
3. An upstream microservice executing asynchronous media extraction and **Whisper speech-to-text** transcript generation.

---

## Architectural Overview

```
+-----------------------------------------------------------------------------------+
|                            React 19 SPA (Client Layer)                            |
|                                                                                   |
|  - StartView: Drive URL input validation & submission                             |
|  - ProcessingView: Real-time progress monitoring & job cancellation               |
|  - FileExplorer: Interactive transcript file tree with status indicators          |
|  - FileViewer: In-app transcript editor/previewer with copy & download            |
|  - useTranscriptionJob: Central job state machine, polling & error recovery       |
|  - transcriberApi: Type-safe REST client with runtime type guards                 |
|  - BoundedLruCache: In-memory LRU cache (8MB max) for transcript contents         |
+-----------------------------------------------------------------------------------+
                                          |
                HTTPS Calls: /api/transcriber?operation=<op>&...
                                          v
+-----------------------------------------------------------------------------------+
|                   Vercel Serverless Function Proxy Gateway                        |
|                           (api/transcriber.ts)                                    |
|                                                                                   |
|  - Input Validation: Drive URLs, 32-hex Job IDs, File IDs, parameters             |
|  - Secret Shielding: Injects TRANSCRIBER_API_KEY into upstream X-API-Key header   |
|  - Method & Query Whitelisting: Rejects invalid parameters & methods              |
|  - Security & Cache Control: Enforces `no-store` and `nosniff` headers            |
+-----------------------------------------------------------------------------------+
                                          |
             Upstream HTTPS REST Requests (X-API-Key Auth Header)
                                          v
+-----------------------------------------------------------------------------------+
|                       Remote Transcription Microservice                           |
|                                                                                   |
|  - Google Drive Folder Crawler & Asset Downloader                                 |
|  - Multi-Worker Audio/Video Extraction Engine                                     |
|  - Whisper Speech-to-Text Processing Pipeline                                     |
|  - Output Generator: Per-file TXT, per-file SubRip SRT, and Aggregate Combined     |
+-----------------------------------------------------------------------------------+
```

---

## Tech Stack & Tooling

| Layer / Aspect | Technology | Details |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19 (`react`, `react-dom`) | Functional components, custom hooks, StrictMode |
| **Build Tooling** | Vite 8 (`vite`, `@vitejs/plugin-react`) | HMR and bundle optimization |
| **Language** | TypeScript 6.0 | Strict type checking (`tsconfig.app.json`, `tsconfig.node.json`) |
| **Linter** | Oxlint (`oxlint`) | Rust-based JavaScript/TypeScript linter |
| **Styling & Theme** | Vanilla CSS (`src/index.css`) | Custom CSS variables design tokens, responsive layout |
| **Iconography & Fonts** | Lucide React & Manrope | `lucide-react`, `@fontsource-variable/manrope` |
| **Backend & Deployment** | Vercel Serverless Functions | `vercel.json` with 60s `maxDuration` & `supportsCancellation` |
| **Package Management** | pnpm (`pnpm-lock.yaml`) | Dependency tree management |

---

## Directory & File Structure

```
codex drive app/
├── api/
│   └── transcriber.ts       # Vercel Serverless proxy, validation & route dispatcher
├── src/
│   ├── assets/              # Static graphic assets
│   │   └── icons/
│   │       └── brand-drive.svg     # Brand logo SVG asset
│   ├── components/          # React UI components
│   │   ├── Brand.tsx               # Header branding element
│   │   ├── DriveProcessingIcon.tsx # Animated processing state graphic
│   │   ├── FileExplorer.tsx        # Sidebar file list with status badges
│   │   ├── FileViewer.tsx          # Transcript preview pane
│   │   ├── ProcessingView.tsx      # Real-time job monitor
│   │   ├── StartView.tsx           # Drive URL input form
│   │   └── TranscriptFileIcon.tsx  # Dynamic file icon renderer
│   ├── hooks/
│   │   └── useTranscriptionJob.ts  # Primary job hook: lifecycle, polling, recovery
│   ├── lib/
│   │   ├── boundedLruCache.ts      # Memory-bounded LRU cache for fetched transcripts
│   │   ├── transcriberApi.ts       # Typed API client & response type guards
│   │   └── transcriptionMessages.ts# Error message mapping utilities
│   ├── App.tsx              # Root app component coordinating view states
│   ├── index.css            # Central design tokens & layout styles
│   ├── main.tsx             # Application entry point
│   ├── types.ts             # TypeScript interface definitions
│   └── vite-env.d.ts        # Vite environment type declarations
├── .env.example             # Environment variable template
├── index.html               # Main HTML entry point
├── package.json             # NPM dependencies & scripts
├── tsconfig.json            # Main TypeScript configuration
├── tsconfig.app.json        # Frontend TypeScript config
├── tsconfig.node.json       # Node environment TypeScript config
├── vercel.json              # Vercel function configuration
└── vite.config.ts           # Vite build configuration
```

---

## Backend API Proxy Specification (`api/transcriber.ts`)

The backend gateway acts as a security firewall and protocol translator. Requests sent to `/api/transcriber?operation=<OP>` are dispatched according to the table below:

### Operation Endpoint Matrix

| Operation | Method | Upstream Path | Purpose | Query / Body Parameters |
| :--- | :--- | :--- | :--- | :--- |
| `health` | `GET` | `/health` | Check service health and disk storage metrics | None |
| `process` | `POST` | `/process` | Initiate folder transcription | JSON Body: `{ "drive_url": "<URL>" }` |
| `status` | `GET` | `/status` | Get status of currently active job or idle state | None |
| `jobs` | `GET` | `/jobs` | List historical jobs | None |
| `job` | `GET` | `/jobs/{job_id}` | Fetch detailed status & files for a specific job | `job_id` (32-hex string) |
| `retry` | `POST` | `/jobs/{job_id}/retry` | Start a new job from a terminal job's stored folder | `job_id` (32-hex string) |
| `cancel` | `POST` | `/jobs/{job_id}/cancel` | Cancel an active transcription job | `job_id` (32-hex string) |
| `files` | `GET` | `/files` | List generated output files | None |
| `file` | `GET` | `/files/{file_id}` | Fetch SRT and plain text contents for a file | `file_id` (max 512 chars) |
| `combined` | `GET` | `/combined` | Download combined aggregate transcript | `format` (`txt`\|`srt`), optional `job_id` |

### Security, Privacy & Validation Rules

1. **Google Drive URL Validation (`validateDriveUrl`)**:
   - Must be an HTTPS link targeting `drive.google.com` or `www.drive.google.com`.
   - Path must match `/folders/<FOLDER_ID>` or legacy `folderview?id=<ID>`.
   - Length capped at 2048 characters.
2. **Job ID Validation (`validateJobId`)**:
   - Must be a 32-character hexadecimal string (`/^[0-9a-f]{32}$/i`). Rejects invalid format with `422`.
3. **File ID Validation (`validateFileId`)**:
   - String length max 512 characters. Rejects control characters (code <= 31 or 127).
4. **Parameter Whitelisting (`assertAllowedParameters`)**:
   - Any query parameter outside `operation` and the operation's explicit whitelist triggers `400 Bad Request`.
5. **Security Headers**:
   - Injects `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on all outgoing responses.
6. **Authentication & Public Accessibility Note**:
   - Reads `TRANSCRIBER_UPSTREAM_URL` and `TRANSCRIBER_API_KEY` from process environment and injects `X-API-Key` into upstream calls.
   - **Privacy Notice**: Proxy endpoints (`/status`, `/jobs`, `/job`, `/files`, `/file`) are publicly reachable without user authentication. They can expose job metadata, folder URLs, file names, and transcript contents to anyone with the proxy URL. Adding an authentication layer (e.g. session auth, JWT, or API keys) is recommended if restricted access is required.

---

## Production Inspection

### Public Direct Backend Diagnostics (Mandatory)

Always inspect the upstream server directly at `https://2.24.138.173`. **Do not use the Vercel proxy (`drive-transcribe.vercel.app`) to diagnose backend state.**

The following read-only endpoints are intentionally public and require no API key, Hostinger login, or browser session:

| Endpoint | Purpose |
| :--- | :--- |
| `GET /health` | Service readiness, disk capacity, worker limits, and active Drive timeout settings |
| `GET /status` | Current active job, or idle state |
| `GET /jobs` | Recent job history and job IDs |
| `GET /jobs/{job_id}` | Per-file status, size, download progress, timing, and sanitized errors |
| `GET /diagnostics/latest` | Sanitized summary of the most recent job |

The raw-IP TLS certificate requires curl's `-k` option. Use `curl.exe` instead of PowerShell's `curl` alias on Windows:

```powershell
$upstream = "https://2.24.138.173"
curl.exe -fsS -k "$upstream/health"
curl.exe -fsS -k "$upstream/status"
curl.exe -fsS -k "$upstream/jobs"
curl.exe -fsS -k "$upstream/jobs/<job_id>"
curl.exe -fsS -k "$upstream/diagnostics/latest"
```

Do not load, request, or transmit `TRANSCRIBER_API_KEY` for these checks. A `401` from any endpoint above is a server regression.

### Protected API Boundary

Authentication remains required for state-changing operations and transcript contents, including `/process`, `/jobs/{job_id}/retry`, `/jobs/{job_id}/cancel`, `/files`, `/files/{file_id}`, and `/combined`. A `401` from those endpoints without an API key is expected. Do not weaken this boundary when changing diagnostics.

### Inspection Workflow

1. Query `/health`; require HTTP `200`, `ok: true`, and `accepting_jobs: true`. Check disk space, the 90% resource ceiling, worker counts, and Drive timeout settings.
2. Query `/status` to identify the active job. If idle, use `/jobs` to locate the relevant historical job ID.
3. Query `/jobs/{job_id}` and inspect each file's status, byte counts, elapsed time, speed, and error.
4. Compare at least two snapshots 30–60 seconds apart before declaring a job stalled.
5. Query `/diagnostics/latest` for a concise, sanitized summary suitable for reports or handoff to another agent.
6. Use browser Developer Tools only when investigating frontend polling or rendering; filter Network requests for `transcriber`.

### Operational Interpretation

- `0 B · elapsed` starts when a file enters the download stage, so it includes connection setup and retries; it does not mean bytes are being transferred.
- A healthy active download should show increasing `downloaded_bytes` across snapshots. Repeatedly unchanged bytes indicate a Drive request or retry problem.
- `waiting_resources` indicates resource throttle queues on the upstream service; processing resumes automatically when workers free up.
- `abandoned` means the service stopped while the job was active; the folder must be submitted again.
- `409` means another job is active or a result is not ready. `422` indicates invalid input. `507` indicates insufficient disk capacity.

### Google Drive Download Strategy

- Production uses `GOOGLE_DRIVE_BACKEND=hybrid` and `MAX_DOWNLOAD_WORKERS=1`.
- The service uses a 90% application ceiling, 360% CPU quota on four cores, 85% memory throttling, and a 90% hard memory limit.
- The authenticated Drive API lists folder contents and provides file size and MD5 metadata.
- Each file uses gdown 6.1 with resume first. After two failed or stalled attempts, the existing authenticated API downloader resumes the same file.
- A gdown attempt is stopped after 60 seconds without byte progress. Cancellation and disk reserve failures do not trigger fallback.
- Per-file diagnostics expose `download_backend` and `download_fallback_reason`. Transcript quality and output generation are unchanged.
- Roll back by restoring `/etc/drive-transcriber.env.before-hybrid-gdown-20260727` and `/opt/drive-transcriber/app.py.before-hybrid-gdown-20260727`, then restarting `drive-transcriber.service`.

### Runtime Logs and Privacy

- Public diagnostics expose filenames and operational progress, but redact Drive folder URLs, transcript contents, and secrets.
- Raw backend and kernel logs are not public. If public diagnostics are insufficient, an authorized Hostinger operator must inspect `journalctl` for the `drive-transcriber.service`.
- Proxy runtime logs require logging into an authorized Vercel account with access to the `drive-transcribe` project at `https://vercel.com/galalqassas2-8358s-projects/drive-transcribe/logs`.
- Never expose `TRANSCRIBER_API_KEY`, Drive URLs, or transcript text contents in external bug reports.

---

## State Machine & Client Data Lifecycle

### Job & File Status Enums

- **`BackendJobStatus`**: `'active'` | `'completed'` | `'failed'` | `'cancelled'` | `'abandoned'`
- **`BackendJobPhase`**:
  - Processing flow: `'queued'` → `'listing'` → `'waiting_resources'` → `'downloading'` → `'extracting'` → `'transcribing'` → `'writing'` → `'ready'`
  - Terminal states: `'failed'` | `'cancelled'` | `'abandoned'`
- **`BackendFileStatus`**: `'pending'` → `'downloading'` → `'extracting'` → `'transcribing'` → `'writing'` → `'completed'` (or `'failed'` / `'cancelled'`)

### Polling & Resilience (`useTranscriptionJob.ts`)

1. **Active Polling**: Polls `getJob(jobId)` every 2500ms while a job is active.
2. **Exponential Backoff**: On transient network or server errors (`408`, `429`, `>=500`, network timeout), retries with backoff up to 30,000ms.
3. **Job Recovery**:
   - If starting a job (`startJob`) returns `409 Conflict` (another job active) or times out, the hook queries `/status` to recover and attach to the active job.
4. **Explorer File Mapping**:
   - Each backend file creates two UI items (`.txt` and `.srt`). Upon job completion, aggregate `combined.txt` and `combined.srt` items are appended.

---

## In-Memory Caching (`src/lib/boundedLruCache.ts`)

- **Implementation**: Bounded Least Recently Used (LRU) cache using JavaScript `Map` insertion order.
- **Limits**: Maximum 6 entries or 8 MB total memory usage.
- **Eviction**: Evicts least recently accessed items when count or memory thresholds are reached.

---

## Environment Variables

Defined in host platform (e.g. Vercel Project Settings) or `.env.local`:

```env
# Full HTTPS origin of upstream service (no trailing slash, path, or credentials)
TRANSCRIBER_UPSTREAM_URL=<upstream-url>

# Secret API Key for upstream authentication
TRANSCRIBER_API_KEY=your_secret_api_key_here
```

---

## Development & Build Commands

```bash
# Start local Vite development server
pnpm dev

# Perform TypeScript compilation check and production build
pnpm build

# Run Oxlint across the project
pnpm lint

# Preview production build locally
pnpm preview
```

---

## Developer Guidelines

1. **Runtime Type Guards**: All external data from `/api/transcriber` must be validated through type guards in `src/lib/transcriberApi.ts`.
2. **Abort Signal Cleanup**: Always pass `AbortSignal` to asynchronous calls and abort pending requests on component unmount or state resets.
3. **API Protocol Modifications**: When adding operations, update `Operation` types, parameter whitelists, method lookups, and input validators in `api/transcriber.ts`.
4. **Oxlint Compliance**: Run `pnpm lint` and `pnpm build` before committing to maintain zero lint or type errors.
