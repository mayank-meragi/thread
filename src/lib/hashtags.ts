const HASHTAG_PATTERN = /#\[([^\]]+)\]/g

export function extractHashtags(text: string): string[] {
  const names = Array.from(text.matchAll(HASHTAG_PATTERN), (match) => match[1].trim()).filter(Boolean)
  return Array.from(new Map(names.map((name) => [slugifyTag(name), name])).values())
}

export function slugifyTag(name: string): string {
  return name.trim().toLocaleLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
