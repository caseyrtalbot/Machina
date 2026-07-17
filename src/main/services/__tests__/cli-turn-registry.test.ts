// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  CliTurnRegistry,
  isAgentHeadMove,
  LINGER_MS,
  DEGRADED_AFTER_MS,
  type CliTurn
} from '../cli-turn-registry'

const ROOT = '/tmp/ws-a'

interface Harness {
  readonly registry: CliTurnRegistry
  readonly setNow: (ms: number) => void
  readonly setPtyAlive: (alive: boolean) => void
  readonly headShaCalls: string[]
}

function makeHarness(opts?: { headSha?: (root: string) => string | null }): Harness {
  let clock = 0
  let ptyAlive = true
  const headShaCalls: string[] = []
  const registry = new CliTurnRegistry({
    headSha: (root) => {
      headShaCalls.push(root)
      return opts?.headSha ? opts.headSha(root) : 'abc123'
    },
    isPtyAlive: () => ptyAlive,
    now: () => clock
  })
  return {
    registry,
    setNow: (ms) => {
      clock = ms
    },
    setPtyAlive: (alive) => {
      ptyAlive = alive
    },
    headShaCalls
  }
}

describe('CliTurnRegistry', () => {
  describe('turnId run-uniqueness (v1.3.0)', () => {
    it('two registries (= two app runs) never mint colliding turnIds', () => {
      // The queue's disk mirror rehydrates items under their ORIGINAL
      // `pc_<turnId>` ids; a bare per-run counter would let this run's first
      // turn coalesce into a persisted item from an earlier run.
      const runA = makeHarness()
      const runB = makeHarness()
      const a = runA.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      const b = runB.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      expect(a.turnId).not.toBe(b.turnId)
    })

    it('turnIds stay sequence-distinct within one registry', () => {
      const h = makeHarness()
      const first = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      const second = h.registry.turnStarted({ threadId: 'th2', agentId: 'claude', cwd: ROOT })
      expect(first.turnId).not.toBe(second.turnId)
    })
  })

  describe('linger boundary after turnEnded', () => {
    it('attributes within LINGER_MS, including exactly at the boundary, but not past it', () => {
      const h = makeHarness()
      h.setNow(1000)
      const opened = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(5000) // T = 5000: turn ends
      const closed = h.registry.turnEnded('th1')
      expect(closed).toBeDefined()
      expect(closed?.turnId).toBe(opened.turnId)
      expect(closed?.endedAt).toBe(5000)

      const inside = h.registry.activeTurnFor(ROOT, 5000 + 1400)
      expect(inside).not.toBeNull()
      expect(inside?.turn.threadId).toBe('th1')
      expect(inside?.degraded).toBe(false)

      const atBoundary = h.registry.activeTurnFor(ROOT, 5000 + LINGER_MS)
      expect(atBoundary).not.toBeNull()
      expect(atBoundary?.turn.threadId).toBe('th1')

      const outside = h.registry.activeTurnFor(ROOT, 5000 + 1600)
      expect(outside).toBeNull()
    })

    it('attributes a closed window in linger even when the PTY is dead', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(1000)
      h.registry.turnEnded('th1')
      h.setPtyAlive(false) // linger does not consult PTY liveness

      const match = h.registry.activeTurnFor(ROOT, 1000 + LINGER_MS)
      expect(match).not.toBeNull()
      expect(match?.turn.threadId).toBe('th1')
      expect(match?.degraded).toBe(false)
    })
  })

  describe('open windows require a living PTY', () => {
    it('returns null for a young open turn when the PTY is dead', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setPtyAlive(false)

      expect(h.registry.activeTurnFor(ROOT, 100)).toBeNull()
    })

    it('returns null for an open window on a hook-proven thread when the PTY is dead', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(100)
      h.registry.turnEnded('th1') // thread has proven its hooks emit blocks

      h.setNow(10_000)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setPtyAlive(false)

      expect(h.registry.activeTurnFor(ROOT, 10_100)).toBeNull()
    })
  })

  describe('degraded mode (thread never saw turnEnded)', () => {
    it('is not degraded before DEGRADED_AFTER_MS', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })

      const match = h.registry.activeTurnFor(ROOT, DEGRADED_AFTER_MS - 1)
      expect(match).not.toBeNull()
      expect(match?.degraded).toBe(false)
    })

    it('attributes with degraded=true at and after DEGRADED_AFTER_MS while the PTY is alive', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setPtyAlive(true)

      const atThreshold = h.registry.activeTurnFor(ROOT, DEGRADED_AFTER_MS)
      expect(atThreshold).not.toBeNull()
      expect(atThreshold?.degraded).toBe(true)

      const wellPast = h.registry.activeTurnFor(ROOT, DEGRADED_AFTER_MS + 60_000)
      expect(wellPast).not.toBeNull()
      expect(wellPast?.degraded).toBe(true)
    })

    it('returns null past DEGRADED_AFTER_MS when the PTY is dead', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setPtyAlive(false)

      expect(h.registry.activeTurnFor(ROOT, DEGRADED_AFTER_MS)).toBeNull()
      expect(h.registry.activeTurnFor(ROOT, DEGRADED_AFTER_MS + 60_000)).toBeNull()
    })
  })

  describe('sawTurnEnd suppresses degraded mode', () => {
    it('a later open turn past DEGRADED_AFTER_MS is not degraded once the thread has ever ended a turn', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(100)
      h.registry.turnEnded('th1') // thread has proven its hooks emit blocks

      h.setNow(10_000)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })

      const match = h.registry.activeTurnFor(ROOT, 10_000 + DEGRADED_AFTER_MS + 5_000)
      expect(match).not.toBeNull()
      expect(match?.degraded).toBe(false)
    })
  })

  describe('overlapping turn windows', () => {
    it('reports concurrent=true and picks the most recent startedAt', () => {
      const h = makeHarness()
      h.setNow(1000)
      h.registry.turnStarted({ threadId: 'th-early', agentId: 'claude', cwd: `${ROOT}/pkg-a` })
      h.setNow(2000)
      const later = h.registry.turnStarted({
        threadId: 'th-late',
        agentId: 'codex',
        cwd: `${ROOT}/pkg-b`
      })

      const match = h.registry.activeTurnFor(ROOT, 3000)
      expect(match).not.toBeNull()
      expect(match?.concurrent).toBe(true)
      expect(match?.turn.turnId).toBe(later.turnId)
      expect(match?.turn.threadId).toBe('th-late')
      expect(match?.turn.startedAt).toBe(2000)
    })
  })

  describe('threadClosed', () => {
    it('drops the window immediately, even inside the linger window', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(1000)
      h.registry.turnEnded('th1')
      h.registry.threadClosed('th1')

      // 1100 is well within turnEnded + LINGER_MS, yet the window is gone
      expect(h.registry.activeTurnFor(ROOT, 1100)).toBeNull()
    })
  })

  describe('cwd scoping', () => {
    it('attributes a turn whose cwd equals the root', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })

      expect(h.registry.activeTurnFor(ROOT, 100)).not.toBeNull()
    })

    it('attributes a turn whose cwd is a subdirectory of the root', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: `${ROOT}/nested/dir` })

      expect(h.registry.activeTurnFor(ROOT, 100)).not.toBeNull()
    })

    it('never attributes a turn whose cwd is outside the root', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: '/tmp/other-ws' })

      expect(h.registry.activeTurnFor(ROOT, 100)).toBeNull()
    })

    it('does not attribute a sibling directory sharing the root as a string prefix', () => {
      const h = makeHarness()
      h.setNow(0)
      // '/tmp/ws-a-sibling'.startsWith('/tmp/ws-a') is true; segment-safe
      // matching must still reject it
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: `${ROOT}-sibling` })

      expect(h.registry.activeTurnFor(ROOT, 100)).toBeNull()
    })
  })

  describe('open-invocation counting (cancel-then-resend)', () => {
    it('keeps the window open until every sent invocation has completed', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(500)
      // Cancel-then-resend: a second send on the same thread with no block
      // completion between
      const resend = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })

      // The cancelled turn's late block event drains one invocation but must
      // NOT close the follow-up turn
      h.setNow(1000)
      expect(h.registry.turnEnded('th1')).toBeUndefined()

      // Still open well past LINGER_MS: attributed as an open window (PTY alive)
      const stillOpen = h.registry.activeTurnFor(ROOT, 1000 + LINGER_MS + 5_000)
      expect(stillOpen).not.toBeNull()
      expect(stillOpen?.turn.turnId).toBe(resend.turnId)
      expect(stillOpen?.turn.endedAt).toBeNull()

      // The second block completion closes the current turn and returns it
      h.setNow(20_000)
      const closed = h.registry.turnEnded('th1')
      expect(closed).toBeDefined()
      expect(closed?.turnId).toBe(resend.turnId)
      expect(closed?.endedAt).toBe(20_000)
    })

    it('a spurious turnEnded after close returns undefined and does not throw', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      h.setNow(100)
      expect(h.registry.turnEnded('th1')).toBeDefined()

      expect(() => h.registry.turnEnded('th1')).not.toThrow()
      h.setNow(200)
      expect(h.registry.turnEnded('th1')).toBeUndefined()
    })
  })

  describe('noteQueueCommit', () => {
    it('appends queue commit shas without touching the immutable baseline', () => {
      const h = makeHarness({ headSha: () => 'sha1' })
      h.setNow(0)
      const turn = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      expect(turn.headShaAtStart).toBe('sha1')
      expect(turn.queueCommitShas).toEqual([])

      h.registry.noteQueueCommit('th1', 'qc1')
      h.registry.noteQueueCommit('th1', 'qc2')

      const match = h.registry.activeTurnFor(ROOT, 100)
      expect(match?.turn.headShaAtStart).toBe('sha1')
      expect(match?.turn.queueCommitShas).toEqual(['qc1', 'qc2'])
    })

    it('is a no-op for an unknown thread', () => {
      const h = makeHarness()
      expect(() => h.registry.noteQueueCommit('th-unknown', 'qc1')).not.toThrow()
      expect(h.registry.activeTurnFor(ROOT, 0)).toBeNull()
    })
  })

  describe('isAgentHeadMove', () => {
    const turn = (over: Partial<Pick<CliTurn, 'headShaAtStart' | 'queueCommitShas'>> = {}) => ({
      cwd: ROOT,
      headShaAtStart: 'start' as string | null,
      queueCommitShas: [] as readonly string[],
      ...over
    })

    it('is false when HEAD is unchanged (including null === null in non-repo)', () => {
      expect(isAgentHeadMove(turn(), 'start', () => ['x'])).toBe(false)
      expect(isAgentHeadMove(turn({ headShaAtStart: null }), null, () => ['x'])).toBe(false)
    })

    it('is true when the walk contains a sha the queue did not make', () => {
      expect(isAgentHeadMove(turn(), 'now', () => ['agent-sha'])).toBe(true)
    })

    it('is false when every intervening commit is a queue commit', () => {
      const t = turn({ queueCommitShas: ['qc1', 'qc2'] })
      expect(isAgentHeadMove(t, 'qc2', () => ['qc2', 'qc1'])).toBe(false)
    })

    it('catches an agent commit hiding beneath a later queue commit (mid-turn approval)', () => {
      // Agent commits, THEN the user approves an item: HEAD-now is the queue
      // commit, but the walk still surfaces the agent sha underneath it.
      const t = turn({ queueCommitShas: ['qc1'] })
      expect(isAgentHeadMove(t, 'qc1', () => ['qc1', 'agent-sha'])).toBe(true)
    })

    it('treats a failed walk (unreachable baseline — history rewritten) as moved', () => {
      expect(isAgentHeadMove(turn(), 'now', () => null)).toBe(true)
    })

    it('is true when a repo is born or HEAD vanishes mid-turn', () => {
      expect(isAgentHeadMove(turn({ headShaAtStart: null }), 'now', () => [])).toBe(true)
      expect(isAgentHeadMove(turn(), null, () => [])).toBe(true)
    })
  })

  describe('headShaAtStart', () => {
    it('captures the injected headSha at turnStarted time and exposes it on the turn', () => {
      const shas: Record<string, string | null> = {
        [ROOT]: 'sha-at-start',
        '/tmp/non-repo': null
      }
      const h = makeHarness({ headSha: (root) => shas[root] ?? null })
      h.setNow(0)

      const turn = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      expect(h.headShaCalls).toEqual([ROOT])
      expect(turn.headShaAtStart).toBe('sha-at-start')

      // The value flows through to the attributed match unchanged, even if
      // HEAD would resolve differently later
      shas[ROOT] = 'sha-moved-later'
      const match = h.registry.activeTurnFor(ROOT, 100)
      expect(match?.turn.headShaAtStart).toBe('sha-at-start')

      const nonRepo = h.registry.turnStarted({
        threadId: 'th2',
        agentId: 'claude',
        cwd: '/tmp/non-repo'
      })
      expect(nonRepo.headShaAtStart).toBeNull()
    })
  })

  describe('gateDegradedAtStart tagging (contracts §4 v1.2.1, OQ6)', () => {
    it('tags turns opened while the gate-health probe reports unhealthy', () => {
      let healthy = false
      const registry = new CliTurnRegistry({
        headSha: () => null,
        isPtyAlive: () => true,
        isGateHealthy: () => healthy,
        now: () => 0
      })

      const degraded = registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      expect(degraded.gateDegradedAtStart).toBe(true)

      healthy = true
      const clean = registry.turnStarted({ threadId: 'th2', agentId: 'claude', cwd: ROOT })
      expect(clean.gateDegradedAtStart).toBe(false)
    })

    it('the tag is fixed at turn START — later health changes never rewrite it', () => {
      let healthy = true
      const registry = new CliTurnRegistry({
        headSha: () => null,
        isPtyAlive: () => true,
        isGateHealthy: () => healthy,
        now: () => 0
      })
      const turn = registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      healthy = false
      const match = registry.activeTurnFor(ROOT, 100)
      expect(match?.turn.turnId).toBe(turn.turnId)
      expect(match?.turn.gateDegradedAtStart).toBe(false)
    })

    it('defaults to healthy (no tag) when the probe is unwired', () => {
      const h = makeHarness()
      const turn = h.registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
      expect(turn.gateDegradedAtStart).toBe(false)
    })
  })

  describe('attributionSuspect tagging (contracts §4 v1.2.2)', () => {
    it('turnStarted stores the tag from opts and defaults it to false', () => {
      const h = makeHarness()
      h.setNow(0)
      const suspect = h.registry.turnStarted({
        threadId: 'th1',
        agentId: 'claude',
        cwd: ROOT,
        attributionSuspect: true
      })
      expect(suspect.attributionSuspect).toBe(true)

      const clean = h.registry.turnStarted({ threadId: 'th2', agentId: 'claude', cwd: ROOT })
      expect(clean.attributionSuspect).toBe(false)
    })

    it('activeTurnFor exposes the tag on the match', () => {
      const h = makeHarness()
      h.setNow(0)
      h.registry.turnStarted({
        threadId: 'th1',
        agentId: 'claude',
        cwd: ROOT,
        attributionSuspect: true
      })
      const tagged = h.registry.activeTurnFor(ROOT, 100)
      expect(tagged?.attributionSuspect).toBe(true)

      h.registry.threadClosed('th1')
      h.setNow(200)
      h.registry.turnStarted({ threadId: 'th2', agentId: 'claude', cwd: ROOT })
      const untagged = h.registry.activeTurnFor(ROOT, 300)
      expect(untagged?.attributionSuspect).toBe(false)
    })
  })
})

