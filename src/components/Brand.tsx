import { Captions } from 'lucide-react'

export function Brand() {
  return (
    <div className="brand" aria-label="Drive transcripts">
      <span className="brand__mark" aria-hidden="true">
        <Captions />
      </span>
      <span className="brand__name">Drive transcripts</span>
    </div>
  )
}
