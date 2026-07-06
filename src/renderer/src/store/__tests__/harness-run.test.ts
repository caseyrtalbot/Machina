import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../thread-store'
import { useBlockStore } from '../block-store'
import { runHarness } from '../harness-run'
import type { HarnessSummary } from '@shared/harness-types'
import type { Block } from '@shared/engine/block-model'

const summary: HarnessSummary = {
  slug: 'test-fixer',
  name: 'test-fixer',
  description: 'Runs the test suite, fixes the first failure, stops.',
  adapter: 'claude'
}

const DIR = '/ws/.machina/agents/test-fixer'

const fileContents: Record<string, string> = {
  [`${DIR}/SKILL.md`]: '---\nname: test-fixer\n---\nFix exactly one failing test.',
  [`${DIR}/rules.md`]: '- [critical] Never edit verify.sh.',
  [`${DIR}/scope.json`]: '{ "goal": "fix" }',
  [`${DIR}/state.md`]: 'No runs recorded yet.'
}

const readFilesBatch = vi.fn()
const createThread = vi.fn()
const appendUserMessage = vi.fn()

/** Run with a zero shell-ready timeout so tests never sit in the poll loop. */
const run = (s: HarnessSummary = summary) => runHarness(s, { shellReadyTimeoutMs: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  useThreadStore.setState(useThreadStore.getInitialState())
  useBlockStore.setState(useBlockStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/ws',
    createThread: createThread as never,
    appendUserMessage: appendUserMessage as never
  })
  readFilesBatch.mockImplementation(async (paths: readonly string[]) =>
    paths.map((p) => ({ path: p, content: fileContents[p] ?? null }))
  )
  createThread.mockResolvedValue({ id: 't1' })
  appendUserMessage.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { fs: { readFilesBatch } }
})

describe('runHarness', () => {
  it('reads exactly the four prompt files in one batch', async () => {
    await run()
    expect(readFilesBatch).toHaveBeenCalledTimes(1)
    expect(readFilesBatch).toHaveBeenCalledWith([
      `${DIR}/SKILL.md`,
      `${DIR}/rules.md`,
      `${DIR}/scope.json`,
      `${DIR}/state.md`
    ])
  })

  it('creates a cli-claude thread titled by the slug with the slug as agentId', async () => {
    await run()
    expect(createThread).toHaveBeenCalledTimes(1)
    const [agent, , title, agentId] = createThread.mock.calls[0]
    expect(agent).toBe('cli-claude')
    expect(title).toBe('test-fixer')
    expect(agentId).toBe('test-fixer')
  })

  it('sends a composed prompt containing the rules and the verify instruction', async () => {
    await run()
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    const prompt: string = appendUserMessage.mock.calls[0][0]
    expect(prompt).toContain('- [critical] Never edit verify.sh.')
    expect(prompt).toContain('sh .machina/agents/test-fixer/verify.sh')
    // Frontmatter stripped, body kept.
    expect(prompt).not.toContain('name: test-fixer')
    expect(prompt).toContain('Fix exactly one failing test.')
  })

  it('creates no thread when any file read fails', async () => {
    readFilesBatch.mockImplementation(async (paths: readonly string[]) =>
      paths.map((p) => ({
        path: p,
        content: p.endsWith('rules.md') ? null : (fileContents[p] ?? null),
        ...(p.endsWith('rules.md') ? { error: 'ENOENT' } : {})
      }))
    )
    await run()
    expect(createThread).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
  })

  it('creates no thread when no workspace is open', async () => {
    useThreadStore.setState({ vaultPath: null })
    await run()
    expect(readFilesBatch).not.toHaveBeenCalled()
    expect(createThread).not.toHaveBeenCalled()
  })

  it('waits for the fresh PTY session to draw a prompt before sending the first turn', async () => {
    // createThread's spawn side effect: the new session's first (pending)
    // block lands in block-store shortly after. The first turn must not be
    // typed before that — the shell hooks are not live yet.
    let sessionSeeded = false
    createThread.mockImplementation(async () => {
      setTimeout(() => {
        sessionSeeded = true
        useBlockStore.getState().applyUpdate('fresh-session', {
          id: 'b1',
          state: { kind: 'pending' },
          command: '',
          outputText: '',
          metadata: { sessionId: 'fresh-session', cwd: '/ws' }
        } as unknown as Block)
      }, 50)
      return { id: 't1' }
    })
    let seededWhenSent = false
    appendUserMessage.mockImplementation(async () => {
      seededWhenSent = sessionSeeded
    })
    await runHarness(summary, { shellReadyTimeoutMs: 5000 })
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    expect(seededWhenSent).toBe(true)
  })
})
