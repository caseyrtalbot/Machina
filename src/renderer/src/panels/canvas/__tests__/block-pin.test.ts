import { describe, it, expect } from 'vitest'
import {
  buildBlockProjection,
  pickPinnableBlock,
  maskSecrets,
  PIN_OUTPUT_SNAPSHOT_MAX
} from '../block-pin'
import type { CanvasNode } from '@shared/canvas-types'
import {
  pendingBlock,
  startBlock,
  completeBlock,
  cancelBlock,
  appendOutput
} from '@shared/engine/block-model'
import type { Block, BlockMetadata } from '@shared/engine/block-model'

const meta: BlockMetadata = {
  sessionId: 's1',
  cwd: '/tmp/work',
  user: 'casey',
  host: 'spark',
  shellType: 'zsh'
}

const running = (id: string, command: string): Block => {
  const r = startBlock(pendingBlock(id, meta), command, 1000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const completed = (id: string, command: string, exitCode = 0): Block => {
  const r = running(id, command)
  const c = completeBlock(r, exitCode, 2000)
  if (!c.ok) throw new Error(c.error)
  return c.value
}

const cancelled = (id: string, command: string): Block => {
  const r = running(id, command)
  const c = cancelBlock(r, 2000)
  if (!c.ok) throw new Error(c.error)
  return c.value
}

const sourceTerminal: CanvasNode = {
  id: 'term-1',
  type: 'terminal',
  position: { x: 100, y: 200 },
  size: { width: 400, height: 280 },
  content: 's1',
  metadata: {}
}

describe('buildBlockProjection', () => {
  it('projects a completed block to a terminal-block canvas node', () => {
    const block = completed('b1', 'ls -la', 0)
    const node = buildBlockProjection(sourceTerminal, block)
    expect(node.type).toBe('terminal-block')
    expect(node.metadata.sessionId).toBe('s1')
    expect(node.metadata.blockId).toBe('b1')
    expect(node.metadata.command).toBe('ls -la')
    expect(node.metadata.exitCode).toBe(0)
    expect(node.metadata.cwd).toBe('/tmp/work')
    expect(node.metadata.startedAtMs).toBe(1000)
    expect(node.metadata.finishedAtMs).toBe(2000)
  })

  it('places projection to the right of the source card with a 24px gap', () => {
    const block = completed('b1', 'ls', 0)
    const node = buildBlockProjection(sourceTerminal, block)
    expect(node.position.x).toBe(100 + 400 + 24)
    expect(node.position.y).toBe(200)
  })

  it('handles a running block (no exit, no finishedAt)', () => {
    const node = buildBlockProjection(sourceTerminal, running('b1', 'sleep 100'))
    expect(node.metadata.exitCode).toBeNull()
    expect(node.metadata.finishedAtMs).toBeNull()
    expect(node.metadata.startedAtMs).toBe(1000)
  })

  it('handles a cancelled block (exit null, finishedAt set)', () => {
    const node = buildBlockProjection(sourceTerminal, cancelled('b1', 'sleep'))
    expect(node.metadata.exitCode).toBeNull()
    expect(node.metadata.finishedAtMs).toBe(2000)
  })

  it('handles a pending block (no times)', () => {
    const node = buildBlockProjection(sourceTerminal, pendingBlock('b1', meta))
    expect(node.metadata.startedAtMs).toBeNull()
    expect(node.metadata.finishedAtMs).toBeNull()
    expect(node.metadata.exitCode).toBeNull()
  })

  it('default size for terminal-block is the registry default', () => {
    const block = completed('b1', 'ls')
    const node = buildBlockProjection(sourceTerminal, block)
    expect(node.size.width).toBe(420)
    expect(node.size.height).toBe(200)
  })

  it('persists a cleaned output snapshot so the pin survives restart', () => {
    const r = appendOutput(running('b1', 'ls'), '\x1b[31mfile1.txt\x1b[0m\r\nfile2.txt\r\n')
    const c = completeBlock(r, 0, 2000)
    if (!c.ok) throw new Error(c.error)
    const node = buildBlockProjection(sourceTerminal, c.value)
    expect(node.metadata.outputSnapshot).toContain('file1.txt')
    expect(node.metadata.outputSnapshot).toContain('file2.txt')
    // ANSI control sequences stripped for plain-DOM rendering.
    expect(String(node.metadata.outputSnapshot)).not.toContain('\x1b')
  })

  it('masks secrets in the persisted snapshot and command', () => {
    const fake = 'AKIA' + 'IOSFODNN7EXAMPLE'
    const r = appendOutput(running('b1', `export AWS_KEY=${fake}`), `key is ${fake}\n`)
    const c = completeBlock(r, 0, 2000)
    if (!c.ok) throw new Error(c.error)
    const node = buildBlockProjection(sourceTerminal, c.value)
    expect(String(node.metadata.outputSnapshot)).not.toContain(fake)
    expect(String(node.metadata.command)).not.toContain(fake)
  })

  it('truncates the snapshot to the most recent PIN_OUTPUT_SNAPSHOT_MAX chars', () => {
    const big = 'x'.repeat(PIN_OUTPUT_SNAPSHOT_MAX + 5000) + 'TAIL-END'
    const r = appendOutput(running('b1', 'yes'), big)
    const c = completeBlock(r, 0, 2000)
    if (!c.ok) throw new Error(c.error)
    const node = buildBlockProjection(sourceTerminal, c.value)
    const snapshot = String(node.metadata.outputSnapshot)
    expect(snapshot.length).toBe(PIN_OUTPUT_SNAPSHOT_MAX)
    expect(snapshot.endsWith('TAIL-END')).toBe(true)
  })

  it('falls back to the output-derived command when block.command is empty', () => {
    const p = pendingBlock('b1', meta)
    const started = startBlock(p, '', 1000)
    if (!started.ok) throw new Error(started.error)
    const r = appendOutput(started.value, 'git status\r\nclean\r\n')
    const c = completeBlock(r, 0, 2000)
    if (!c.ok) throw new Error(c.error)
    const node = buildBlockProjection(sourceTerminal, c.value)
    expect(node.metadata.command).toBe('git status')
  })
})

describe('maskSecrets', () => {
  it('replaces secret spans with mask glyphs and keeps safe text', () => {
    const fake = 'AKIA' + 'IOSFODNN7EXAMPLE'
    const masked = maskSecrets(`key=${fake} done`)
    expect(masked).not.toContain(fake)
    expect(masked).toContain('key=')
    expect(masked).toContain('done')
    expect(masked).toContain('•'.repeat(fake.length))
  })

  it('returns text unchanged when no secrets are present', () => {
    expect(maskSecrets('plain text')).toBe('plain text')
    expect(maskSecrets('')).toBe('')
  })
})

describe('pickPinnableBlock', () => {
  it('returns null for an empty list', () => {
    expect(pickPinnableBlock([])).toBeNull()
  })

  it('prefers the latest completed block over an earlier running one', () => {
    const blocks = [running('b1', 'a'), completed('b2', 'b', 0)]
    expect(pickPinnableBlock(blocks)?.id).toBe('b2')
  })

  it('prefers the latest cancelled over earlier running', () => {
    const blocks = [running('b1', 'a'), cancelled('b2', 'b')]
    expect(pickPinnableBlock(blocks)?.id).toBe('b2')
  })

  it('falls back to the latest block when no terminal state exists', () => {
    const blocks = [running('b1', 'a'), running('b2', 'b'), running('b3', 'c')]
    expect(pickPinnableBlock(blocks)?.id).toBe('b3')
  })

  it('walks past a trailing running block to find an earlier completed one', () => {
    const blocks = [completed('b1', 'a', 0), running('b2', 'b')]
    expect(pickPinnableBlock(blocks)?.id).toBe('b1')
  })
})
