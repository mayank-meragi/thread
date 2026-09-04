import { applyThreadTemplate, db, setThreadProperty, type PropertyValue, type ThreadPropertyRecord } from '../db'
import { EXERCISE_EQUIPMENT_OPTIONS, EXERCISE_MUSCLE_OPTIONS, type PropertyOption } from './blockMetadata'
import EXERCISE_IMAGE_INDEX from './workouts/exerciseImageIndex'

export const EXERCISE_GUIDE_TEMPLATE_ID = 'exercise-guide-template'
export const EXERCISE_GUIDE_TEMPLATE_TITLE = 'Exercise Guide'

export const EXERCISE_GUIDE_PROPERTY_IDS = [
  'exercise-summary',
  'exercise-primary-muscles',
  'exercise-secondary-muscles',
  'exercise-equipment',
  'exercise-setup',
  'exercise-execution',
  'exercise-cues',
  'exercise-common-mistakes',
  'exercise-safety-notes',
] as const

const PROPERTY_LABEL: Record<string, string> = {
  'exercise-summary': 'Summary',
  'exercise-primary-muscles': 'Primary muscles',
  'exercise-secondary-muscles': 'Secondary muscles',
  'exercise-equipment': 'Equipment',
  'exercise-setup': 'Setup',
  'exercise-execution': 'Execution',
  'exercise-cues': 'Cues',
  'exercise-common-mistakes': 'Common mistakes',
  'exercise-safety-notes': 'Safety notes',
}

const MULTI_SELECT_PROPERTY_IDS = new Set(['exercise-primary-muscles', 'exercise-secondary-muscles', 'exercise-equipment'])

function blankValueFor(propertyId: string): PropertyValue {
  return MULTI_SELECT_PROPERTY_IDS.has(propertyId) ? [] : ''
}

// Idempotent, fixed-id seed for the built-in "Exercise Guide" template thread,
// modeled on ensureWorkoutCoachPersona / ensureGeneralPersona (personas.ts)
// and ensureBuiltInProperties (db.ts). Creates the template thread once with
// every guide field present but blank, then leaves it alone -- the user is
// free to edit the template (its own blank defaults, its body) without this
// re-seeding over their edits on a later app load.
//
// Uses a fixed constant id rather than slugifyThread('Exercise Guide') so a
// user typing "[[Exercise Guide]]" in their own notes creates a normal,
// unrelated thread instead of colliding with the seeded template.
export async function ensureExerciseGuideTemplate(): Promise<void> {
  const existing = await db.threads.get(EXERCISE_GUIDE_TEMPLATE_ID)
  if (existing) return
  const now = new Date().toISOString()
  await db.threads.put({
    id: EXERCISE_GUIDE_TEMPLATE_ID,
    title: EXERCISE_GUIDE_TEMPLATE_TITLE,
    normalizedTitle: EXERCISE_GUIDE_TEMPLATE_TITLE.toLocaleLowerCase(),
    createdAt: now,
    updatedAt: now,
    isTemplate: true,
  })
  await db.threadNotes.put({
    threadId: EXERCISE_GUIDE_TEMPLATE_ID,
    markdown: '- ',
    blockCount: 1,
    updatedAt: now,
    localRevision: 1,
  })
  for (const propertyId of EXERCISE_GUIDE_PROPERTY_IDS) {
    await setThreadProperty(EXERCISE_GUIDE_TEMPLATE_ID, propertyId, blankValueFor(propertyId), 'explicit')
  }
}

// Applies the blank Exercise Guide template (as `source: 'default'`, so it
// never masquerades as a user edit and never blocks the AI refresh path) and
// attempts an image match, to every given exercise thread. Both are
// independently best-effort -- one thread's failure, or one thread having no
// image match, must never block the rest.
export async function applyExerciseGuideToThreads(entries: Array<{ id: string; title: string }>): Promise<void> {
  for (const entry of entries) {
    if (entry.id === EXERCISE_GUIDE_TEMPLATE_ID) continue
    try {
      await applyThreadTemplate(entry.id, EXERCISE_GUIDE_TEMPLATE_ID, { propertySource: 'default' })
    } catch {
      // Best-effort: a thread with a corrupted note or a since-deleted guide
      // template must never block the day/thread-note save that triggered this.
    }
    try {
      await applyExerciseImageMatch(entry.id, entry.title)
    } catch {
      // Same best-effort contract as the guide-template application above.
    }
  }
}

// --- Exercise images ---------------------------------------------------

const IMAGE_BASE_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db/exercises/'

function normalizeExerciseName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(Boolean))
}

let imageIndexByName: Map<string, string[]> | undefined
let imageIndexTokens: Array<{ tokens: Set<string>; images: string[] }> | undefined

function loadImageIndex(): void {
  if (imageIndexByName) return
  imageIndexByName = new Map()
  imageIndexTokens = []
  for (const entry of EXERCISE_IMAGE_INDEX) {
    const normalized = normalizeExerciseName(entry.name)
    if (!normalized) continue
    if (!imageIndexByName.has(normalized)) imageIndexByName.set(normalized, entry.images)
    imageIndexTokens.push({ tokens: tokenize(normalized), images: entry.images })
  }
}

