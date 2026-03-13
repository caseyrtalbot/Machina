import { TYPE_PREFIXES, type ArtifactType } from '@shared/types'

export type IdCounters = Record<string, number>

const PREFIX_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_PREFIXES).map(([type, prefix]) => [prefix, type])
)

export function generateId(
  type: ArtifactType,
  counters: IdCounters
): { id: string; updatedCounters: IdCounters } {
  const prefix = TYPE_PREFIXES[type]
  const current = counters[type] ?? 0
  const next = current + 1
  return {
    id: `${prefix}${next}`,
    updatedCounters: { ...counters, [type]: next }
  }
}

export function deriveCounters(ids: string[]): IdCounters {
  const counters: IdCounters = {}
  for (const id of ids) {
    const prefix = id.charAt(0)
    const numStr = id.slice(1)
    const num = parseInt(numStr, 10)
    if (isNaN(num)) continue
    const type = PREFIX_TO_TYPE[prefix]
    if (!type) continue
    counters[type] = Math.max(counters[type] ?? 0, num)
  }
  return counters
}
