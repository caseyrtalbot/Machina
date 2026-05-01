import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import type { CanvasNode } from '@shared/canvas-types'
import type { Block, BlockMetadata } from '@shared/engine/block-model'
import {
  pendingBlock,
  startBlock,
  completeBlock,
  cancelBlock,
  appendOutput
} from '@shared/engine/block-model'
import { useBlockStore } from '../../../store/block-store'

vi.mock('../CardShell', () => ({
  CardShell: ({
    title,
    children,
    titleExtra
  }: {
    title: string
    children: React.ReactNode
    titleExtra?: React.ReactNode
  }) => (
    <div data-testid="card-shell">
      <div data-testid="card-title">{title}</div>
      {titleExtra ? <div data-testid="card-title-extra">{titleExtra}</div> : null}
      <div data-testid="card-content">{children}</div>
    </div>
  )
}))

vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ removeNode: vi.fn() }),
    { getState: () => ({ removeNode: vi.fn() }) }
  )
}))

const baseMetadata = (sessionId: string): BlockMetadata => ({
  sessionId,
  cwd: '/home/casey/work',
  user: 'casey',
  host: 'spark',
  shellType: 'zsh'
})

function buildRunning(id: string, sessionId: string, command: string): Block {
  const p = pendingBlock(id, baseMetadata(sessionId))
  const r = startBlock(p, command, Date.now() - 5000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function buildCompleted(
  id: string,
  sessionId: string,
  command: string,
  exitCode: number,
  output = ''
): Block {
  const r = buildRunning(id, sessionId, command)
  const withOutput = output ? appendOutput(r, new TextEncoder().encode(output), output) : r
  const c = completeBlock(withOutput, exitCode, Date.now())
  if (!c.ok) throw new Error(c.error)
  return c.value
}

function buildCancelled(id: string, sessionId: string, command: string): Block {
  const r = buildRunning(id, sessionId, command)
  const c = cancelBlock(r, Date.now())
  if (!c.ok) throw new Error(c.error)
  return c.value
}

function makeBlockNode(
  sessionId: string,
  blockId: string,
  metaOverrides?: Partial<Record<string, unknown>>
): CanvasNode {
  return {
    id: 'card-1',
    type: 'terminal-block',
    position: { x: 0, y: 0 },
    size: { width: 420, height: 200 },
    content: '',
    metadata: {
      sessionId,
      blockId,
      command: '',
      exitCode: null,
      startedAtMs: null,
      finishedAtMs: null,
      cwd: null,
      agentContext: null,
      ...metaOverrides
    }
  }
}

describe('BlockCard', () => {
  beforeEach(() => {
    useBlockStore.setState(useBlockStore.getInitialState())
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the command as the card title', async () => {
    useBlockStore.getState().applyUpdate('s1', buildCompleted('b1', 's1', 'ls -la', 0))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    expect(screen.getByTestId('card-title').textContent).toContain('ls -la')
  })

  it('shows exit code chip for completed blocks (success)', async () => {
    useBlockStore.getState().applyUpdate('s1', buildCompleted('b1', 's1', 'echo hi', 0, 'hi\n'))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const status = screen.getByTestId('block-status')
    expect(status.textContent).toContain('0')
    expect(status.getAttribute('data-state')).toBe('completed')
  })

  it('shows exit code chip for completed blocks (failure)', async () => {
    useBlockStore.getState().applyUpdate('s1', buildCompleted('b1', 's1', 'false', 1))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const status = screen.getByTestId('block-status')
    expect(status.textContent).toContain('1')
    expect(status.getAttribute('data-exit-ok')).toBe('false')
  })

  it('shows running indicator for running blocks', async () => {
    useBlockStore.getState().applyUpdate('s1', buildRunning('b1', 's1', 'sleep 100'))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const status = screen.getByTestId('block-status')
    expect(status.getAttribute('data-state')).toBe('running')
    expect(screen.getByTestId('block-spinner')).toBeTruthy()
  })

  it('shows cancelled badge for cancelled blocks', async () => {
    useBlockStore.getState().applyUpdate('s1', buildCancelled('b1', 's1', 'sleep 100'))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const status = screen.getByTestId('block-status')
    expect(status.getAttribute('data-state')).toBe('cancelled')
    expect(status.textContent?.toLowerCase()).toContain('cancelled')
  })

  it('renders output text', async () => {
    useBlockStore
      .getState()
      .applyUpdate('s1', buildCompleted('b1', 's1', 'echo hi', 0, 'hello world\n'))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    expect(screen.getByTestId('block-output').textContent).toContain('hello world')
  })

  it('renders cwd basename when available', async () => {
    useBlockStore.getState().applyUpdate('s1', buildCompleted('b1', 's1', 'pwd', 0))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const cwd = screen.getByTestId('block-cwd')
    expect(cwd.textContent).toContain('work')
  })

  it('falls back to metadata when block is not in the store', async () => {
    const { BlockCard } = await import('../BlockCard')
    render(
      <BlockCard
        node={makeBlockNode('s1', 'b-missing', {
          command: 'archived-command',
          exitCode: 0,
          cwd: '/tmp/old'
        })}
      />
    )
    expect(screen.getByTestId('card-title').textContent).toContain('archived-command')
    expect(screen.getByTestId('block-status').getAttribute('data-state')).toBe('archived')
  })

  it('updates when the underlying block transitions running → completed', async () => {
    useBlockStore.getState().applyUpdate('s1', buildRunning('b1', 's1', 'make'))
    const { BlockCard } = await import('../BlockCard')
    const { rerender } = render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    expect(screen.getByTestId('block-status').getAttribute('data-state')).toBe('running')

    useBlockStore.getState().applyUpdate('s1', buildCompleted('b1', 's1', 'make', 2))
    rerender(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const status = screen.getByTestId('block-status')
    expect(status.getAttribute('data-state')).toBe('completed')
    expect(status.textContent).toContain('2')
  })

  it('exposes secrets count for masked rendering wiring', async () => {
    // Casey-style fake secret: a simulated AWS access key in output.
    const fake = 'AKIA' + 'IOSFODNN7EXAMPLE'
    useBlockStore
      .getState()
      .applyUpdate('s1', buildCompleted('b1', 's1', 'env', 0, `AWS_ACCESS_KEY_ID=${fake}\n`))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const output = screen.getByTestId('block-output')
    // 5.6 will replace the secret bytes with mask glyphs; here we assert the
    // card renders the secret count so the masking wiring has something to read.
    expect(output.getAttribute('data-secrets')).toBe('1')
  })

  it('toggles secret reveal on click of the reveal button (5.6 wiring)', async () => {
    const fake = 'AKIA' + 'IOSFODNN7EXAMPLE'
    useBlockStore
      .getState()
      .applyUpdate('s1', buildCompleted('b1', 's1', 'env', 0, `AWS_ACCESS_KEY_ID=${fake}\n`))
    const { BlockCard } = await import('../BlockCard')
    render(<BlockCard node={makeBlockNode('s1', 'b1')} />)
    const reveal = screen.getByTestId('block-reveal-toggle')
    expect(reveal.getAttribute('data-revealed')).toBe('false')
    fireEvent.click(reveal)
    expect(
      (screen.getByTestId('block-reveal-toggle') as HTMLElement).getAttribute('data-revealed')
    ).toBe('true')
  })
})