// Deterministic, dependency-free name matcher against the vendored
// free-exercise-db index: an exact normalized-name match first, falling back
// to one exercise's token set being a subset of the other's (covers
// reorderings like "Back Squat" vs "Squat, Back"). Returns `undefined` (never
// `[]`) on a miss, so the caller leaves the property unset rather than
// stamping an empty array -- a later dataset/matcher improvement can still
// find it.
export function matchExerciseImages(title: string): string[] | undefined {
  loadImageIndex()
  const normalized = normalizeExerciseName(title)
  if (!normalized) return undefined
  const exact = imageIndexByName!.get(normalized)
  if (exact) return exact.map((path) => `${IMAGE_BASE_URL}${path}`)

  const queryTokens = tokenize(normalized)
  if (!queryTokens.size) return undefined
  const match = imageIndexTokens!.find(({ tokens }) =>
    (tokens.size <= queryTokens.size && [...tokens].every((token) => queryTokens.has(token)))
    || (queryTokens.size <= tokens.size && [...queryTokens].every((token) => tokens.has(token))))
  return match?.images.map((path) => `${IMAGE_BASE_URL}${path}`)
}

export async function applyExerciseImageMatch(threadId: string, title: string): Promise<void> {
  const existing = await db.threadProperties.get(`${threadId}:exercise-image-urls`)
  if (existing) return
  const urls = matchExerciseImages(title)
  if (!urls?.length) return
  await setThreadProperty(threadId, 'exercise-image-urls', urls, 'default')
}

// --- AI-generated guide fields ------------------------------------------

export interface ExerciseGuideInput {
  summary?: string
  primaryMuscles?: string[]
  secondaryMuscles?: string[]
  equipment?: string[]
  setup?: string
  execution?: string
  cues?: string
  commonMistakes?: string
  safetyNotes?: string
}

const MULTI_SELECT_OPTIONS_BY_PROPERTY: Record<string, PropertyOption[]> = {
  'exercise-primary-muscles': EXERCISE_MUSCLE_OPTIONS,
  'exercise-secondary-muscles': EXERCISE_MUSCLE_OPTIONS,
  'exercise-equipment': EXERCISE_EQUIPMENT_OPTIONS,
}

function slugify(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// AI-generated guide input arrives as free text ("Abs", "spinal erectors",
// "Bodyweight only") -- the option list only recognizes exact ids ("abs",
// "spinal-erectors"). Resolve each entry against the property's option ids
// first, then its labels (case/punctuation-insensitive), then a slugified
// form of the raw text, before falling back to leaving it untouched (and
// letting `validatePropertyValue` reject it with a clear error rather than
// silently dropping data the caller doesn't know is missing).
export function normalizeMultiSelectValue(propertyId: string, values: string[]): string[] {
  const options = MULTI_SELECT_OPTIONS_BY_PROPERTY[propertyId]
  if (!options) return values
  const byId = new Map(options.map((option) => [option.id, option.id]))
  const byLabel = new Map(options.map((option) => [slugify(option.label), option.id]))
  const resolved = values.map((raw) => byId.get(raw) ?? byLabel.get(slugify(raw)) ?? raw)
  return Array.from(new Set(resolved))
}

const GUIDE_FIELD_TO_PROPERTY: Record<keyof ExerciseGuideInput, string> = {
  summary: 'exercise-summary',
  primaryMuscles: 'exercise-primary-muscles',
  secondaryMuscles: 'exercise-secondary-muscles',
  equipment: 'exercise-equipment',
  setup: 'exercise-setup',
  execution: 'exercise-execution',
  cues: 'exercise-cues',
  commonMistakes: 'exercise-common-mistakes',
  safetyNotes: 'exercise-safety-notes',
}

export interface GuideFieldChange {
  propertyId: string
  fieldName: string
  before: PropertyValue | undefined
  after: PropertyValue
}

// Diffs an AI-proposed guide against a thread's current property rows and
// keeps only fields that are safe to overwrite: no existing value, or an
// existing value whose source is 'default' or 'automation'. A field the user
// has set explicitly is dropped from the plan entirely, even if the AI
// proposed a different value for it -- the caller never even sees it as a
// pending change. This is the shared diff logic behind workout.buildDay /
// workout.addExercises' `guide` payload and workout.refreshExerciseGuide.
export async function planGuideUpdate(threadId: string, guide: ExerciseGuideInput): Promise<GuideFieldChange[]> {
  const changes: GuideFieldChange[] = []
  for (const [field, rawValue] of Object.entries(guide) as Array<[keyof ExerciseGuideInput, string | string[] | undefined]>) {
    if (rawValue === undefined) continue
    const propertyId = GUIDE_FIELD_TO_PROPERTY[field]
    const value = Array.isArray(rawValue) ? normalizeMultiSelectValue(propertyId, rawValue) : rawValue
    const existing: ThreadPropertyRecord | undefined = await db.threadProperties.get(`${threadId}:${propertyId}`)
    if (existing?.source === 'explicit') continue
    if (existing && JSON.stringify(existing.value) === JSON.stringify(value)) continue
    changes.push({ propertyId, fieldName: PROPERTY_LABEL[propertyId] ?? propertyId, before: existing?.value, after: value })
  }
  return changes
}

export async function applyGuideUpdate(threadId: string, changes: GuideFieldChange[]): Promise<void> {
  for (const change of changes) await setThreadProperty(threadId, change.propertyId, change.after, 'automation')
}
