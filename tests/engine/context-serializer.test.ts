import { describe, it, expect } from 'vitest'
import { buildCanvasContext, escapeForShell } from '@engine/context-serializer'
import type { CanvasNode } from '@shared/canvas-types'

function makeNode(id: string, type: CanvasNode['type'], content: string): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    content,
    metadata: {}
  }
}

describe('buildCanvasContext', () => {
  it('returns empty for non-existent card', () => {
    const result = buildCanvasContext('missing', [])
    expect(result.text).toBe('')
    expect(result.fileCount).toBe(0)
  })

  it('produces context for terminal card with no neighbors', () => {
    const nodes = [makeNode('t1', 'terminal', '')]
    const result = buildCanvasContext('t1', nodes)
    expect(result.text).toContain('canvas card (terminal)')
    expect(result.text).toContain('No files are on the canvas yet')
    expect(result.fileCount).toBe(0)
  })

  it('lists vault note file paths for Claude to read directly', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '/vault/Authors/Osho.md'),
      makeNode('n2', 'note', '/vault/Authors/Taleb.md')
    ]
    const result = buildCanvasContext('t1', nodes)
    expect(result.text).toContain('/vault/Authors/Osho.md')
    expect(result.text).toContain('/vault/Authors/Taleb.md')
    expect(result.text).toContain('Read these files directly')
    expect(result.fileCount).toBe(2)
  })

  it('excludes other terminal cards', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('t2', 'terminal', ''),
      makeNode('n1', 'note', '/vault/Authors/Osho.md')
    ]
    const result = buildCanvasContext('t1', nodes)
    expect(result.fileCount).toBe(1)
    // Only the Osho file path listed, not the other terminal's session ID
    expect(result.text).toContain('/vault/Authors/Osho.md')
  })

  it('ignores non-note cards (text, code, etc.)', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('txt1', 'text', 'Some inline text'),
      makeNode('c1', 'code', 'const x = 1')
    ]
    const result = buildCanvasContext('t1', nodes)
    // Text and code cards are inline content, not vault files
    expect(result.fileCount).toBe(0)
    expect(result.text).toContain('No files are on the canvas yet')
  })

  it('ignores note cards with multi-line content (not file paths)', () => {
    const nodes = [
      makeNode('t1', 'terminal', ''),
      makeNode('n1', 'note', '# My Note\nSome content here')
    ]
    const result = buildCanvasContext('t1', nodes)
    // Multi-line content is inline note content, not a vault file path
    expect(result.fileCount).toBe(0)
  })

  it('includes context file path when provided', () => {
    const nodes = [makeNode('t1', 'terminal', '')]
    const result = buildCanvasContext('t1', nodes, {
      contextFilePath: '/vault/.machina/context-t1.txt'
    })
    expect(result.text).toContain(
      'Canvas context is kept up to date at: /vault/.machina/context-t1.txt'
    )
    expect(result.text).toContain('Read that file')
  })

  it('does not include context file path when not provided', () => {
    const nodes = [makeNode('t1', 'terminal', '')]
    const result = buildCanvasContext('t1', nodes)
    expect(result.text).not.toContain('context is kept up to date')
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
