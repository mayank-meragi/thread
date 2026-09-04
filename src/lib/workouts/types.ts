import type { BlockPropertyRecord, BlockTagRecord, PropertyValue, TaskRecord } from '../../db'
import type { OutlineBlock } from '../outline'

export interface WorkoutDiagnostic {
  code: 'invalid_parent' | 'missing_exercise_link' | 'invalid_set_properties'
  blockId: string
  message: string
}

export interface WorkoutSetView {
  task: TaskRecord
  properties: Map<string, PropertyValue>
  propertyRows: BlockPropertyRecord[]
  tags: BlockTagRecord[]
}

export interface ExerciseGuideView {
  summary?: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
  equipment: string[]
  setup?: string
  execution?: string
  cues?: string
  commonMistakes?: string
  safetyNotes?: string
  imageUrls: string[]
}

export interface WorkoutExerciseView {
  task: TaskRecord
  exerciseThread?: { id: string; title: string }
  guide?: ExerciseGuideView
  sets: WorkoutSetView[]
  notes: OutlineBlock[]
}

export interface WorkoutView {
  task: TaskRecord
  thread?: { id: string; title: string }
  properties: Map<string, PropertyValue>
  exercises: WorkoutExerciseView[]
  notes: OutlineBlock[]
  diagnostics: WorkoutDiagnostic[]
}
