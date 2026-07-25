import { ArrowRight, CircleAlert, Link2, LoaderCircle } from 'lucide-react'
import { useMemo, type FormEvent } from 'react'
import { Brand } from './Brand'

interface StartViewProps {
  value: string
  isSubmitting: boolean
  submitError: string | null
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}

function isDriveFolderLink(value: string) {
  try {
    const url = new URL(value.trim())
    const isDriveHost =
      url.hostname === 'drive.google.com' || url.hostname === 'www.drive.google.com'
    if (url.protocol !== 'https:' || !isDriveHost) return false

    const segments = url.pathname.split('/').filter(Boolean)
    const folderIndex = segments.indexOf('folders')
    const hasFolderPath = folderIndex >= 0 && Boolean(segments[folderIndex + 1])
    const hasLegacyId = url.pathname.includes('folderview') && Boolean(url.searchParams.get('id'))

    return hasFolderPath || hasLegacyId
  } catch {
    return false
  }
}

export function StartView({
  value,
  isSubmitting,
  submitError,
  onChange,
  onSubmit,
}: StartViewProps) {
  const trimmedValue = value.trim()
  const isValid = useMemo(() => isDriveFolderLink(trimmedValue), [trimmedValue])
  const showFormatError = trimmedValue.length > 0 && !isValid
  const fieldError = showFormatError ? 'Enter a Google Drive folder link.' : null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isValid && !isSubmitting) onSubmit(trimmedValue)
  }

  return (
    <main className="start-page">
      <header className="site-header">
        <Brand />
      </header>

      <section className="start-hero" aria-labelledby="start-title">
        <div className="start-hero__intro">
          <h1 id="start-title">Transcribe a Drive folder</h1>
          <p>Paste a public folder. Get subtitle and text files.</p>
        </div>

        <form className="start-form" onSubmit={submit} noValidate>
          <label htmlFor="drive-folder">Google Drive folder link</label>
          <div className="start-form__row">
            <div className="input-shell" data-invalid={Boolean(fieldError) || undefined}>
              <Link2 aria-hidden="true" />
              <input
                id="drive-folder"
                name="drive_url"
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck="false"
                placeholder="https://drive.google.com/drive/folders/..."
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-invalid={Boolean(fieldError)}
                aria-describedby="drive-folder-help drive-folder-error"
                required
              />
            </div>

            <button
              className="primary-button"
              type="submit"
              disabled={!isValid || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="spin" aria-hidden="true" />
                  starting
                </>
              ) : (
                <>
                  process
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </button>
          </div>

          <div className="form-message-row">
            <p id="drive-folder-help" className="field-help">
              Public folders only. Audio and video files are supported.
            </p>
            <p id="drive-folder-error" className="field-error" aria-live="polite">
              {fieldError}
            </p>
          </div>

          {submitError && (
            <div className="inline-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>Could not start</strong>
                <p>{submitError}</p>
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  )
}
