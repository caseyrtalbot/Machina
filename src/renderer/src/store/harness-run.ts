/**
 * Run a harness (workstation step 3 split): MAIN owns binding + composition —
 * `harness:run` validates the slug (realpath re-check), composes the
 * first-turn prompt from the four harness files, and records the write-once
 * thread↔slug binding. The renderer owns send timing: create the thread,
 * wait for the fresh PTY's shell to draw its prompt, then send main's prompt.
 * Moving the send into main would re-open the Phase-1 step-6 lost-reply
 * failure — the readiness wait needs block-store.
 */
import {
  identityForAdapter,
  validateHarnessTaskBrief,
  type HarnessSummary
} from '@shared/harness-types'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { useThreadStore } from './thread-store'
import { useBlockStore } from './block-store'
import { useCliSessionStore } from './cli-session-store'
import type { DispatchStatus } from './agent-transport'
import {
  captureWorkspaceDispatch,
  type WorkspaceDispatchToken,
  useAgentDispatchStore,
  workspaceDispatchIsCurrent
} from './agent-dispatch-store'
import { notifyError } from '../utils/error-logger'
import { withTimeout } from '../utils/ipc-timeout'

/** How long to wait for the fresh PTY's shell to draw its first prompt. */
const SHELL_READY_TIMEOUT_MS = 10_000
const SHELL_READY_POLL_MS = 150
const HARNESS_RUN_IPC_TIMEOUT_MS = 15_000

async function waitForThreadShellPrompt(
  threadId: string,
  timeoutMs = SHELL_READY_TIMEOUT_MS
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const session = useCliSessionStore.getState().byThread[threadId]
    if (session?.live && useBlockStore.getState().getBlocks(session.sessionId).length > 0) return
    await new Promise((resolve) => setTimeout(resolve, SHELL_READY_POLL_MS))
  }
}

export type HarnessLaunchStatus = DispatchStatus

function finishHarnessLaunch(
  workspacePath: string,
  slug: string,
  status: HarnessLaunchStatus,
  threadId?: string
): HarnessLaunchStatus {
  useAgentDispatchStore
    .getState()
    .setHarnessLaunch(
      workspacePath,
      slug,
      status === 'indeterminate'
        ? { status: 'indeterminate', ...(threadId ? { threadId } : {}) }
        : null
    )
  return status
}

async function cleanupRefusedLaunch(
  threadId: string,
  timeoutMs: number,
  workspace: WorkspaceDispatchToken
): Promise<HarnessLaunchStatus> {
  try {
    const cleanup = workspaceDispatchIsCurrent(workspace)
      ? useThreadStore.getState().deleteThread(threadId)
      : window.api.thread.delete(workspace.workspacePath, threadId)
    await withTimeout(cleanup, timeoutMs, `thread:delete provisional ${threadId}`)
    return 'refused'
  } catch (error) {
    notifyError(
      'harness-run',
      error,
      'Provisional thread cleanup status is unknown. It may still disappear; do not retry this launch.'
    )
    return 'indeterminate'
  }
}

type CreatedHarnessThread = Awaited<
  ReturnType<ReturnType<typeof useThreadStore.getState>['createThread']>
>
type MainHarnessRun = Awaited<ReturnType<typeof window.api.harness.run>>

async function completeHarnessRun(
  summary: HarnessSummary,
  t: CreatedHarnessThread,
  run: MainHarnessRun,
  ipcTimeoutMs: number,
  workspace: WorkspaceDispatchToken,
  shellReadyTimeoutMs?: number
): Promise<HarnessLaunchStatus> {
  if (!workspaceDispatchIsCurrent(workspace)) {
    notifyError(
      'harness-run',
      new Error('workspace changed while harness launch was pending'),
      `Harness "${summary.slug}" belongs to the previous workspace and was not dispatched.`
    )
    return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'indeterminate', t.id)
  }
  if (!run.ok) {
    notifyError(
      'harness-run',
      new Error(run.error),
      `Harness "${summary.slug}" could not start — run not started.`
    )
    return finishHarnessLaunch(
      workspace.workspacePath,
      summary.slug,
      await cleanupRefusedLaunch(t.id, ipcTimeoutMs, workspace),
      t.id
    )
  }

  if (run.adapter === null) {
    notifyError(
      'harness-run',
      new Error('main returned no authoritative harness adapter'),
      `Harness "${summary.slug}" has no runnable adapter. Repair its diagnostics and try again.`
    )
    return finishHarnessLaunch(
      workspace.workspacePath,
      summary.slug,
      await cleanupRefusedLaunch(t.id, ipcTimeoutMs, workspace),
      t.id
    )
  }
  const expectedIdentity = identityForAdapter(run.adapter)
  if (t.agent !== expectedIdentity) {
    notifyError(
      'harness-run',
      new Error(
        `harness adapter changed from ${summary.adapter} to ${run.adapter}; refusing stale launch`
      ),
      `Harness "${summary.slug}" changed while opening. Reopen it and try again.`
    )
    return finishHarnessLaunch(
      workspace.workspacePath,
      summary.slug,
      await cleanupRefusedLaunch(t.id, ipcTimeoutMs, workspace),
      t.id
    )
  }

  try {
    await withTimeout(
      useThreadStore.getState().setThreadAgentId(t.id, summary.slug),
      ipcTimeoutMs,
      `thread:bind harness ${t.id}`
    )
  } catch (error) {
    notifyError(
      'harness-run',
      error,
      `Harness "${summary.slug}" binding persistence is unknown. Do not retry this launch.`
    )
    return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'indeterminate', t.id)
  }

  await waitForThreadShellPrompt(t.id, shellReadyTimeoutMs)
  if (!workspaceDispatchIsCurrent(workspace))
    return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'indeterminate', t.id)
  try {
    const delivery = await withTimeout(
      useThreadStore.getState().appendUserMessage(run.prompt, t.id),
      ipcTimeoutMs,
      `thread:dispatch harness ${t.id}`
    )
    if (delivery === 'accepted')
      return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'accepted', t.id)
    if (delivery === 'refused')
      return finishHarnessLaunch(
        workspace.workspacePath,
        summary.slug,
        await cleanupRefusedLaunch(t.id, ipcTimeoutMs, workspace),
        t.id
      )
    notifyError(
      'harness-run',
      new Error('first-turn delivery status is unknown'),
      `Harness "${summary.slug}" may still execute. Do not retry; inspect the thread and terminal.`
    )
    return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'indeterminate', t.id)
  } catch (error) {
    notifyError(
      'harness-run',
      error,
      `Harness "${summary.slug}" may still execute. Do not retry; inspect the thread and terminal.`
    )
    return finishHarnessLaunch(workspace.workspacePath, summary.slug, 'indeterminate', t.id)
  }
}

