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

  it('derives id and title for files without frontmatter', () => {
    const result = parseArtifact(NO_FRONTMATTER, 'no-fm.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('no-fm')
    expect(result.value.title).toBe('No Frontmatter')
    expect(result.value.type).toBe('note')
    expect(result.value.body).toContain('Just plain markdown.')
  })

  it('returns error for malformed YAML', () => {
    const result = parseArtifact(MALFORMED_YAML, 'broken.md')
    expect(result.ok).toBe(false)
  })

  it('accepts custom type strings (progressive type discovery)', () => {
    const md = `---
id: p01
title: Feedback Loops
type: pattern
created: 2026-03-13
modified: 2026-03-13
connections: [g17]
---

Patterns emerge from repeated observation.`

    const result = parseArtifact(md, 'feedback-loops.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe('pattern')
    expect(result.value.id).toBe('p01')
  })

  it('defaults to note when type is missing', () => {
    const md = `---
id: n42
title: No Type Specified
created: 2026-03-13
modified: 2026-03-13
---

A note without an explicit type.`

    const result = parseArtifact(md, 'no-type.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe('note')
  })

  it('derives id from filename when frontmatter has no id', () => {
    const md = `---
title: Claude Code Playbook
tags: [coding, ai]
---

# Claude Code Playbook

Content here.`

    const result = parseArtifact(md, '/vault/Coding/Claude Code Playbook.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('Claude Code Playbook')
    expect(result.value.title).toBe('Claude Code Playbook')
    expect(result.value.tags).toEqual(['coding', 'ai'])
  })

  it('derives title from first H1 when frontmatter has no title', () => {
    const md = `---
id: n99
tags: [test]
---

# My Great Note

Some body text.`

    const result = parseArtifact(md, 'my-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('n99')
    expect(result.value.title).toBe('My Great Note')
  })

  it('falls back to filename stem when no title or H1', () => {
    const md = `---
tags: [orphan]
---

Just body text, no heading.`

    const result = parseArtifact(md, 'stray-thought.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('stray-thought')
    expect(result.value.title).toBe('stray-thought')
  })

  it('extracts concept nodes from body during parse', () => {
    const md = `---
id: n1
title: Note One
---

See <node>Note Two</node> and <node>Note Three</node> for more.`

    const result = parseArtifact(md, 'note-one.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.concepts).toEqual(['Note Two', 'Note Three'])
  })

  it('handles Obsidian-style frontmatter with custom properties', () => {
    const md = `---
title: The Four Pillars
Parent: "[[VIBE CODING]]"
Source: Notion
tags: [methodology]
---

# The Four Pillars

AI as Scheduled Capacity.`

    const result = parseArtifact(md, 'The Four Pillars.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('The Four Pillars')
    expect(result.value.title).toBe('The Four Pillars')
    expect(result.value.tags).toEqual(['methodology'])
    expect(result.value.type).toBe('note')
  })
})

describe('related field with wikilink stripping', () => {
  it('strips [[brackets]] from related values', () => {
    const md = `---
id: atmamun
title: Atmamun
related:
  - "[[Fooled by Randomness]]"
  - "[[Antifragile]]"
  - "[[Skin in the Game]]"
---

A book about the mind.`

    const result = parseArtifact(md, 'Atmamun.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual([
      'Fooled by Randomness',
      'Antifragile',
      'Skin in the Game'
    ])
  })

  it('strips [[target|display]] pipe syntax, keeping target', () => {
    const md = `---
id: test
title: Test
related:
  - "[[The Black Swan|Black Swan]]"
---

Body.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual(['The Black Swan'])
  })

  it('defaults to empty array when related is absent', () => {
    const md = `---
id: no-rel
title: No Related
---

Body.`

    const result = parseArtifact(md, 'no-rel.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual([])
  })

  it('parses related and connections independently', () => {
    const md = `---
id: both
title: Both Fields
connections:
  - g13
related:
  - "[[Antifragile]]"
---

Body.`

    const result = parseArtifact(md, 'both.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.connections).toEqual(['g13'])
    expect(result.value.related).toEqual(['Antifragile'])
  })
})

describe('bodyLinks extraction from body wikilinks', () => {
  it('extracts [[wikilinks]] from body text', () => {
    const md = `---
id: test
title: Test
---

Naval recommends [[The Book of Secrets]] and [[Atmamun]] for deep study.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(
      expect.arrayContaining(['The Book of Secrets', 'Atmamun'])
    )
    expect(result.value.bodyLinks).toHaveLength(2)
  })

  it('extracts target from [[target|display]] pipe syntax', () => {
    const md = `---
id: test
title: Test
---

See [[Genius - The Life and Science of Richard Feynman|Feynman biography]] for more.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['Genius - The Life and Science of Richard Feynman'])
  })

  it('deduplicates repeated wikilinks', () => {
    const md = `---
id: test
title: Test
---

[[Antifragile]] is great. As I said, [[Antifragile]] changed my thinking.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['Antifragile'])
  })

  it('returns empty array when body has no wikilinks', () => {
    const md = `---
id: test
title: Test
---

Just plain text with no links.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual([])
  })

  it('keeps bodyLinks independent from frontmatter related', () => {
    const md = `---
id: test
title: Test
related:
  - "[[Direct Truth]]"
---

Naval also recommends [[Atmamun]] alongside [[Direct Truth]].`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual(['Direct Truth'])
    expect(result.value.bodyLinks).toEqual(expect.arrayContaining(['Atmamun', 'Direct Truth']))
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

  it('round-trips a custom type artifact', () => {
    const md = `---
id: d01
title: Maneuver Warfare
type: doctrine
created: 2026-03-13
modified: 2026-03-13
signal: emerging
connections: [g17]
---

Boyd's OODA loop applied to strategy.`

    const parsed = parseArtifact(md, 'doctrine.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.type).toBe('doctrine')

    const serialized = serializeArtifact(parsed.value)
    const reparsed = parseArtifact(serialized, 'doctrine.md')
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.type).toBe('doctrine')
    expect(reparsed.value.id).toBe('d01')
  })
})
