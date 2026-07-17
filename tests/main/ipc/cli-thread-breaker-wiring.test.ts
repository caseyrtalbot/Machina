// @vitest-environment node
/**
 * Behavioral pin of the maxTurns budget wiring (post-merge review hardening,
 * contracts §8 v1.2.7 — review findings "budget enforcement silently
 * disengages when the bindings mirror is not loaded" and "maxTurns wiring is
 * pinned only as mock plumbing").
 *
 * Everything on the enforcement path is REAL: `registerCliThreadIpc()`
 * registers the turn-started listener (deleting that registration fails this
 * file), the real CliTurnRegistry counts invocations, the real
 * HarnessRunRegistry loads a real persisted mirror from disk, and the real
 * AgentCircuitBreaker latches the trip. Only the process edges are faked:
 * electron paths, typed-ipc, the shell service, and the kill callback — set
 * through the same late-bound seam (`setBreakerKillCallback`) production
 * wires to `spawner.close`.
 *
 * The failing repro this file was born from: a harness-bound thread whose
 * frontmatter agent_id was stripped forwards NO agentId after relaunch, so
 * nothing on the turn path loaded the mirror — `get()` returned undefined and
 * the thread ran with no maxTurns enforcement, silently. The listener must
 * load the mirror itself on every turn open.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirs = vi.hoisted(() => ({ userData: '' }))

const ipcCtl = vi.hoisted(() => ({
  handlers: new Map<string, (args?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getPath: () => dirs.userData }
}))

vi.mock('../../../src/main/typed-ipc', () => ({
  typedHandle: (channel: string, handler: (args?: unknown) => unknown) => {
    ipcCtl.handlers.set(channel, handler)
  },
  typedSend: vi.fn()
}))

vi.mock('../../../src/main/window-registry', () => ({
  getMainWindow: () => null
}))

vi.mock('../../../src/main/ipc/shell', () => ({
  getShellService: () => ({}),
  getCliAgentThreadBridge: () => ({})
}))

vi.mock('../../../src/main/services/audit-logger', () => ({
  AuditLogger: class {
    log = vi.fn()
  }
}))

const TH = 'th-00000001'
const SLUG = 'test-fixer'

/** Seed the REAL persisted mirror the registry lazy-loads from disk. */
function seedMirror(wsRoot: string, budgets?: { maxTurns: number; maxWritesPerMinute: number }) {
  mkdirSync(dirs.userData, { recursive: true })
  writeFileSync(
    join(dirs.userData, 'harness-bindings.json'),
    JSON.stringify({
      version: 1,
      // Marked backfilled so ensureRootReady loads WITHOUT re-scanning threads.
      backfilledRoots: [wsRoot],
      bindings: {
        [`${wsRoot}\0${TH}`]: {
          slug: SLUG,
          workspaceRoot: wsRoot,
          ...(budgets !== undefined ? { budgets } : {})
        }
      }
    })
  )
}

let wsRoot: string | null = null