// ── Step 6 (contracts §5 v1.2.6): per-thread invocation counting for maxTurns ──

describe('invocation counting + onTurnStarted callback (step 6)', () => {
  it('reports a per-thread running count on every turnStarted, including the current send', () => {
    const infos: Array<{
      threadId: string
      agentId: string
      cwd: string
      invocationCount: number
      slugInvocationCount: number
    }> = []
    const registry = new CliTurnRegistry({
      headSha: () => null,
      isPtyAlive: () => true,
      onTurnStarted: (info) => infos.push(info)
    })
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.turnStarted({ threadId: 'th2', agentId: 'claude', cwd: ROOT })
    expect(infos).toEqual([
      {
        threadId: 'th1',
        agentId: 'test-fixer',
        cwd: ROOT,
        invocationCount: 1,
        slugInvocationCount: 1
      },
      {
        threadId: 'th1',
        agentId: 'test-fixer',
        cwd: ROOT,
        invocationCount: 2,
        slugInvocationCount: 2
      },
      { threadId: 'th2', agentId: 'claude', cwd: ROOT, invocationCount: 1, slugInvocationCount: 1 }
    ])
  })

  it('threadClosed does NOT reset the count — a breaker kill must not refill the budget', () => {
    const counts: number[] = []
    const registry = new CliTurnRegistry({
      headSha: () => null,
      isPtyAlive: () => true,
      onTurnStarted: (info) => counts.push(info.invocationCount)
    })
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.threadClosed('th1')
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    expect(counts).toEqual([1, 2])
  })

  it('is a no-op without the callback (unwired: tests, early boot)', () => {
    const registry = new CliTurnRegistry({ headSha: () => null, isPtyAlive: () => true })
    expect(() =>
      registry.turnStarted({ threadId: 'th1', agentId: 'claude', cwd: ROOT })
    ).not.toThrow()
  })
})

