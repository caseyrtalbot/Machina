import { describe, it, expect } from 'vitest'
import {
  buildGhostIndex,
  extractContext,
  inferFolder,
  isPathGhost,
  stripWikilinksFromContext
} from '../../src/renderer/src/engine/ghost-index'
import { buildGraph } from '../../src/shared/engine/graph-builder'
import { parseArtifact } from '../../src/shared/engine/parser'
import type { Artifact, KnowledgeGraph } from '../../src/shared/types'

/** Parse real markdown through the production parser; throws on parse failure. */
function parse(md: string, filename: string): Artifact {
  const result = parseArtifact(md, filename)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Full production pipeline: markdown files → parser → graph. */
function buildPipeline(files: ReadonlyArray<readonly [string, string]>): {
  artifacts: Artifact[]
  graph: KnowledgeGraph
} {
  const artifacts = files.map(([filename, md]) => parse(md, filename))
  return { artifacts, graph: buildGraph(artifacts) }
}

describe('isPathGhost', () => {
  it('returns true for path-based IDs', () => {
    expect(isPathGhost('Project Notes/Themes/Systems Thinking')).toBe(true)
    expect(isPathGhost('Reading List/Talks 1')).toBe(true)
  })

  it('returns false for simple idea references', () => {
    expect(isPathGhost('Richard Hamming')).toBe(false)
    expect(isPathGhost('leverage')).toBe(false)
    expect(isPathGhost('specific knowledge')).toBe(false)
  })
})

describe('stripWikilinksFromContext', () => {
  it('strips simple wikilinks keeping the target text', () => {
    expect(stripWikilinksFromContext('Author: [[Richard Hamming]]')).toBe('Author: Richard Hamming')
  })

  it('uses display alias when present', () => {
    expect(stripWikilinksFromContext('see [[Richard Hamming|Hamming]] for details')).toBe(
      'see Hamming for details'
    )
  })

  it('uses last path segment for path-style targets without alias', () => {
    expect(stripWikilinksFromContext('in [[Project Notes/Themes/Systems Thinking]] we find')).toBe(
      'in Systems Thinking we find'
    )
  })

  it('uses alias over path for path-style targets with alias', () => {
    expect(stripWikilinksFromContext('[[Project Notes/Themes/Clarity|Clarity]] is important')).toBe(
      'Clarity is important'
    )
  })

  it('handles multiple wikilinks in one string', () => {
    expect(stripWikilinksFromContext('[[A]] and [[B|bee]]')).toBe('A and bee')
  })

  it('returns text unchanged when no wikilinks', () => {
    expect(stripWikilinksFromContext('plain text')).toBe('plain text')
  })
})

describe('extractContext', () => {
  it('extracts surrounding text with wikilinks stripped', () => {
    const body = 'This is a long paragraph about how [[Richard Hamming]] gave a legendary talk.'
    const result = extractContext(body, 'Richard Hamming')
    expect(result).toContain('Richard Hamming')
    expect(result).toContain('legendary talk')
    // Wikilink brackets should be stripped
    expect(result).not.toContain('[[')
  })

  it('returns null when wikilink is not found', () => {
    const result = extractContext('No links here.', 'Missing')
    expect(result).toBeNull()
  })

  it('adds ellipsis when context is truncated', () => {
    const body = 'A'.repeat(60) + '[[Target]]' + 'B'.repeat(60)
    const result = extractContext(body, 'Target')
    expect(result).toMatch(/^\.\.\./)
    expect(result).toMatch(/\.\.\.$/)
  })

  it('strips alias wikilinks in context', () => {
    const body = 'See [[Richard Hamming|Hamming]] for details.'
    const result = extractContext(body, 'Richard Hamming')
    expect(result).toContain('Hamming')
    expect(result).not.toContain('[[')
  })

  it('handles special regex characters in target', () => {
    const body = 'This links to [[C++ (language)]] which is interesting.'
    const result = extractContext(body, 'C++ (language)')
    expect(result).toContain('C++ (language)')
  })

  it('replaces newlines with spaces in context', () => {
    const body = 'Line one\n[[Target]]\nLine three'
    const result = extractContext(body, 'Target')
    expect(result).not.toContain('\n')
    expect(result).toContain('Target')
  })

  it('matches case-insensitively (lowercase ghost id vs cased body link)', () => {
    const body = 'Author: [[Richard Hamming]] gave a talk.'
    const result = extractContext(body, 'richard hamming')
    expect(result).toContain('Richard Hamming')
    expect(result).not.toContain('[[')
  })
})

describe('buildGhostIndex (parser → graph → ghost pipeline)', () => {
  it('capitalized [[Richard Hamming]] produces a ghost entry', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'essay.md',
        `---
id: essay-1
title: You and Your Research
---

Author: [[Richard Hamming]] gave a legendary talk.`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    // Ghost nodes are keyed by lowercase id; display casing lives in node.title
    expect(result[0].id).toBe('richard hamming')
    expect(graph.nodes.find((n) => n.id === 'richard hamming')?.title).toBe('Richard Hamming')
    expect(result[0].referenceCount).toBe(1)
    expect(result[0].references[0].fileTitle).toBe('You and Your Research')
    // sourceId is the referencing artifact's id (not the ghost's own id),
    // so the renderer can map a reference straight to its source file.
    expect(result[0].references[0].sourceId).toBe('essay-1')
    expect(result[0].references[0].context).toContain('Richard Hamming')
    // Context should have wikilinks stripped
    expect(result[0].references[0].context).not.toContain('[[')
  })

  it('title-based frontmatter connection resolves to the real note — no ghost', () => {
    const { artifacts, graph } = buildPipeline([
      [
        '/vault/Coding/Claude Code Playbook.md',
        `---
title: Claude Code Playbook
---

Playbook content.`
      ],
      [
        '/vault/note.md',
        `---
id: note-1
title: My Note
connections:
  - Claude Code Playbook
---

Body.`
      ]
    ])

    // id derives from filename stem, title from frontmatter — the connection
    // value is the *title* and must resolve to the real node, not a phantom.
    const connection = graph.edges.find((e) => e.kind === 'connection')
    expect(connection?.target).toBe('Claude Code Playbook')
    expect(buildGhostIndex(graph, artifacts)).toEqual([])
  })

  it('fenced [[fake link]] produces nothing', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'code-note.md',
        `---
id: code-note
title: Code Note
---

Real prose with a real [[Genuine Ghost]].

\`\`\`md
A fenced [[fake link]] that must not become a ghost.
\`\`\`

Inline \`[[also fake]]\` too.`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result.map((g) => g.id)).toEqual(['genuine ghost'])
  })

  it('case-split frontmatter and body references converge on one ghost', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'a.md',
        `---
id: a
title: A
connections:
  - Richard Hamming
---

No body links.`
      ],
      [
        'b.md',
        `---
id: b
title: B
---

See [[richard hamming]] for more.`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('richard hamming')
    expect(result[0].referenceCount).toBe(2)
    expect(result[0].references.map((r) => r.sourceId).sort()).toEqual(['a', 'b'])
  })

  it('filters out path-based ghost nodes', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'src.md',
        `---
id: src
title: Source
---

[[Richard Hamming]] and [[Project Notes/Themes/Clarity]]`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('richard hamming')
  })

  it('returns empty array when no ghost nodes exist', () => {
    const { artifacts, graph } = buildPipeline([
      ['a.md', `---\nid: a\ntitle: A\n---\n\nPlain note.`]
    ])
    expect(buildGhostIndex(graph, artifacts)).toEqual([])
  })

  it('sorts by reference count descending', () => {
    const { artifacts, graph } = buildPipeline([
      ['a.md', `---\nid: a\ntitle: A\n---\n\n[[ghost-few]] and [[ghost-many]]`],
      ['b.md', `---\nid: b\ntitle: B\n---\n\n[[ghost-many]]`],
      ['c.md', `---\nid: c\ntitle: C\n---\n\n[[ghost-many]]`]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result[0].id).toBe('ghost-many')
    expect(result[0].referenceCount).toBe(3)
    expect(result[1].id).toBe('ghost-few')
    expect(result[1].referenceCount).toBe(1)
  })

  it('handles frontmatter-only references', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'src.md',
        `---
id: src
title: Source
connections:
  - fm-ghost
---

No wikilinks here.`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].references[0].context).toContain('frontmatter')
  })

  it('frontmatter reference matching is case-insensitive', () => {
    const { artifacts, graph } = buildPipeline([
      [
        'src.md',
        `---
id: src
title: Source
connections:
  - Richard Hamming
---

No wikilinks here.`
      ]
    ])

    const result = buildGhostIndex(graph, artifacts)

    // Ghost id is lowercased but the frontmatter value keeps its casing —
    // membership check must still find it.
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('richard hamming')
    expect(result[0].references[0].context).toContain('frontmatter')
  })

  it('handles multiple references from the same file', () => {
    const { artifacts, graph } = buildPipeline([
      ['src.md', `---\nid: src\ntitle: Source\n---\n\nFirst [[ghost]] mention. Second [[ghost]].`]
    ])

    const result = buildGhostIndex(graph, artifacts)

    // Deduplicated to one reference per source file
    expect(result[0].referenceCount).toBe(1)
  })

  it('does not emit real cross-referencing artifacts as ghosts', () => {
    // buildGraph never stamps `path` on its nodes, so the old `!node.path`
    // predicate flagged every node — two real, file-backed artifacts that
    // reference each other surfaced the referenced one as a ghost. Build the
    // graph the real way to prove the fix gates on artifact membership, not path.
    const { artifacts, graph } = buildPipeline([
      ['a.md', `---\nid: a\ntitle: A\nrelated:\n  - b\n---\n\nsee [[b]]`],
      ['b.md', `---\nid: b\ntitle: B\nrelated:\n  - a\n---\n\nsee [[a]]`]
    ])

    expect(buildGhostIndex(graph, artifacts)).toEqual([])
  })
})

describe('inferFolder', () => {
  const vault = '/vault'

  it('returns vault root when no reference paths', () => {
    expect(inferFolder('ghost', [], vault)).toBe(vault)
  })

  it('returns majority folder when >50% match', () => {
    const paths = ['/vault/Authors/file1.md', '/vault/Authors/file2.md', '/vault/Books/file3.md']
    expect(inferFolder('ghost', paths, vault)).toBe('/vault/Authors')
  })

  it('returns vault root when no majority', () => {
    const paths = ['/vault/A/file1.md', '/vault/B/file2.md', '/vault/C/file3.md']
    expect(inferFolder('ghost', paths, vault)).toBe(vault)
  })

  it('returns vault root when all files are in root', () => {
    const paths = ['/vault/file1.md', '/vault/file2.md']
    expect(inferFolder('ghost', paths, vault)).toBe(vault)
  })

  it('handles single reference path', () => {
    const paths = ['/vault/Authors/hamming.md']
    expect(inferFolder('ghost', paths, vault)).toBe('/vault/Authors')
  })
})
