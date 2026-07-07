/**
 * Harness IPC (workstation contracts §6, Phase 1 step 6).
 *
 * Neither channel takes a `root`: main resolves it from
 * `WorkspaceService.current()` so the renderer can never point the generator
 * at an arbitrary path. Before a workspace is open, harness:create returns a
 * structured error and harness:list returns an empty list — nothing throws
 * across the boundary.
 */
import { typedHandle } from '../typed-ipc'
import { getWorkspaceService } from '../services/workspace-service'
import { createHarness, listHarnesses } from '../services/harness-service'
import { composeHarnessRun } from '../services/harness-run'
import { getHarnessRunRegistry } from '../services/harness-run-registry'

function currentRoot(): string | null {
  return getWorkspaceService().current()?.root ?? null
}

export function registerHarnessIpc(): void {
  typedHandle('harness:create', async (args) => {
    const root = currentRoot()
    if (root === null) return { ok: false as const, error: 'no-workspace' }
    return createHarness(root, args.template, args.slug)
  })

  typedHandle('harness:list', async () => {
    const root = currentRoot()
    if (root === null) return []
    return listHarnesses(root)
  })

  typedHandle('harness:run', async (args) => {
    const root = currentRoot()
    if (root === null) return { ok: false as const, error: 'no-workspace' }
    try {
      // Backfill precedes the first bind after upgrade: a legacy thread's
      // frontmatter slug must already hold its binding before record() runs.
      await getHarnessRunRegistry().ensureRootReady(root)
      return await composeHarnessRun(root, args.slug, args.threadId)
    } catch (err) {
      // A throwing registry (backfill scan, mirror persist) stays inside the
      // structured-error contract — nothing throws across the boundary.
      return { ok: false as const, error: `harness run failed: ${String(err)}` }
    }
  })

  typedHandle('harness:binding', async (args) => {
    const root = currentRoot()
    if (root === null) return null
    // ensureRootReady loads the persisted mirror (registry.get is in-memory
    // only) — without it a post-relaunch chip read would miss every binding.
    const registry = getHarnessRunRegistry()
    try {
      await registry.ensureRootReady(root)
    } catch {
      // Display-only read path: a throwing registry reads as unbound.
      return null
    }
    const binding = registry.get(root, args.threadId)
    return binding === undefined ? null : { slug: binding.slug }
  })
}