// ── Phase 3 step 5: per-(root, slug) invocation rollup for maxTurnsPerSlug ──

describe('per-(root, slug) rollup (step 5)', () => {
  function collect() {
    const infos: Array<{ threadId: string; agentId: string; slugInvocationCount: number }> = []
    const registry = new CliTurnRegistry({
      headSha: () => null,
      isPtyAlive: () => true,
      onTurnStarted: (info) =>
        infos.push({
          threadId: info.threadId,
          agentId: info.agentId,
          slugInvocationCount: info.slugInvocationCount
        })
    })
    return { registry, infos }
  }

  it('N threads on one (root, slug) share a running aggregate count', () => {
    const { registry, infos } = collect()
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.turnStarted({ threadId: 'th2', agentId: 'test-fixer', cwd: ROOT })
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    expect(infos.map((i) => i.slugInvocationCount)).toEqual([1, 2, 3])
  })

  it('threadClosed does NOT reset the aggregate — a breaker kill must not refill the slug budget', () => {
    const { registry, infos } = collect()
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.threadClosed('th1')
    // A loop that kills-then-refires a fresh thread on the same slug resumes
    // at the accumulated aggregate within the app run.
    registry.turnStarted({ threadId: 'th2', agentId: 'test-fixer', cwd: ROOT })
    expect(infos.map((i) => i.slugInvocationCount)).toEqual([1, 2])
  })

  it('distinct roots and distinct slugs isolate their aggregates', () => {
    const { registry, infos } = collect()
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.turnStarted({ threadId: 'th2', agentId: 'test-fixer', cwd: '/tmp/ws-b' })
    registry.turnStarted({ threadId: 'th3', agentId: 'other-slug', cwd: ROOT })
    registry.turnStarted({ threadId: 'th4', agentId: 'test-fixer', cwd: ROOT })
    expect(infos.map((i) => i.slugInvocationCount)).toEqual([1, 1, 1, 2])
  })

  it('the NUL delimiter keeps concat-ambiguous (root, slug) pairs disjoint', () => {
    // ('/tmp/ws-a', 'bc') and ('/tmp/ws-ab', 'c') concatenate identically
    // without a delimiter; the NUL-keyed rollup must never merge them.
    const { registry, infos } = collect()
    registry.turnStarted({ threadId: 'th1', agentId: 'bc', cwd: '/tmp/ws-a' })
    registry.turnStarted({ threadId: 'th2', agentId: 'c', cwd: '/tmp/ws-ab' })
    expect(infos.map((i) => i.slugInvocationCount)).toEqual([1, 1])
  })

  it('unbound (adapter-identity) threads key separately and cannot drain a slug aggregate', () => {
    const { registry, infos } = collect()
    registry.turnStarted({ threadId: 'th1', agentId: 'cli-claude', cwd: ROOT })
    registry.turnStarted({ threadId: 'th2', agentId: 'cli-claude', cwd: ROOT })
    registry.turnStarted({ threadId: 'th3', agentId: 'test-fixer', cwd: ROOT })
    expect(infos).toEqual([
      { threadId: 'th1', agentId: 'cli-claude', slugInvocationCount: 1 },
      { threadId: 'th2', agentId: 'cli-claude', slugInvocationCount: 2 },
      { threadId: 'th3', agentId: 'test-fixer', slugInvocationCount: 1 }
    ])
  })
})
