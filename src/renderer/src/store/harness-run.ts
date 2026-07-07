/**
 * Run a harness (workstation step 3 split): MAIN owns binding + composition —
 * `harness:run` validates the slug (realpath re-check), composes the
 * first-turn prompt from the four harness files, and records the write-once
 * thread↔slug binding. The renderer owns send timing: create the thread,
 * wait for the fresh PTY's shell to draw its prompt, then send main's prompt.
 * Moving the send into main would re-open the Phase-1 step-6 lost-reply
 * failure — the readiness wait needs block-store.
 */
import { identityForAdapter, type HarnessSummary } from '@shared/harness-types'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { useThreadStore } from './thread-store'
import { useBlockStore } from './block-store'
import { notifyError } from '../utils/error-logger'

/** How long to wait for the fresh PTY's shell to draw its first prompt. */
const SHELL_READY_TIMEOUT_MS = 10_000
const SHELL_READY_POLL_MS = 150

/**
 * Wait until a session NOT in `before` shows up in block-store — i.e. the
 * PTY that createThread just spawned drew its first prompt (rc files ran,
 * te shell hooks are live). Sending the first turn earlier types the
 * invocation into a half-initialized shell: the block protocol mis-captures
 * the command (prompt echo instead of `claude …`), agent detection in
 * CliAgentThreadBridge fails, and the reply is never mirrored into the
 * thread. Humans never hit this (they type seconds after spawn); this
 * scripted path must wait. On timeout we proceed anyway — same behavior as
 * before the wait existed, and write attribution is unaffected either way.
 */
async function waitForNewShellPrompt(
  before: ReadonlySet<string>,
  timeoutMs = SHELL_READY_TIMEOUT_MS
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const sessions = Object.keys(useBlockStore.getState().blocksBySession)
    if (sessions.some((sid) => !before.has(sid))) return
    await new Promise((resolve) => setTimeout(resolve, SHELL_READY_POLL_MS))
  }
}

export async function runHarness(
  summary: HarnessSummary,
  opts?: { readonly shellReadyTimeoutMs?: number }
): Promise<void> {
  // Defensive twin of the palette's disable (step-7 linter): a harness with
  // error-severity diagnostics — or no readable adapter — never starts a
  // thread, whatever surface called this.
  if (summary.adapter === null || summary.diagnostics.some((d) => d.severity === 'error')) {
    notifyError(
      'harness-run',
      new Error(`harness "${summary.slug}" has lint errors — run disabled`)
    )
    return
  }
  const store = useThreadStore.getState()
  if (!store.vaultPath) {
    notifyError('harness-run', new Error('no workspace open'))
    return
  }

  // Model mirrors what AgentPicker passes for CLI threads (unused by the CLI
  // invocation itself). Created WITHOUT an agentId: attribution is assigned
  // by main recording the binding inside harness:run, so the createThread
  // spawn never forwards an unbound agentId.
  const sessionsBefore = new Set(Object.keys(useBlockStore.getState().blocksBySession))
  const t = await store.createThread(
    identityForAdapter(summary.adapter),
    DEFAULT_NATIVE_MODEL,
    summary.slug
  )

  // A rejected invoke (registry threw main-side — not a structured refusal)
  // must not orphan the just-created thread + PTY: fold it into the same
  // refusal cleanup.
  let run: Awaited<ReturnType<typeof window.api.harness.run>>
  try {
    run = await window.api.harness.run(summary.slug, t.id)
  } catch (err) {
    run = { ok: false, error: String(err) }
  }
  if (!run.ok) {
    notifyError(
      'harness-run',
      new Error(run.error),
      `Harness "${summary.slug}" could not start — run not started.`
    )
    // A refused run leaves nothing behind: delete the just-created thread so
    // the net effect is "no thread created".
    await useThreadStore.getState().deleteThread(t.id)
    return
  }

  // Display + future input forwarding only — main validated and bound the
  // slug above; every later turn re-validates the forwarded value against it.
  await useThreadStore.getState().setThreadAgentId(t.id, summary.slug)

  await waitForNewShellPrompt(sessionsBefore, opts?.shellReadyTimeoutMs)
  await useThreadStore.getState().appendUserMessage(run.prompt)
}
