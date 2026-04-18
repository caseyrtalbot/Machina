import { describe, it } from 'vitest'
import fc from 'fast-check'
import {
  addSection,
  removeSection,
  reorderSections,
  replaceSection
} from '@shared/engine/section-rewriter'
import type { SectionMap } from '@shared/cluster-types'

const sectionArb = fc.record({
  cardId: fc.uuid(),
  heading: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => s.replace(/[\n#\s]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter((s) => s.length > 0),
  body: fc.string({ maxLength: 40 }).map((s) => s.replace(/\n#/g, 'x'))
})

const opArb = fc.oneof(
  fc.record({
    kind: fc.constant('replace' as const),
    cardIdIdx: fc.nat({ max: 5 }),
    body: fc.string({ maxLength: 40 }).map((s) => s.replace(/\n#/g, 'x'))
  }),
  fc.record({ kind: fc.constant('add' as const), section: sectionArb }),
  fc.record({ kind: fc.constant('remove' as const), cardIdIdx: fc.nat({ max: 5 }) }),
  fc.record({ kind: fc.constant('reorder' as const), seed: fc.nat() })
)

describe('cluster invariants', () => {
  it('after any sequence of ops, every entry in sectionMap resolves to a unique heading in the file', () => {
    fc.assert(
      fc.property(
        fc.array(sectionArb, { minLength: 2, maxLength: 6 }).map((secs) => {
          const seen = new Set<string>()
          return secs.map((s, i) => {
            let h = s.heading
            let n = 2
            while (seen.has(h)) h = `${s.heading}_${n++}`
            seen.add(h)
            return { ...s, cardId: `c${i}`, heading: h }
          })
        }),
        fc.array(opArb, { maxLength: 10 }),
        (sections, ops) => {
          let content = 'intro\n\n' + sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n')
          let map: SectionMap = Object.fromEntries(sections.map((s) => [s.cardId, s.heading]))

          for (const op of ops) {
            if (op.kind === 'replace') {
              const keys = Object.keys(map)
              if (keys.length === 0) continue
              const id = keys[op.cardIdIdx % keys.length]
              const r = replaceSection(content, id, op.body, map)
              if (r.ok) content = r.value
            } else if (op.kind === 'add') {
              const r = addSection(content, op.section, 'end', map)
              if (r.ok) {
                content = r.value.content
                map = r.value.sectionMap
              }
            } else if (op.kind === 'remove') {
              const keys = Object.keys(map)
              if (keys.length <= 2) continue
              const id = keys[op.cardIdIdx % keys.length]
              const r = removeSection(content, id, map)
              if (r.ok) {
                content = r.value.content
                map = r.value.sectionMap
              }
            } else {
              const keys = Object.keys(map)
              const seed = op.seed
              const order = [...keys].sort(
                (a, b) => ((seed + a.length) % 7) - ((seed + b.length) % 7)
              )
              const r = reorderSections(content, order, map)
              if (r.ok) content = r.value
            }

            const headings = content
              .split('\n')
              .filter((l) => l.startsWith('## '))
              .map((l) => l.slice(3).trim())
            for (const [cardId, heading] of Object.entries(map)) {
              if (!headings.includes(heading)) throw new Error(`lost ${cardId} -> ${heading}`)
            }
            if (new Set(headings).size !== headings.length)
              throw new Error('duplicate headings in file')
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})
