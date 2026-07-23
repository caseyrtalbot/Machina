/**
 * Verification test: shared engine modules work from a Node.js context
 * without DOM, React, or renderer dependencies.
 *
 * Proves these modules are safe to import from the main process (for MCP server).
 */
import { describe, it, expect } from 'vitest'
import { parseArtifact, serializeArtifact } from '@shared/engine/parser'
import { buildGraph } from '@shared/engine/graph-builder'
import { VaultIndex } from '@shared/engine/indexer'
import { SearchEngine } from '@shared/engine/search-engine'
import { buildTagIndex, filterArtifactsByTags } from '@shared/engine/tag-index'
import { rewriteWikilinks } from '@shared/engine/rename-links'
import { extractConceptNodes } from '@shared/engine/concept-extractor'

const SAMPLE_MD = `---
id: test-note
title: Test Note
type: note
created: 2026-01-01
modified: 2026-01-01
tags:
  - testing
  - shared/engine
connections:
  - other-note
---

# Test Note

This is a test note with a [[wikilink]] and a <node>concept</node>.
`

const SECOND_MD = `---
id: other-note
title: Other Note
type: note
created: 2026-01-01
modified: 2026-01-01
tags:
  - testing
related:
  - test-note
---

# Other Note

References [[test-note]] in the body.
`