beforeEach(() => {
  vi.resetModules()
  ipcCtl.handlers.clear()
  dirs.userData = mkdtempSync(join(tmpdir(), 'te-breaker-wiring-userdata-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'te-breaker-wiring-ws-'))
})

afterEach(() => {
  for (const dir of [dirs.userData, wsRoot]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  wsRoot = null
})

async function wire() {
  const cliThread = await import('../../../src/main/ipc/cli-thread')
  const breakerMod = await import('../../../src/main/services/agent-circuit-breaker')
  const registryMod = await import('../../../src/main/services/cli-turn-registry')
  const kills: string[] = []
  breakerMod.setBreakerKillCallback((threadId) => kills.push(threadId))
  // THE seam under test: the real registration path. Deleting the
  // setTurnStartedListener block in registerCliThreadIpc fails every
  // assertion below.
  cliThread.registerCliThreadIpc()
  return { registry: registryMod.getCliTurnRegistry(), breaker: breakerMod, kills }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 75))

describe('maxTurns enforcement through the REAL registration path', () => {
  it('enforces the bound budget on a turn path that never loaded the mirror (the relaunch repro)', async () => {
    seedMirror(wsRoot!, { maxTurns: 1, maxWritesPerMinute: 5 })
    const { registry, breaker, kills } = await wire()

    // Nothing has loaded the mirror: no harness:run, no forwarded agentId.
    // Budget 1 allows exactly one invocation…
    registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: wsRoot! })
    await settle()
    expect(kills).toEqual([])

    // …and the second send must trip, even though this turn path never
    // touched the attribution/run code that used to load the mirror.
    registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: wsRoot! })
    // Deferral pin: the kill must NEVER run synchronously inside the send —
    // a synchronous close would yank the session from under the in-flight
    // PTY write.
    expect(kills).toEqual([])
    await vi.waitFor(() => expect(kills).toEqual([TH]))

    // Trip latched and honest in status (also pins noteTurnStarted-before-
    // noteMaxTurns: the swapped order would erase the trip it just recorded).
    const status = breaker.getAgentCircuitBreaker().status()
    expect(status.trips).toHaveLength(1)
    expect(status.trips[0]).toMatchObject({
      threadId: TH,
      agentId: SLUG,
      reason: 'max-turns',
      action: 'killed'
    })
  })

  it('a thread with no bound budgets is never budget-tripped (unbound/ad-hoc degrade)', async () => {
    seedMirror(wsRoot!) // binding exists but carries NO budgets snapshot
    const { registry, kills } = await wire()
    for (let i = 0; i < 3; i++) {
      registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: wsRoot! })
    }
    await settle()
    expect(kills).toEqual([])
  })

  it('a failing registry degrades to unbound — the turn is never blocked or killed', async () => {
    // No mirror file at all and an unreadable userData dir path: ensureRootReady
    // resolves to empty state (load never throws) — enforcement simply has
    // nothing to enforce. The turn proceeds; no throw escapes the listener.
    const { registry, kills } = await wire()
    registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: wsRoot! })
    await settle()
    expect(kills).toEqual([])
  })
})

// ── Phase 3 step 5: per-(root, slug) aggregate ceiling through the real path ──

const TH_A = 'th-aggregate-a'
const TH_B = 'th-aggregate-b'

/** Two same-slug bindings sharing an aggregate budget (maxTurnsPerSlug: 3). */
function seedMirrorSlugAggregate(wsRoot: string) {
  mkdirSync(dirs.userData, { recursive: true })
  const budgets = { maxTurns: 10, maxWritesPerMinute: 5, maxTurnsPerSlug: 3 }
  writeFileSync(
    join(dirs.userData, 'harness-bindings.json'),
    JSON.stringify({
      version: 1,
      backfilledRoots: [wsRoot],
      bindings: {
        [`${wsRoot}\0${TH_A}`]: { slug: SLUG, workspaceRoot: wsRoot, budgets },
        [`${wsRoot}\0${TH_B}`]: { slug: SLUG, workspaceRoot: wsRoot, budgets }
      }
    })
  )
}

