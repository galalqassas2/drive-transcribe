import combinedFileIcon from '../assets/icons/file-combined.svg'
import srtFileIcon from '../assets/icons/file-srt.svg'
import txtFileIcon from '../assets/icons/file-txt.svg'
import type { ExplorerFile } from '../types'

const iconByType = {
  combined: combinedFileIcon,
  srt: srtFileIcon,
  txt: txtFileIcon,
} satisfies Record<ExplorerFile['type'], string>

export function TranscriptFileIcon({ type }: Pick<ExplorerFile, 'type'>) {
  return (
    <img
      className="transcript-file-icon"
      src={iconByType[type]}
      alt=""
      draggable={false}
    />
  )
}
