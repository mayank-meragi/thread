import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ChevronDown, ExternalLink, MessageCircle, Plus, SkipForward, Trash2 } from 'lucide-react'
import { EXERCISE_EQUIPMENT_OPTIONS, EXERCISE_MUSCLE_OPTIONS } from '../../lib/blockMetadata'
import { OPEN_CHAT_EVENT } from '../../lib/dockviewActions'
import { addSet, deleteWorkoutItem, skipExercise } from '../../lib/workouts/mutations'
import { exerciseSummary, sourceHref, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutExerciseView } from '../../lib/workouts/types'
import { SetRow } from './SetRow'

function exerciseName(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title
    || stripStructuralTag(exercise.task.text, 'exercise')
    || 'Exercise'
}

const MUSCLE_LABEL = new Map(EXERCISE_MUSCLE_OPTIONS.map((option) => [option.id, option.label]))
const EQUIPMENT_LABEL = new Map(EXERCISE_EQUIPMENT_OPTIONS.map((option) => [option.id, option.label]))

function metaLine(exercise: WorkoutExerciseView): string {
  const guide = exercise.guide
  if (!guide) return ''
  const muscle = guide.primaryMuscles[0]
  const equipment = guide.equipment[0]
  return [muscle && (MUSCLE_LABEL.get(muscle) ?? muscle), equipment && (EQUIPMENT_LABEL.get(equipment) ?? equipment)]
    .filter(Boolean)
    .join(' · ')
}

const HERO_FRAME_INTERVAL_MS = 700

/** Cycles through the exercise's reference images (typically a start/end pose pair) like a looping gif. */
function ExerciseHero({ images, name }: { images: string[]; name: string }) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    setFrame(0)
    if (images.length < 2) return
    const id = window.setInterval(() => setFrame((current) => (current + 1) % images.length), HERO_FRAME_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [images])

  if (images.length === 0) return <div className="active-exercise-hero-empty" aria-hidden="true" />

  return (
    <>
      {images.map((src, imageIndex) => (
        <img
          key={src}
          src={src}
          alt={imageIndex === 0 ? name : ''}
          aria-hidden={imageIndex === 0 ? undefined : true}
          className={`active-exercise-hero-frame${imageIndex === frame ? ' is-visible' : ''}`}
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
      ))}
    </>
  )
}

function GuideDetails({ exercise }: { exercise: WorkoutExerciseView }) {
  const [open, setOpen] = useState(false)
  const guide = exercise.guide
  if (!guide) return null
  const hasChips = guide.primaryMuscles.length > 0 || guide.secondaryMuscles.length > 0 || guide.equipment.length > 0
  const hasDetails = Boolean(guide.setup || guide.execution || guide.cues || guide.commonMistakes || guide.safetyNotes)
  if (!hasChips && !hasDetails) return null
  return (
    <div className="exercise-guide">
      <button type="button" className="exercise-guide-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={14} aria-hidden="true" /> {open ? 'Hide guide details' : 'Guide details'}
      </button>
      {open && (
        <>
          {hasChips && (
            <div className="exercise-guide-chips">
              {guide.primaryMuscles.map((id) => <span key={`pm-${id}`} className="exercise-guide-chip is-primary">{MUSCLE_LABEL.get(id) ?? id}</span>)}
              {guide.secondaryMuscles.map((id) => <span key={`sm-${id}`} className="exercise-guide-chip">{MUSCLE_LABEL.get(id) ?? id}</span>)}
              {guide.equipment.map((id) => <span key={`eq-${id}`} className="exercise-guide-chip is-equipment">{EQUIPMENT_LABEL.get(id) ?? id}</span>)}
            </div>
          )}
          {hasDetails && (
            <div className="exercise-guide-details">
              {guide.setup && <p><strong>Setup</strong>{guide.setup}</p>}
              {guide.execution && <p><strong>Execution</strong>{guide.execution}</p>}
              {guide.cues && <p><strong>Cues</strong>{guide.cues}</p>}
              {guide.commonMistakes && <p><strong>Common mistakes</strong>{guide.commonMistakes}</p>}
              {guide.safetyNotes && <p><strong>Safety notes</strong>{guide.safetyNotes}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function ActiveExercise({
  exercise,
  index,
}: {
  exercise: WorkoutExerciseView
  index: number
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { tally } = exerciseSummary(exercise)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setMenuOpen(false)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const name = exerciseName(exercise)
  const heroImages = exercise.guide?.imageUrls ?? []
  const thumbImage = heroImages[1] ?? heroImages[0]
  const meta = metaLine(exercise)

  return (
    <section className="active-exercise">
      <div className="active-exercise-hero">
        <ExerciseHero images={heroImages} name={name} />
        <span className="active-exercise-badge">EXERCISE {index + 1}</span>
      </div>

      <div className="active-exercise-body">
        <div className="active-exercise-title-row">
          <div className="active-exercise-title-col">
            <h1 className="active-exercise-title">
              {exercise.exerciseThread
                ? <Link to={`/thread/${exercise.exerciseThread.id}`}>{name}</Link>
                : <span>{name}</span>}
            </h1>
            {meta && <p className="active-exercise-subtitle">{meta}</p>}
          </div>
          {thumbImage && <img className="active-exercise-thumb" src={thumbImage} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
        </div>

        {exercise.guide?.summary && <p className="active-exercise-desc">{exercise.guide.summary}</p>}
        <GuideDetails exercise={exercise} />

        {error && <p className="workout-inline-error" role="alert">{error}</p>}

        {exercise.sets.length === 0 ? (
          <p className="active-exercise-empty">No sets yet — add the first one below.</p>
        ) : (
          <div className="set-table">
            <div className="set-table-head">
              <span>Set</span>
              <span>Today</span>
              <span>Done</span>
            </div>
            {exercise.sets.map((set, setIndex) => <SetRow key={set.task.id} set={set} index={setIndex} />)}
          </div>
        )}

        <button type="button" className="add-set-button" disabled={busy} onClick={() => void run(() => addSet(exercise.task.id))}>
          <span className="add-set-icon" aria-hidden="true"><Plus size={14} /></span>
          Add set
        </button>

        {exercise.notes.map((note) => (
          <p key={note.id} className="exercise-note">{note.plainText}</p>
        ))}

        <div className="active-exercise-actions">
          <div className="active-exercise-menu-anchor">
            <button type="button" className="active-exercise-action" disabled={busy} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
              <ArrowLeftRight size={16} aria-hidden="true" /> Swap
            </button>
            {menuOpen && (
              <>
                <div className="active-exercise-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu-panel active-exercise-menu" role="menu">
                  <a className="menu-item" role="menuitem" href={sourceHref(exercise.task)}>
                    <ExternalLink size={15} aria-hidden="true" /> Open source line
                  </a>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    disabled={exercise.task.status === 'canceled'}
                    onClick={() => void run(() => skipExercise(exercise.task.id))}
                  >
                    <SkipForward size={15} aria-hidden="true" /> Skip exercise
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => void run(() => deleteWorkoutItem(exercise.task.id))}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Delete exercise
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className="active-exercise-action"
            onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}
          >
            <MessageCircle size={16} aria-hidden="true" /> Ask coach
          </button>
        </div>

        <p className="active-exercise-tally">{tally.completed}/{tally.total} sets logged</p>
      </div>

      <div className="exercise-swipe-hint">
        Swipe for another exercise <ChevronDown size={14} aria-hidden="true" />
      </div>
    </section>
  )
}