describe('maxTurnsPerSlug enforcement through the REAL registration path (step 5)', () => {
  it('same-slug threads consume the aggregate; the N+1th turn trips on the breaching thread', async () => {
    seedMirrorSlugAggregate(wsRoot!)
    const { registry, breaker, kills } = await wire()

    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_B, agentId: SLUG, cwd: wsRoot! })
    await settle()
    // Aggregate exactly 3 (= budget), every per-thread count far under
    // maxTurns (10): no trip — budget N allows exactly N.
    expect(kills).toEqual([])

    registry.turnStarted({ threadId: TH_B, agentId: SLUG, cwd: wsRoot! })
    await vi.waitFor(() => expect(kills).toEqual([TH_B]))
    const status = breaker.getAgentCircuitBreaker().status()
    const trip = status.trips.find((t) => t.threadId === TH_B)
    expect(trip).toMatchObject({ agentId: SLUG, reason: 'max-turns', action: 'killed' })
    // The slug-aggregate numbers survive whichever detail wording the
    // breaker renders (the scope-aware wording lands with the noteMaxTurns
    // widening in this same step's cost track).
    expect(trip?.detail).toContain('4')
    expect(trip?.detail).toContain('(3)')
  })

  it('degraded attribution (adapter-identity fallback) is neither judged against nor drains the slug ceiling (v1.3.4 review fix)', async () => {
    seedMirrorSlugAggregate(wsRoot!) // maxTurnsPerSlug: 3
    const { registry, kills } = await wire()
    // Unrelated ad-hoc unbound threads inflate the SHARED cli-claude pool
    // far past the bound budget — they carry no budgets and never trip.
    for (let i = 0; i < 5; i++) {
      registry.turnStarted({ threadId: `th-adhoc-${i}`, agentId: 'cli-claude', cwd: wsRoot! })
    }
    await settle()
    expect(kills).toEqual([])
    // A degraded send on the BOUND thread (registry-error/adapter-unknown
    // shape: adapter-identity attribution + suspect tag) counts as
    // cli-claude #6 > 3. Its binding's budgets ARE found by threadId — the
    // old code compared the foreign pool count against maxTurnsPerSlug and
    // kill-classed a slug whose real aggregate was 0.
    registry.turnStarted({
      threadId: TH_A,
      agentId: 'cli-claude',
      cwd: wsRoot!,
      attributionSuspect: true
    })
    await settle()
    expect(kills).toEqual([])
    // The slug pool itself was untouched: three healthy sends still fit…
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_B, agentId: SLUG, cwd: wsRoot! })
    await settle()
    expect(kills).toEqual([])
    // …and the 4th slug-pool send trips as before.
    registry.turnStarted({ threadId: TH_B, agentId: SLUG, cwd: wsRoot! })
    await vi.waitFor(() => expect(kills).toEqual([TH_B]))
  })

  it('a kill (threadClosed) between sends does not refill the slug aggregate', async () => {
    seedMirrorSlugAggregate(wsRoot!)
    const { registry, kills } = await wire()
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    registry.turnStarted({ threadId: TH_A, agentId: SLUG, cwd: wsRoot! })
    await settle()
    expect(kills).toEqual([])
    // The kill path drops the window with zero linger…
    registry.threadClosed(TH_A)
    // …and the sibling thread resumes at the accumulated aggregate: 4 > 3.
    registry.turnStarted({ threadId: TH_B, agentId: SLUG, cwd: wsRoot! })
    await vi.waitFor(() => expect(kills).toEqual([TH_B]))
  })
})

describe('turn attribution across a symlink alias of the workspace root (v1.2.7)', () => {
  // THE velocity-breaker e2e root cause: WorkspaceService canonicalizes the
  // root (realpath), so the agent-write watcher runs on `/private/var/...`,
  // but a caller-supplied turn cwd can be a symlink alias (`/var/...` — every
  // macOS tmpdir, or any user-symlinked vault). `isInside` compared the raw
  // strings, the turn never matched the watcher root, and EVERY agent write
  // was routed "outside any turn window": no queue capture, no velocity
  // signals, no breaker coverage — silent containment loss. The registry must
  // resolve path identity, not string identity.
  it('activeTurnFor(canonical root) attributes a turn opened with an alias cwd', async () => {
    const { registry } = await wire()
    const registryMod = await import('../../../src/main/services/cli-turn-registry')
    registryMod.setPtyAliveProbe(() => true)

    const real = realpathSync(wsRoot!)
    const aliasParent = mkdtempSync(join(tmpdir(), 'te-breaker-alias-'))
    try {
      const alias = join(aliasParent, 'ws')
      symlinkSync(real, alias)

      // The e2e repro: the turn opens with the alias cwd; the watcher asks
      // with the canonical root it was built on.
      registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: alias })
      const match = registry.activeTurnFor(real)
      expect(match).not.toBeNull()
      expect(match?.turn.threadId).toBe(TH)
    } finally {
      rmSync(aliasParent, { recursive: true, force: true })
    }
  })

  it('gate commits made under the canonical root are excused on alias-cwd turn windows', async () => {
    const { registry } = await wire()
    const registryMod = await import('../../../src/main/services/cli-turn-registry')
    registryMod.setPtyAliveProbe(() => true)

    const real = realpathSync(wsRoot!)
    const aliasParent = mkdtempSync(join(tmpdir(), 'te-breaker-alias-'))
    try {
      const alias = join(aliasParent, 'ws')
      symlinkSync(real, alias)

      registry.turnStarted({ threadId: TH, agentId: SLUG, cwd: alias })
      // Same identity rule on the noteGateCommitForRoot path (revert excusal):
      // a revert sha recorded against the canonical root must reach the
      // alias-cwd window, or the headMoved tripwire reads the gate's own
      // revert as agent git activity.
      registry.noteGateCommitForRoot(real, 'a'.repeat(40))
      const match = registry.activeTurnFor(real)
      expect(match?.turn.queueCommitShas).toContain('a'.repeat(40))
    } finally {
      rmSync(aliasParent, { recursive: true, force: true })
    }
  })
})
