/**
 * Run a harness (workstation step 6): read the four prompt-composition files
 * in ONE fs:read-files-batch, compose the first-turn prompt, create a CLI
 * thread titled by the slug with the slug as its attribution agentId, and
 * send the prompt as the first user message. Zero spawner/transport changes —
 * this is the existing adapter path end-to-end.
 */
import { TE_DIR } from '@shared/constants'
import { buildHarnessPrompt, identityForAdapter, type HarnessSummary } from '@shared/harness-types'
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
  const store = useThreadStore.getState()
  const root = store.vaultPath
  if (!root) {
    notifyError('harness-run', new Error('no workspace open'))
    return
  }

  const harnessDir = `${TE_DIR}/agents/${summary.slug}`
  const abs = (file: string): string => `${root}/${harnessDir}/${file}`
  const files = ['SKILL.md', 'rules.md', 'scope.json', 'state.md'] as const

  // One batch, exactly four files. A failed read creates no thread — a
  // harness prompt missing its rules or scope must never reach an agent.
  const results = await window.api.fs.readFilesBatch(files.map(abs))
  const byPath = new Map(results.map((r) => [r.path, r]))
  const contents: string[] = []
  for (const file of files) {
    const r = byPath.get(abs(file))
    if (!r || r.content === null) {
      notifyError(
        'harness-run',
        new Error(r?.error ?? 'read failed'),
        `Harness "${summary.slug}" is unreadable (${file}) — run not started.`
      )
      return
    }
    contents.push(r.content)
  }
  const [skillMd, rulesMd, scopeJson, stateMd] = contents

  const prompt = buildHarnessPrompt({
    slug: summary.slug,
    harnessDir,
    skillMd,
    rulesMd,
    scopeJson,
    stateMd
  })

  // Model mirrors what AgentPicker passes for CLI threads (unused by the CLI
  // invocation itself). The slug is both the title and the attribution id.
  const sessionsBefore = new Set(Object.keys(useBlockStore.getState().blocksBySession))
  await store.createThread(
    identityForAdapter(summary.adapter),
    DEFAULT_NATIVE_MODEL,
    summary.slug,
    summary.slug
  )
  await waitForNewShellPrompt(sessionsBefore, opts?.shellReadyTimeoutMs)
  await useThreadStore.getState().appendUserMessage(prompt)
}
