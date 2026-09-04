import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function ExerciseTopBar({
  title,
  backHref,
  index,
  total,
}: {
  title: string
  backHref: string
  index: number
  total: number
}) {
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0
  return (
    <header className="exercise-topbar">
      <div className="exercise-topbar-row">
        <Link to={backHref} className="exercise-topbar-back" aria-label="Back">
          <ArrowLeft size={17} />
        </Link>
        <span className="exercise-topbar-title">{title}</span>
        <span className="exercise-topbar-count">{index + 1}/{total}</span>
      </div>
      <div className="exercise-topbar-track">
        <div className="exercise-topbar-fill" style={{ width: `${progress}%` }} />
      </div>
    </header>
  )
}
