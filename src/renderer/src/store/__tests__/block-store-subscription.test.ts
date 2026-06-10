/**
 * Integration test for the module-level IPC subscriptions in block-store:
 * block:update events land in the store, terminal:exit clears the session.
 * The window.api bridge is stubbed BEFORE a fresh module import so the
 * subscription code path actually runs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pendingBlock, startBlock, completeBlock } from '@shared/engine/block-model'
import type { Block, BlockMetadata } from '@shared/engine/block-model'

type BlockUpdateCb = (data: { sessionId: string; block: Block }) => void
type TerminalExitCb = (data: { sessionId: string; code: number }) => void

const meta = (sessionId: string): BlockMetadata => ({
  sessionId,
  cwd: '/tmp',
  user: null,
  host: null,
  shellType: 'zsh'
})

const runningBlock = (id: string, sessionId: string, command: string): Block => {
  const r = startBlock(pendingBlock(id, meta(sessionId)), command, 1000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('block-store IPC subscriptions', () => {
  let blockUpdateCb: BlockUpdateCb | null
  let terminalExitCb: TerminalExitCb | null

  beforeEach(() => {
    vi.resetModules()
    blockUpdateCb = null
    terminalExitCb = null
    ;(window as unknown as Record<string, unknown>).api = {
      on: {
        blockUpdate: (cb: BlockUpdateCb) => {
          blockUpdateCb = cb
          return () => {}
        },
        terminalExit: (cb: TerminalExitCb) => {
          terminalExitCb = cb
          return () => {}
        }
      }
    }
  })

  it('subscribes on import and routes block:update events into the store', async () => {
    const { useBlockStore } = await import('../block-store')
    expect(blockUpdateCb).not.toBeNull()

    blockUpdateCb?.({ sessionId: 's1', block: runningBlock('b1', 's1', 'ls') })
    expect(useBlockStore.getState().getBlocks('s1')).toHaveLength(1)
    expect(useBlockStore.getState().getBlock('s1', 'b1')?.command).toBe('ls')

    // A later snapshot for the same block id replaces in place.
    const done = completeBlock(runningBlock('b1', 's1', 'ls'), 0, 2000)
    if (!done.ok) throw new Error(done.error)
    blockUpdateCb?.({ sessionId: 's1', block: done.value })
    const blocks = useBlockStore.getState().getBlocks('s1')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].state.kind).toBe('completed')
  })

  it('clears the session blocks on terminal:exit', async () => {
    const { useBlockStore } = await import('../block-store')
    expect(terminalExitCb).not.toBeNull()

    blockUpdateCb?.({ sessionId: 's1', block: runningBlock('b1', 's1', 'ls') })
    blockUpdateCb?.({ sessionId: 's2', block: runningBlock('b2', 's2', 'pwd') })

    terminalExitCb?.({ sessionId: 's1', code: 0 })
    expect(useBlockStore.getState().getBlocks('s1')).toEqual([])
    expect(useBlockStore.getState().getBlocks('s2')).toHaveLength(1)
  })

  it('import without a preload bridge does not throw', async () => {
    ;(window as unknown as Record<string, unknown>).api = undefined
    await expect(import('../block-store')).resolves.toBeDefined()
  })
})
