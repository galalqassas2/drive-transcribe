import { strToU8, zip } from 'fflate'

interface TranscriptArchiveEntry {
  name: string
  content: string
}

const reservedWindowsName = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])$/i

function safeStem(value: string, fallback: string) {
  const basename = value.split(/[\\/]/).pop() ?? ''
  const sanitized = [...basename]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127 ? ' ' : character
    })
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
  const stem = sanitized || fallback

  return reservedWindowsName.test(stem) ? `${stem}_` : stem
}

export function archiveFilename() {
  return 'transcripts.zip'
}

export function transcriptFilename(
  sourceName: string,
  usedNames: Set<string>,
) {
  const stem = safeStem(sourceName.replace(/\.srt$/i, ''), 'transcript')
  let name = `${stem}.txt`
  let suffix = 2

  while (usedNames.has(name.toLocaleLowerCase())) {
    name = `${stem} (${suffix}).txt`
    suffix += 1
  }

  usedNames.add(name.toLocaleLowerCase())
  return name
}

export function createTranscriptArchive(
  entries: TranscriptArchiveEntry[],
  signal: AbortSignal,
) {
  return new Promise<Blob>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The request was aborted', 'AbortError'))
      return
    }

    const files = Object.fromEntries(
      entries.map((entry) => [entry.name, strToU8(entry.content)]),
    )
    let terminate = () => {}

    const abort = () => {
      terminate()
      reject(new DOMException('The request was aborted', 'AbortError'))
    }

    signal.addEventListener('abort', abort, { once: true })
    terminate = zip(files, { level: 6 }, (error, data) => {
      signal.removeEventListener('abort', abort)

      if (error) {
        reject(error)
        return
      }

      const bytes = new Uint8Array(data.byteLength)
      bytes.set(data)
      resolve(new Blob([bytes], { type: 'application/zip' }))
    })
  })
}
