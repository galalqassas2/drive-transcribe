import brandDrive from '../assets/icons/brand-drive.svg'

export function Brand() {
  return (
    <div className="brand" aria-label="Drive transcripts">
      <span className="brand__mark" aria-hidden="true">
        <img src={brandDrive} alt="" draggable={false} />
      </span>
      <span className="brand__name">Drive transcripts</span>
    </div>
  )
}