export async function runHarness(
  summary: HarnessSummary,
  taskBrief: string,
  opts?: { readonly shellReadyTimeoutMs?: number; readonly ipcTimeoutMs?: number }
): Promise<HarnessLaunchStatus> {
  // Main validates again at the trust boundary. This renderer-side twin keeps
  // invalid operator input from creating an orphan thread before that refusal.
  const validatedTaskBrief = validateHarnessTaskBrief(taskBrief)
  if (!validatedTaskBrief.ok) {
    notifyError('harness-run', new Error(validatedTaskBrief.error))
    return 'refused'
  }
  // Defensive twin of the palette's disable (step-7 linter): a harness with
  // error-severity diagnostics — or no readable adapter — never starts a
  // thread, whatever surface called this.
  if (summary.adapter === null || summary.diagnostics.some((d) => d.severity === 'error')) {
    notifyError(
      'harness-run',
      new Error(`harness "${summary.slug}" has lint errors — run disabled`)
    )
    return 'refused'
  }
  const store = useThreadStore.getState()
  const workspacePath = store.vaultPath
  if (!workspacePath) {
    notifyError('harness-run', new Error('no workspace open'))
    return 'refused'
  }
  const workspace = captureWorkspaceDispatch(workspacePath)
  const dispatch = useAgentDispatchStore.getState()
  if (dispatch.harnessLaunchByWorkspace[workspacePath]?.[summary.slug] !== undefined) {
    notifyError(
      'harness-run',
      new Error('previous launch has not settled'),
      `Harness "${summary.slug}" already has an unresolved launch. Do not retry it.`
    )
    return 'indeterminate'
  }
  dispatch.setHarnessLaunch(workspacePath, summary.slug, { status: 'starting' })
  const ipcTimeoutMs = opts?.ipcTimeoutMs ?? HARNESS_RUN_IPC_TIMEOUT_MS

  let t: Awaited<ReturnType<typeof store.createThread>>
  try {
    t = await withTimeout(
      store.createThread(identityForAdapter(summary.adapter), DEFAULT_NATIVE_MODEL, summary.slug),
      ipcTimeoutMs,
      `thread:create harness ${summary.slug}`
    )
  } catch (error) {
    notifyError(
      'harness-run',
      error,
      `Harness "${summary.slug}" creation status is unknown. A thread may still appear; do not retry.`
    )
    return finishHarnessLaunch(workspacePath, summary.slug, 'indeterminate')
  }
  if (!workspaceDispatchIsCurrent(workspace))
    return finishHarnessLaunch(workspacePath, summary.slug, 'indeterminate', t.id)
  dispatch.setHarnessLaunch(workspacePath, summary.slug, { status: 'starting', threadId: t.id })

  let run: MainHarnessRun
  const operation = window.api.harness.run(summary.slug, t.id, validatedTaskBrief.value)
  try {
    run = await withTimeout(operation, ipcTimeoutMs, `harness:run ${summary.slug}`)
  } catch (error) {
    void operation
      .then((late) =>
        completeHarnessRun(summary, t, late, ipcTimeoutMs, workspace, opts?.shellReadyTimeoutMs)
      )
      .catch(() => {})
    notifyError(
      'harness-run',
      error,
      `Harness "${summary.slug}" launch status is unknown. Main may still bind it; do not retry.`
    )
    return finishHarnessLaunch(workspacePath, summary.slug, 'indeterminate', t.id)
  }
  return completeHarnessRun(summary, t, run, ipcTimeoutMs, workspace, opts?.shellReadyTimeoutMs)
}
