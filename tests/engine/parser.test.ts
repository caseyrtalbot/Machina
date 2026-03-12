import { describe, it, expect } from 'vitest'
import { parseArtifact, serializeArtifact } from '@engine/parser'

const VALID_MD = `---
id: g17
title: Category Creation
type: gene
created: 2026-03-11
modified: 2026-03-11
source: research
frame: market strategy
signal: untested
tags: [positioning, moats]
connections:
  - g13
  - c01
clusters_with:
  - g13
tensions_with:
  - c03
appears_in:
  - overview
---

# Category Creation

Bessemer asks: are AI-native tools creating new categories?`

const MINIMAL_MD = `---
id: n1
title: Quick Note
type: note
created: 2026-03-12
modified: 2026-03-12
---

Just a simple note.`

const NO_FRONTMATTER = `# No Frontmatter

Just plain markdown.`

const MALFORMED_YAML = `---
id: broken
title: [invalid yaml
---

Body text.`

describe('parseArtifact', () => {
  it('parses valid frontmatter with all fields', () => {
    const result = parseArtifact(VALID_MD, 'category-creation.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('g17')
    expect(result.value.type).toBe('gene')
    expect(result.value.connections).toEqual(['g13', 'c01'])
    expect(result.value.clusters_with).toEqual(['g13'])
    expect(result.value.tensions_with).toEqual(['c03'])
    expect(result.value.appears_in).toEqual(['overview'])
    expect(result.value.body).toContain('Bessemer asks')
  })

  it('parses minimal frontmatter with defaults', () => {
    const result = parseArtifact(MINIMAL_MD, 'quick-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.signal).toBe('untested')
    expect(result.value.connections).toEqual([])
    expect(result.value.tags).toEqual([])
  })

  it('returns error for missing frontmatter', () => {
    const result = parseArtifact(NO_FRONTMATTER, 'no-fm.md')
    expect(result.ok).toBe(false)
  })

  it('returns error for malformed YAML', () => {
    const result = parseArtifact(MALFORMED_YAML, 'broken.md')
    expect(result.ok).toBe(false)
  })
})

describe('serializeArtifact', () => {
  it('round-trips a valid artifact', () => {
    const parsed = parseArtifact(VALID_MD, 'test.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeArtifact(parsed.value)
    const reparsed = parseArtifact(serialized, 'test.md')
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.id).toBe(parsed.value.id)
    expect(reparsed.value.connections).toEqual(parsed.value.connections)
    expect(reparsed.value.body).toContain('Bessemer asks')
  })
})
