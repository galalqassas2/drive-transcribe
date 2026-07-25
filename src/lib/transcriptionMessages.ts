function normalized(message: string | null) {
  return message?.trim().toLowerCase() ?? ''
}

export function jobErrorMessage(message: string | null) {
  const value = normalized(message)
  const failedCount = value.match(/^(\d+) file\(s\) failed/)

  if (failedCount) {
    const count = Number(failedCount[1])
    return `${count} ${count === 1 ? 'file could' : 'files could'} not be transcribed. Other completed files are ready.`
  }
  if (value.includes('drive_url') || value.includes('google drive folder')) {
    return 'The link is not a valid public Google Drive folder.'
  }
  if (value.includes('no supported media')) {
    return 'No supported audio or video files were found in this folder.'
  }
  if (value.includes('disk') || value.includes('reserve')) {
    return 'The server needs more free disk space before it can continue.'
  }
  if (value.includes('cancel')) {
    return 'This transcription was cancelled before it finished.'
  }
  if (value.includes('stopped') || value.includes('abandoned')) {
    return 'The server stopped while this transcription was active.'
  }

  return 'The transcription stopped before it finished. Try again or choose another folder.'
}

export function fileErrorMessage(message: string | null) {
  const value = normalized(message)

  if (value.includes('cancel')) {
    return 'Transcription was cancelled.'
  }
  if (
    value.includes('download') ||
    value.includes('google drive') ||
    value.includes('file size')
  ) {
    return 'This file could not be downloaded from Google Drive.'
  }
  if (value.includes('disk') || value.includes('reserve')) {
    return 'The server needs more free disk space for this file.'
  }
  if (value.includes('rate limit') || value.includes('resource')) {
    return 'The transcription service did not have enough capacity for this file.'
  }

  return 'This file could not be transcribed.'
}
