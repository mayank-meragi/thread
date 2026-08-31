import { db } from '../../db'
import { slugifyField } from './evaluate'
import type { QueryValue, Row, SourceName } from './types'

// Builds the row set for a source. Called inside a `useLiveQuery` (see
// QueryBlock.tsx), so every table it touches keeps the results live.
export async function loadSource(name: SourceName): Promise<Row[]> {
  return name === 'threads' ? loadThreads() : loadTags()
}

async function loadThreads(): Promise<Row[]> {
  const [allThreads, threadProperties, defs] = await Promise.all([
    db.threads.toArray(),
    db.threadProperties.toArray(),
    db.propertyDefinitions.toArray(),
  ])
  // Templates are threads with `isTemplate` set -- they are scaffolding, not
  // real threads, so `FROM threads` excludes them.
  const threads = allThreads.filter((thread) => !thread.isTemplate)
  const nameById = new Map(defs.map((def) => [def.id, slugifyField(def.name)]))
  const byThread = new Map<string, typeof threadProperties>()
  for (const property of threadProperties) {
    const list = byThread.get(property.threadId) ?? []
    list.push(property)
    byThread.set(property.threadId, list)
  }

  return threads.map((thread) => {
    const fields = new Map<string, QueryValue>([
      ['title', thread.title],
      ['name', thread.title],
      ['id', thread.id],
      ['origin', thread.origin ?? null],
      ['created', thread.createdAt],
      ['updated', thread.updatedAt],
    ])
    for (const property of byThread.get(thread.id) ?? []) {
      fields.set(property.propertyId, property.value)
      const slug = nameById.get(property.propertyId)
      if (slug) fields.set(slug, property.value)
    }
    return { id: thread.id, fields, link: `#/thread/${thread.id}` }
  })
}

async function loadTags(): Promise<Row[]> {
  const [tags, blockTags] = await Promise.all([
    db.tagDefinitions.toArray(),
    db.blockTags.toArray(),
  ])
  const usage = new Map<string, number>()
  for (const tag of blockTags) usage.set(tag.tagId, (usage.get(tag.tagId) ?? 0) + 1)

  return tags.map((tag) => {
    const fields = new Map<string, QueryValue>([
      ['name', tag.name],
      ['title', tag.name],
      ['id', tag.id],
      ['color', tag.color ?? null],
      ['property_count', tag.propertyIds.length],
      ['usage', usage.get(tag.id) ?? 0],
      ['created', tag.createdAt],
      ['updated', tag.updatedAt],
    ])
    return { id: tag.id, fields, link: '#/settings' }
  })
}
