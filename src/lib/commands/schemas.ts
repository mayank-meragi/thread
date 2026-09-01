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
