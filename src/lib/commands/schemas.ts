import { z } from 'zod'

export const propertyValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export const creatablePropertyTypeSchema = z.enum([
  'text',
  'rich_text',
  'number',
  'boolean',
  'date',
  'url',
])

export const threadEntityResultSchema = z.object({
  thread: z.string(),
  created: z.boolean(),
}).strict()

export const propertyEntityResultSchema = z.object({
  property: z.string(),
  created: z.boolean(),
}).strict()

export const threadMutationResultSchema = z.object({
  thread: z.string(),
  changed: z.boolean(),
}).strict()

export const personaMutationResultSchema = z.object({
  persona: z.string(),
  changed: z.boolean(),
}).strict()

export const workoutBuildResultSchema = z.object({
  workout: z.string(),
  day: z.string(),
  exerciseCount: z.number().int().nonnegative(),
  setCount: z.number().int().nonnegative(),
}).strict()

export const workoutEditResultSchema = z.object({
  workout: z.string(),
  exercise: z.string().optional(),
  added: z.number().int().nonnegative().default(0),
  updated: z.number().int().nonnegative().default(0),
  removed: z.number().int().nonnegative().default(0),
}).strict()

export const workoutLifecycleResultSchema = z.object({
  workout: z.string(),
  status: z.string(),
  set: z.string().optional(),
}).strict()
