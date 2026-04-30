/**
 * Block-level secret scanner.
 *
 * Pure, no I/O, idempotent. Scans a string for known secret shapes and
 * returns non-overlapping {kind, start, end} ranges. When two patterns
 * match the same span, the more specific kind wins (anthropic > openai).
 *
 * Concept-borrowed from Warp's terminal/model/secrets.rs. Clean-room TS.
 */

import type { SecretRef } from './block-model'

interface Rule {
  readonly kind: string
  readonly priority: number
  readonly pattern: RegExp
}

// Higher priority wins on overlap. Order roughly mirrors specificity.
const RULES: readonly Rule[] = [
  { kind: 'anthropic', priority: 100, pattern: /sk-ant-[A-Za-z0-9\-_]{40,}/g },
  // High-FP standalone, but unambiguous when prefixed by AWS_SECRET_ACCESS_KEY=.
  // Promoted above env-var-key so the captured value range wins on overlap.
  {
    kind: 'aws-secret',
    priority: 95,
    pattern: /AWS_SECRET_ACCESS_KEY=([A-Za-z0-9+/]{40})/g
  },
  {
    kind: 'env-var-key',
    priority: 90,
    pattern: /(?:OPENAI|ANTHROPIC|GITHUB|AWS|GOOGLE|GCP)_(?:API_)?(?:SECRET_ACCESS_)?KEY=\S+/g
  },
  { kind: 'openai', priority: 80, pattern: /sk-[A-Za-z0-9]{32,}/g },
  { kind: 'github-pat', priority: 70, pattern: /ghp_[A-Za-z0-9]{36}/g },
  { kind: 'aws-access', priority: 60, pattern: /AKIA[0-9A-Z]{16}/g },
  {
    kind: 'jwt',
    priority: 50,
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g
  }
]

interface Candidate {
  readonly kind: string
  readonly priority: number
  readonly start: number
  readonly end: number
}

function collectCandidates(text: string): readonly Candidate[] {
  const out: Candidate[] = []
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      // `aws-secret` carries a capture group — flag only the captured value.
      const start =
        m.length > 1 && typeof m[1] === 'string' ? m.index + m[0].indexOf(m[1]) : m.index
      const end =
        m.length > 1 && typeof m[1] === 'string' ? start + m[1].length : m.index + m[0].length
      if (end > start) {
        out.push({ kind: rule.kind, priority: rule.priority, start, end })
      }
      // Guard against zero-width matches stalling the loop.
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return out
}

function resolveOverlaps(candidates: readonly Candidate[]): readonly SecretRef[] {
  // Sort: priority desc, then length desc, then start asc — so highest-priority wins.
  const ranked = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const lenA = a.end - a.start
    const lenB = b.end - b.start
    if (lenB !== lenA) return lenB - lenA
    return a.start - b.start
  })

  const accepted: Candidate[] = []
  for (const c of ranked) {
    const overlaps = accepted.some((a) => c.start < a.end && c.end > a.start)
    if (!overlaps) accepted.push(c)
  }

  return accepted
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ kind: c.kind, start: c.start, end: c.end }))
}

export function scanSecrets(text: string): readonly SecretRef[] {
  if (text.length === 0) return []
  return resolveOverlaps(collectCandidates(text))
}

/**
 * Bytes of overlap to re-scan when scanning incremental output. Must exceed
 * the longest expected secret so a token split across two chunks still flags.
 */
export const SECRET_RESCAN_OVERLAP = 512
