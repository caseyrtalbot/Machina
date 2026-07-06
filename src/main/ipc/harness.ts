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
}
