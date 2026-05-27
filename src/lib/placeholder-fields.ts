import type { PlaceholderField } from '@/lib/types'

export function parsePlaceholderInner(inner: string): {
  baseKey: string
  type?: 'checkbox' | 'select' | 'part'
  option?: string
  part?: string
} {
  const parts = inner.split('#')
  if (parts.length === 1) return { baseKey: inner }
  const baseKey = parts[0]
  if (parts[1] === 'checkbox') return { baseKey, type: 'checkbox', option: parts[2] }
  if (parts[1] === 'select') return { baseKey, type: 'select', option: parts[2] }
  if (parts[1] === 'part') return { baseKey, type: 'part', part: parts[2] }
  return { baseKey: inner }
}

/** XML/processedText 안 {{…}} 토큰 목록 → 폼 필드( select/checkbox는 baseKey 하나로 묶음) */
export function fieldsFromPlaceholderInners(inners: string[]): PlaceholderField[] {
  const byKey = new Map<string, PlaceholderField>()
  for (const inner of inners) {
    const p = parsePlaceholderInner(inner)
    let f = byKey.get(p.baseKey)
    if (!f) {
      const label = p.baseKey.includes('_') ? p.baseKey.split('_').slice(1).join('_') : p.baseKey
      f = {
        key: p.baseKey,
        label,
        type: 'text',
        options: [],
        required: false,
      }
      byKey.set(p.baseKey, f)
    }
    if (p.type === 'part') f.type = 'date'
    else if (p.type === 'select') {
      f.type = 'select'
      if (p.option && !f.options?.includes(p.option)) f.options = [...(f.options || []), p.option]
    } else if (p.type === 'checkbox') {
      f.type = 'checkbox'
      if (p.option && !f.options?.includes(p.option)) f.options = [...(f.options || []), p.option]
    }
  }
  return Array.from(byKey.values())
}

export function extractInnersFromProcessedText(processedText: string): string[] {
  const inners: string[] = []
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(processedText)) !== null) inners.push(m[1])
  return inners
}

export function fieldsFromProcessedText(
  processedText: string,
  existing?: PlaceholderField[]
): PlaceholderField[] {
  const merged = fieldsFromPlaceholderInners(extractInnersFromProcessedText(processedText))
  if (!existing?.length) return merged
  return merged.map(f => {
    const prev = existing.find(p => p.key === f.key)
    if (!prev) return f
    return {
      ...f,
      label: prev.label || f.label,
      options: f.options?.length ? f.options : prev.options,
    }
  })
}
