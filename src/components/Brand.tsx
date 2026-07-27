import brandDrive from '../assets/icons/brand-drive.svg'

export function BrandMark() {
  return (
    <span className="brand__mark" aria-hidden="true">
      <img src={brandDrive} alt="" draggable={false} />
    </span>
  )
}

export function Brand() {
  return (
    <div className="brand" aria-label="Drive Transcripts">
      <BrandMark />
      <span className="brand__name">Drive Transcripts</span>
    </div>
  )
}
