import { describe, it, expect } from 'vitest'
import {
  serializeNeighborhood,
  serializeNeighborhoodStructured,
  serializeCompact,
  escapeForShell
} from '@engine/context-serializer'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

function makeNode(id: string, type: CanvasNode['type'], content: string, x = 0, y = 0): CanvasNode {
  return {
    id,
    type,
    position: { x, y },
    size: { width: 300, height: 200 },
    content,
    metadata: {}
  }
}

function makeEdge(from: string, to: string, kind = 'connection', label?: string): CanvasEdge {
  return {
    id: `e_${from}_${to}_${kind}`,
    fromNode: from,
    toNode: to,
    fromSide: 'right',
    toSide: 'left',
    kind,
    label
  }
}

describe('serializeNeighborhood', () => {
  it('returns empty string for non-existent card', () => {
    const result = serializeNeighborhood('missing', [], [])
    expect(result).toBe('')
  })

  it('serializes a terminal card with no neighbors', () => {
    const nodes = [makeNode('t1', 'terminal', '')]
    const result = serializeNeighborhood('t1', nodes, [])
    expect(result).toContain('canvas card (terminal)')
    expect(result).toContain('Thought Engine')
    expect(result).not.toContain('context is kept up to date')
  })

  it('includes context file path when provided', () => {
    const nodes = [makeNode('t1', 'terminal', '')]
    const result = serializeNeighborhood('t1', nodes, [], {
      contextFilePath: '/vault/.thought-engine/context-t1.txt'
    })
    expect(result).toContain('context is kept up to date at: /vault/.thought-engine/context-t1.txt')
    expect(result).toContain('Read this file')
    expect(result).not.toContain('Connected cards')
  })

  it('includes connected cards via edges in incident encoding', () => {
    const nodes = [
      makeNode('a', 'note', '# Main idea\nSome content here'),
      makeNode('b', 'text', 'Related thought about systems'),
      makeNode('c', 'code', 'const x = 1', 100, 0)
    ]
    const edges = [makeEdge('a', 'b', 'causal'), makeEdge('a', 'c', 'co-occurrence')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('Connected cards on this canvas:')
    expect(result).toContain('via causal')
    expect(result).toContain('via co-occurrence')
  })

  it('prioritizes causal edges over weaker edge types', () => {
    const nodes = [
      makeNode('focus', 'note', '# Focus'),
      makeNode('causal-neighbor', 'note', '# Causal neighbor content'),
      makeNode('weak-neighbor', 'note', '# Weak neighbor content')
    ]
    const edges = [
      makeEdge('focus', 'weak-neighbor', 'co-occurrence'),
      makeEdge('focus', 'causal-neighbor', 'causal')
    ]
    const result = serializeNeighborhood('focus', nodes, edges)
    const causalIdx = result.indexOf('Causal neighbor')
    const weakIdx = result.indexOf('Weak neighbor')
    expect(causalIdx).toBeGreaterThan(-1)
    expect(weakIdx).toBeGreaterThan(-1)
    expect(causalIdx).toBeLessThan(weakIdx)
  })

  it('respects token budget', () => {
    const nodes = [
      makeNode('focus', 'note', '# Focus card'),
      ...Array.from({ length: 20 }, (_, i) =>
        makeNode(`n${i}`, 'note', `# Card number ${i} with some content to fill space`)
      )
    ]
    const edges = Array.from({ length: 20 }, (_, i) => makeEdge('focus', `n${i}`, 'connection'))
    const result = serializeNeighborhood('focus', nodes, edges, { maxTokens: 200 })
    const tokens = Math.ceil(result.length / 4)
    expect(tokens).toBeLessThanOrEqual(200)
  })

  it('uses edge labels in descriptions', () => {
    const nodes = [makeNode('a', 'note', '# A'), makeNode('b', 'note', '# B')]
    const edges = [makeEdge('a', 'b', 'tension', 'contradicts core thesis')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('tension (contradicts core thesis)')
  })

  it('handles bidirectional edges (both from and to)', () => {
    const nodes = [makeNode('x', 'note', '# X'), makeNode('y', 'text', 'Y content about testing')]
    // Edge goes FROM y TO x, but we serialize from x's perspective
    const edges = [makeEdge('y', 'x', 'causal')]
    const result = serializeNeighborhood('x', nodes, edges)
    expect(result).toContain('Connected cards')
    expect(result).toContain('Y content about testing')
    expect(result).toContain('via causal')
  })

  it('shows all edges for multi-edge neighbors (Decision 8A)', () => {
    const nodes = [makeNode('a', 'note', '# A'), makeNode('b', 'note', '# B')]
    const edges = [makeEdge('a', 'b', 'connection'), makeEdge('a', 'b', 'tension')]
    const result = serializeNeighborhood('a', nodes, edges)
    // Both edge kinds should appear in a single entry for B
    expect(result).toContain('connection')
    expect(result).toContain('tension')
    // Should be on the same line (grouped under one card)
    const bLine = result.split('\n').find((l) => l.includes('B [note]'))
    expect(bLine).toBeDefined()
    expect(bLine).toContain('connection')
    expect(bLine).toContain('tension')
  })

  it('falls back gracefully for unknown edge kinds', () => {
    const nodes = [makeNode('a', 'note', '# A'), makeNode('b', 'text', 'Banana content')]
    const edges = [makeEdge('a', 'b', 'banana')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('via banana')
    expect(result).toContain('Connected cards')
  })

  it('handles cards with empty content', () => {
    const nodes = [makeNode('a', 'note', ''), makeNode('b', 'text', '')]
    const edges = [makeEdge('a', 'b', 'connection')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('Connected cards')
    expect(result).toContain('Untitled text')
  })

  it('extracts file-view card title from metadata', () => {
    const fileNode: CanvasNode = {
      id: 'fv1',
      type: 'file-view',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      content: 'export const foo = 42',
      metadata: { language: 'typescript', previousLineCount: 10, modified: false }
    }
    const nodes = [makeNode('a', 'note', '# My Note'), fileNode]
    const edges = [makeEdge('a', 'fv1', 'connection')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('File: typescript')
  })

  it('uses richer snippets for notes (~200 chars) vs code (~60 chars)', () => {
    const longContent = 'A'.repeat(180)
    const nodes = [
      makeNode('focus', 'terminal', ''),
      makeNode('note1', 'note', longContent),
      makeNode('code1', 'code', longContent)
    ]
    const edges = [
      makeEdge('focus', 'note1', 'connection'),
      makeEdge('focus', 'code1', 'connection')
    ]
    const result = serializeNeighborhood('focus', nodes, edges, { maxTokens: 2000 })
    // Note snippet should preserve more content (up to 200 chars)
    const noteSnippetMatch = result.match(/"(A+)"/g)
    expect(noteSnippetMatch).toBeDefined()
    // The note line should have more A's than the code line
    const lines = result.split('\n').filter((l) => l.startsWith('-'))
    const noteLine = lines.find((l) => l.includes('[note]'))
    const codeLine = lines.find((l) => l.includes('[code]'))
    expect(noteLine).toBeDefined()
    expect(codeLine).toBeDefined()
    // Note shows full 180 chars (under 200 limit), code truncates to ~57+...
    expect(noteLine!.length).toBeGreaterThan(codeLine!.length)
  })

  it('includes edge type legend when connected cards exist (Task 7)', () => {
    const nodes = [makeNode('a', 'note', '# A'), makeNode('b', 'text', 'B content')]
    const edges = [makeEdge('a', 'b', 'connection')]
    const result = serializeNeighborhood('a', nodes, edges)
    expect(result).toContain('Cards are connected by typed edges:')
    expect(result).toContain('causal: strong cause-effect relationship')
    expect(result).toContain('tension: productive contradiction')
    expect(result).toContain('co-occurrence: inferred from shared concepts')
  })

  it('does not include edge legend when no connected cards (Task 7)', () => {
    const nodes = [makeNode('solo', 'note', '# Solo card')]
    const result = serializeNeighborhood('solo', nodes, [])
    expect(result).not.toContain('Cards are connected by typed edges:')
    expect(result).toContain('canvas card (note)')
  })

  it('always keeps at least 1 connected card after budget pruning (Decision T2)', () => {
    const nodes = [
      makeNode('focus', 'note', '# Focus'),
      ...Array.from({ length: 5 }, (_, i) =>
        makeNode(`n${i}`, 'note', `# Neighbor ${i} with lots of extra content to burn tokens`)
      )
    ]
    const edges = Array.from({ length: 5 }, (_, i) => makeEdge('focus', `n${i}`, 'connection'))
    // Very tight budget: should still keep at least 1
    const result = serializeNeighborhood('focus', nodes, edges, { maxTokens: 50 })
    expect(result).toContain('Connected cards')
    const cardLines = result.split('\n').filter((l) => l.startsWith('-') && l.includes('[note]'))
    expect(cardLines.length).toBeGreaterThanOrEqual(1)
  })
})

describe('regression: canvas context visibility', () => {
  it('includes note cards in "Other cards" when terminal card has no edges', () => {
    // Root cause: auto-notify only watched edges, so note cards added after
    // Claude launched were invisible. The serializer itself was correct —
    // but only if the right nodes were passed in.
    const nodes = [
      makeNode('claude-term', 'terminal', 'session-abc'),
      makeNode('feynman', 'note', '# Richard Feynman\nAmerican theoretical physicist'),
      makeNode('durant', 'note', '# Will and Ariel Durant\nHistorians')
    ]
    const result = serializeNeighborhood('claude-term', nodes, [])
    expect(result).toContain('Other cards on this canvas:')
    expect(result).toContain('Richard Feynman')
    expect(result).toContain('Will and Ariel Durant')
    expect(result).toContain('[note]')
  })

  it('excludes other terminal cards from "Other cards" list', () => {
    // Terminal cards are noise — Claude doesn't need to know about other shells
    const nodes = [
      makeNode('claude-term', 'terminal', 'session-abc'),
      makeNode('term2', 'terminal', 'session-def'),
      makeNode('term3', 'terminal', 'session-ghi')
    ]
    const result = serializeNeighborhood('claude-term', nodes, [])
    // Should only have the header, no "Other cards" section
    expect(result).not.toContain('Other cards')
    // Context should be short (header only, ~143 chars)
    expect(result.length).toBeLessThan(200)
  })

  it('produces context with both connected and unconnected cards', () => {
    // Mixed scenario: some cards connected via edges, others just placed on canvas
    const nodes = [
      makeNode('claude-term', 'terminal', ''),
      makeNode('connected-note', 'note', '# Connected\nThis is linked'),
      makeNode('floating-note', 'note', '# Floating\nJust placed on canvas')
    ]
    const edges = [makeEdge('claude-term', 'connected-note', 'connection')]
    const result = serializeNeighborhood('claude-term', nodes, edges)
    expect(result).toContain('Connected cards on this canvas:')
    expect(result).toContain('Connected [note]')
    expect(result).toContain('Other cards on this canvas:')
    expect(result).toContain('Floating [note]')
  })
})

describe('escapeForShell', () => {
  it('escapes single quotes for ANSI-C quoting', () => {
    expect(escapeForShell("it's a test")).toBe("it\\'s a test")
  })

  it('passes through plain text unchanged', () => {
    expect(escapeForShell('hello world')).toBe('hello world')
  })

  it('escapes newlines as \\n', () => {
    expect(escapeForShell('line1\nline2')).toBe('line1\\nline2')
  })

  it('escapes backslashes before other chars', () => {
    expect(escapeForShell("path\\to\\it's")).toBe("path\\\\to\\\\it\\'s")
  })

  it('escapes carriage returns', () => {
    expect(escapeForShell('line1\r\nline2')).toBe('line1\\r\\nline2')
  })

  it('escapes null bytes', () => {
    expect(escapeForShell('hello\x00world')).toBe('hello\\x00world')
  })
})

describe('serializeCompact', () => {
  it('produces a single-line format with no newlines', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '# Osho\nContent here'),
      makeNode('n2', 'note', '# Feynman\nMore content')
    ]
    const edges = [makeEdge('t1', 'n1', 'connection')]
    const result = serializeCompact('t1', nodes, edges)
    expect(result).not.toContain('\n')
    expect(result).toContain('[Canvas:')
    expect(result).toContain('Osho (connection)')
    expect(result).toContain('Feynman')
  })

  it('returns empty string when no non-terminal cards exist', () => {
    const nodes = [makeNode('t1', 'terminal', ''), makeNode('t2', 'terminal', '')]
    expect(serializeCompact('t1', nodes, [])).toBe('')
  })

  it('extracts filename from file paths (vault note cards)', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '/Users/casey/Vault/Authors/Osho.md')
    ]
    const result = serializeCompact('t1', nodes, [])
    expect(result).toContain('Osho')
    expect(result).not.toContain('/Users/')
    expect(result).not.toContain('.md')
  })

  it('lists connected cards with edge kind before unconnected cards', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '# Alpha'),
      makeNode('n2', 'note', '# Beta')
    ]
    const edges = [makeEdge('t1', 'n2', 'causal')]
    const result = serializeCompact('t1', nodes, edges)
    // Connected card (Beta with causal) should come before unconnected (Alpha)
    const betaIdx = result.indexOf('Beta')
    const alphaIdx = result.indexOf('Alpha')
    expect(betaIdx).toBeLessThan(alphaIdx)
    expect(result).toContain('Beta (causal)')
  })
})