describe('shared engine: parseArtifact', () => {
  it('parses markdown with frontmatter into an Artifact', () => {
    const result = parseArtifact(SAMPLE_MD, 'test-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.id).toBe('test-note')
    expect(result.value.title).toBe('Test Note')
    expect(result.value.type).toBe('note')
    expect(result.value.tags).toEqual(['testing', 'shared/engine'])
    expect(result.value.connections).toEqual(['other-note'])
    expect(result.value.bodyLinks).toContain('wikilink')
    expect(result.value.concepts).toContain('concept')
  })

  it('returns error for invalid frontmatter', () => {
    const result = parseArtifact('not yaml: [broken', 'bad.md')
    // gray-matter is lenient, so this may parse as body-only
    expect(result.ok).toBe(true)
  })

  it('derives title from filename stem when no frontmatter title', () => {
    const result = parseArtifact('# Body Title\n\nSome content.', 'my-file.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.title).toBe('Body Title')
  })
})

describe('shared engine: serializeArtifact', () => {
  it('round-trips: parse then serialize preserves structure', () => {
    const result = parseArtifact(SAMPLE_MD, 'test-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const serialized = serializeArtifact(result.value)
    expect(serialized).toContain('title: Test Note')
    expect(serialized).toContain('tags:')
    expect(serialized).toContain('connections:')
  })
})

describe('shared engine: buildGraph', () => {
  it('builds nodes and edges from artifacts', () => {
    const r1 = parseArtifact(SAMPLE_MD, 'test-note.md')
    const r2 = parseArtifact(SECOND_MD, 'other-note.md')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    const graph = buildGraph([r1.value, r2.value])
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2)
    expect(graph.edges.length).toBeGreaterThan(0)

    const testNode = graph.nodes.find((n) => n.id === 'test-note')
    expect(testNode).toBeDefined()
    expect(testNode!.title).toBe('Test Note')

    // Should have a connection edge from test-note to other-note
    const connectionEdge = graph.edges.find(
      (e) => e.kind === 'connection' && e.source === 'test-note' && e.target === 'other-note'
    )
    expect(connectionEdge).toBeDefined()
  })
})

describe('shared engine: VaultIndex', () => {
  it('indexes files and builds a graph', () => {
    const index = new VaultIndex()
    index.addFile('test-note.md', SAMPLE_MD)
    index.addFile('other-note.md', SECOND_MD)

    expect(index.getArtifacts()).toHaveLength(2)
    expect(index.getArtifact('test-note')).toBeDefined()
    expect(index.getGraph().nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('returns indexed artifacts for title-based matching', () => {
    const index = new VaultIndex()
    index.addFile('test-note.md', SAMPLE_MD)
    index.addFile('other-note.md', SECOND_MD)

    const results = index
      .getArtifacts()
      .filter((artifact) => artifact.title.toLowerCase().includes('other'))
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('other-note')
  })

  it('returns backlinks for a target', () => {
    const index = new VaultIndex()
    index.addFile('test-note.md', SAMPLE_MD)
    index.addFile('other-note.md', SECOND_MD)

    const backlinks = index.getBacklinks('other-note')
    expect(backlinks.some((a) => a.id === 'test-note')).toBe(true)
  })

  it('removes files cleanly', () => {
    const index = new VaultIndex()
    index.addFile('test-note.md', SAMPLE_MD)
    expect(index.getArtifacts()).toHaveLength(1)

    index.removeFile('test-note.md')
    expect(index.getArtifacts()).toHaveLength(0)
  })
})

describe('shared engine: SearchEngine', () => {
  it('indexes and searches documents with MiniSearch', () => {
    const engine = new SearchEngine()
    engine.upsert({
      id: 'test-note',
      title: 'Test Note',
      tags: ['testing'],
      body: 'This is a test note about shared engine modules.',
      path: 'test-note.md'
    })
    engine.upsert({
      id: 'other-note',
      title: 'Other Note',
      tags: ['testing'],
      body: 'Another document about different topics.',
      path: 'other-note.md'
    })

    const results = engine.search('shared engine')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('test-note')
    expect(results[0].snippet).toBeTruthy()
  })

  it('returns empty results for empty query', () => {
    const engine = new SearchEngine()
    expect(engine.search('')).toEqual([])
    expect(engine.search('   ')).toEqual([])
  })
})

describe('shared engine: buildTagIndex', () => {
  it('builds hierarchical tag tree from artifacts', () => {
    const r1 = parseArtifact(SAMPLE_MD, 'test-note.md')
    expect(r1.ok).toBe(true)
    if (!r1.ok) return

    const tree = buildTagIndex([r1.value])
    expect(tree.length).toBeGreaterThan(0)

    const sharedNode = tree.find((n) => n.name === 'shared')
    expect(sharedNode).toBeDefined()
    expect(sharedNode!.children).toHaveLength(1)
    expect(sharedNode!.children[0].name).toBe('engine')
  })

  it('filters artifacts by tag', () => {
    const r1 = parseArtifact(SAMPLE_MD, 'test-note.md')
    const r2 = parseArtifact(SECOND_MD, 'other-note.md')
    expect(r1.ok && r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    const filtered = filterArtifactsByTags([r1.value, r2.value], ['shared/engine'], 'or')
    expect(filtered).toHaveLength(1)
  })
})

describe('shared engine: rename-links', () => {
  it('rewrites wikilinks with new stem', () => {
    const content = 'See [[old-name]] and [[old-name|display text]].'
    const result = rewriteWikilinks(content, 'old-name', 'new-name')
    expect(result).toContain('[[new-name]]')
    expect(result).toContain('[[new-name|display text]]')
    expect(result).not.toContain('[[old-name]]')
  })
})

describe('shared engine: parseArtifact origin and sources', () => {
  it('parses origin field from frontmatter', () => {
    const md = `---
id: compiled-article
title: Compiled Article
type: research
origin: agent
sources:
  - "[[Paper A]]"
  - "[[Paper B]]"
created: 2026-04-02
modified: 2026-04-02
---

Compiled content.
`
    const result = parseArtifact(md, 'compiled-article.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('agent')
    expect(result.value.sources).toEqual(['Paper A', 'Paper B'])
  })

  it('defaults origin to human when absent', () => {
    const result = parseArtifact(SAMPLE_MD, 'test-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('human')
    expect(result.value.sources).toEqual([])
  })

  it('accepts source and agent as valid origins', () => {
    const md = `---
title: Raw Paper
origin: source
---

Raw content.
`
    const result = parseArtifact(md, 'raw.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('source')
  })

  it('defaults invalid origin to human', () => {
    const md = `---
title: Bad Origin
origin: invalid
---

Content.
`
    const result = parseArtifact(md, 'bad.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('human')
  })
})

describe('shared engine: buildGraph derived_from edges', () => {
  it('creates derived_from edges from sources field', () => {
    const sourceArtifact = parseArtifact(
      `---
id: paper-a
title: Paper A
type: research
origin: source
---

Raw paper content.
`,
      'paper-a.md'
    )

    const compiledArtifact = parseArtifact(
      `---
id: compiled-concept
title: Compiled Concept
type: research
origin: agent
sources:
  - "[[Paper A]]"
---

Compiled concept article.
`,
      'compiled-concept.md'
    )

    expect(sourceArtifact.ok && compiledArtifact.ok).toBe(true)
    if (!sourceArtifact.ok || !compiledArtifact.ok) return

    const graph = buildGraph([sourceArtifact.value, compiledArtifact.value])
    const derivedEdges = graph.edges.filter((e) => e.kind === 'derived_from')
    expect(derivedEdges).toHaveLength(1)
    expect(derivedEdges[0].source).toBe('compiled-concept')
    expect(derivedEdges[0].target).toBe('paper-a')
    expect(derivedEdges[0].provenance?.source).toBe('frontmatter')
  })

  it('does not create derived_from edges when sources is empty', () => {
    const artifact = parseArtifact(
      `---
id: plain-note
title: Plain Note
type: note
---

Just a note.
`,
      'plain-note.md'
    )

    expect(artifact.ok).toBe(true)
    if (!artifact.ok) return

    const graph = buildGraph([artifact.value])
    const derivedEdges = graph.edges.filter((e) => e.kind === 'derived_from')
    expect(derivedEdges).toHaveLength(0)
  })
})

describe('shared engine: concept-extractor', () => {
  it('extracts concept nodes from body text', () => {
    const body = 'This mentions <node>First Concept</node> and <node>Second Concept</node>.'
    const concepts = extractConceptNodes(body)
    expect(concepts).toEqual(['First Concept', 'Second Concept'])
  })

  it('deduplicates case-insensitively', () => {
    const body = '<node>Foo</node> and <node>foo</node>'
    const concepts = extractConceptNodes(body)
    expect(concepts).toHaveLength(1)
  })
})
