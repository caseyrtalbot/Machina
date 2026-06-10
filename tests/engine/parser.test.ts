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

  it('handles frontmatter with custom properties', () => {
    const md = `---
title: Project Overview
Parent: "[[Methodology]]"
Source: Notion
tags: [reference]
---

# Project Overview

An overview of the approach.`

    const result = parseArtifact(md, 'Project Overview.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('Project Overview')
    expect(result.value.title).toBe('Project Overview')
    expect(result.value.tags).toEqual(['reference'])
    expect(result.value.type).toBe('note')
  })
})

describe('related field with wikilink stripping', () => {
  it('strips [[brackets]] from related values', () => {
    const md = `---
id: topic-note
title: Topic Note
related:
  - "[[Design Patterns]]"
  - "[[Systems Thinking]]"
  - "[[Distributed Systems]]"
---

A note about the topic.`

    const result = parseArtifact(md, 'Topic Note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual([
      'Design Patterns',
      'Systems Thinking',
      'Distributed Systems'
    ])
  })

  it('strips [[target|display]] pipe syntax, keeping target', () => {
    const md = `---
id: test
title: Test
related:
  - "[[Clean Architecture|Architecture]]"
---

Body.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual(['Clean Architecture'])
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
  - "[[Systems Thinking]]"
---

Body.`

    const result = parseArtifact(md, 'both.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.connections).toEqual(['g13'])
    expect(result.value.related).toEqual(['Systems Thinking'])
  })
})

describe('bodyLinks extraction from body wikilinks', () => {
  it('extracts [[wikilinks]] from body text preserving original casing', () => {
    const md = `---
id: test
title: Test
---

The guide covers [[Refactoring]] and [[Domain Modeling]] for deep study.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(
      expect.arrayContaining(['Refactoring', 'Domain Modeling'])
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

[[Systems Thinking]] is great. As I said, [[Systems Thinking]] changed my thinking.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['Systems Thinking'])
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
  - "[[Type Systems]]"
---

The guide also covers [[Domain Modeling]] alongside [[Type Systems]].`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.related).toEqual(['Type Systems'])
    expect(result.value.bodyLinks).toEqual(
      expect.arrayContaining(['Domain Modeling', 'Type Systems'])
    )
  })

  it('deduplicates [[Foo]] and [[foo]] case-insensitively, keeping first-seen casing', () => {
    const md = `---
id: test
title: Test
---

See [[Foo]] and [[foo]] and [[FOO]] for details.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['Foo'])
  })

  it('preserves casing of path-prefixed wikilinks', () => {
    const md = `---
id: test
title: Test
---

Check [[archive/MyNote]] for context.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['archive/MyNote'])
  })

  it('ignores wikilinks inside fenced code blocks and inline code spans', () => {
    const md = `---
id: test
title: Test
---

A real [[Genuine Link]] here.

\`\`\`md
A fenced [[fake link]] that must not count.
\`\`\`

And inline \`[[also fake]]\` too.`

    const result = parseArtifact(md, 'test.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bodyLinks).toEqual(['Genuine Link'])
  })
})

describe('no fabricated dates', () => {
  it('returns undefined created/modified when frontmatter has no dates', () => {
    const result = parseArtifact(NO_FRONTMATTER, 'no-fm.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.created).toBeUndefined()
    expect(result.value.modified).toBeUndefined()
  })

  it('keeps explicit frontmatter dates', () => {
    const result = parseArtifact(MINIMAL_MD, 'quick-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.created).toBe('2026-03-12')
    expect(result.value.modified).toBe('2026-03-12')
  })

  it('serializeArtifact omits absent created/modified instead of stamping today', () => {
    const parsed = parseArtifact(NO_FRONTMATTER, 'no-fm.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeArtifact(parsed.value)
    expect(serialized).not.toMatch(/^created:/m)
    expect(serialized).not.toMatch(/^modified:/m)
  })
})

describe('serializeArtifact', () => {
  it('preserves custom frontmatter keys through round-trip', () => {
    const md = `---
id: e01
title: Emergent Idea
type: note
created: 2026-03-20
modified: 2026-03-20
origin: agent
category: emerge
custom_field: hello
---

An idea that emerged from observation.`

    const parsed = parseArtifact(md, 'emergent.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.origin).toBe('agent')
    expect(parsed.value.frontmatter.category).toBe('emerge')
    expect(parsed.value.frontmatter.custom_field).toBe('hello')

    const serialized = serializeArtifact(parsed.value)
    const reparsed = parseArtifact(serialized, 'emergent.md')
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return

    expect(reparsed.value.origin).toBe('agent')
    expect(reparsed.value.frontmatter.category).toBe('emerge')
    expect(reparsed.value.frontmatter.custom_field).toBe('hello')
  })

  it('does not duplicate explicit fields from frontmatter spread', () => {
    const md = `---
id: d01
title: Duplicate Test
type: gene
created: 2026-03-20
modified: 2026-03-20
tags: [alpha, beta]
origin: agent
---

Body text.`

    const parsed = parseArtifact(md, 'dup-test.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const serialized = serializeArtifact(parsed.value)

    // Tags should appear exactly once in the serialized output
    const tagMatches = serialized.match(/^tags:/gm)
    expect(tagMatches).toHaveLength(1)

    // origin should appear exactly once and be 'agent'
    const originMatches = serialized.match(/^origin:/gm)
    expect(originMatches).toHaveLength(1)
    expect(serialized).toContain('origin: agent')
  })

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