describe('cardTitle file path handling', () => {
  it('extracts filename from vault note file paths', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', "/Users/casey/Desktop/Vault/Naval's Library/Authors/Osho.md")
    ]
    const result = serializeNeighborhood('t1', nodes, [])
    expect(result).toContain('Osho')
    expect(result).not.toContain('/Users/')
  })

  it('handles Windows-style paths', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', 'C:\\Users\\casey\\Vault\\Osho.md')
    ]
    const result = serializeNeighborhood('t1', nodes, [])
    // Should detect as path and extract filename
    expect(result).toContain('Osho')
  })

  it('preserves markdown heading titles for non-path content', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '# My Great Note\nSome content')
    ]
    const result = serializeNeighborhood('t1', nodes, [])
    expect(result).toContain('My Great Note')
  })

  it('does not treat slash-prefixed multi-line text as a path', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'text', '/ is the root directory\nMore text about filesystems')
    ]
    const result = serializeNeighborhood('t1', nodes, [])
    // Should use first line as title, not extract filename
    expect(result).toContain('/ is the root directory')
  })
})

describe('serializeNeighborhoodStructured', () => {
  it('returns card count and truncation status', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '# A'),
      makeNode('n2', 'note', '# B')
    ]
    const result = serializeNeighborhoodStructured('t1', nodes, [])
    expect(result.cardCount).toBe(2)
    expect(result.wasTruncated).toBe(false)
    expect(result.text).toContain('A')
    expect(result.text).toContain('B')
  })

  it('reports truncation when budget forces pruning', () => {
    const nodes = [
      makeNode('focus', 'note', '# Focus'),
      ...Array.from({ length: 20 }, (_, i) =>
        makeNode(`n${i}`, 'note', `# Card ${i} with extra content for budget`)
      )
    ]
    const edges = Array.from({ length: 20 }, (_, i) => makeEdge('focus', `n${i}`, 'connection'))
    const result = serializeNeighborhoodStructured('focus', nodes, edges, { maxTokens: 200 })
    expect(result.wasTruncated).toBe(true)
    expect(result.cardCount).toBeLessThan(20)
  })

  it('returns empty result for non-existent card', () => {
    const result = serializeNeighborhoodStructured('missing', [], [])
    expect(result.text).toBe('')
    expect(result.cardCount).toBe(0)
    expect(result.wasTruncated).toBe(false)
  })
})
