/**
 * Main-side harness-run composition (workstation contracts §4/§6, v1.2.2).
 *
 * The renderer creates the thread and keeps the send timing; MAIN validates
 * the slug, re-checks the harness path at read time, composes the first-turn
 * prompt, and records the write-once thread↔slug binding — the binding is
 * recorded ONLY after main's own validation, so a forged renderer request can
 * never mint one. Each failure returns a structured error and records no
 * binding. The realpath re-check discharges contracts v1.1.5 residual #1
 * (read/exec-time re-check): equality, not containment — same rationale as
 * harness-service invariant 4.
 *
 * fs and registry are injected so composition unit-tests without Electron.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { TE_DIR } from '../../shared/constants'
import {
  buildHarnessPrompt,
  isReservedHarnessSlug,
  isValidHarnessSlug
} from '../../shared/harness-types'
import { SAFE_ID_RE } from '../../shared/git-types'
import { hasLintErrors } from '../../shared/harness-lint'
import { getHarnessRunRegistry } from './harness-run-registry'
import { lintHarnessOnDisk } from './harness-service'

export type HarnessRunResult =
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly error: string }

export interface HarnessRunDeps {
  readonly fs?: {
    readonly readFile: (filePath: string, encoding: 'utf8') => Promise<string>
    readonly realpath: (filePath: string) => Promise<string>
  }
  readonly registry?: {
    record(
      workspaceRoot: string,
      threadId: string,
      slug: string
    ): Promise<{ ok: true } | { ok: false; error: string }>
  }
}

const PROMPT_FILES = ['SKILL.md', 'rules.md', 'scope.json', 'state.md'] as const

export async function composeHarnessRun(
  workspaceRoot: string,
  slug: string,
  threadId: string,
  deps: HarnessRunDeps = {}
): Promise<HarnessRunResult> {
  const io = deps.fs ?? fs
  if (!isValidHarnessSlug(slug)) {
    return { ok: false, error: `invalid harness slug: ${JSON.stringify(slug)}` }
  }
  if (isReservedHarnessSlug(slug)) {
    return {
      ok: false,
      error: `harness slug collides with an adapter identity (reserved): ${slug}`
    }
  }
  // Enforces the registry key precondition at the mint boundary: a binding is
  // never recorded for a threadId main would refuse at spawn/input.
  if (!SAFE_ID_RE.test(threadId)) {
    return { ok: false, error: `invalid thread id: ${JSON.stringify(threadId)}` }
  }

  const dir = path.join(workspaceRoot, TE_DIR, 'agents', slug)
  let realDir: string
  let realRoot: string
  try {
    ;[realDir, realRoot] = await Promise.all([io.realpath(dir), io.realpath(workspaceRoot)])
  } catch (err) {
    return { ok: false, error: `harness "${slug}" is unreadable: ${String(err)}` }
  }
  if (realDir !== path.join(realRoot, TE_DIR, 'agents', slug)) {
    return {
      ok: false,
      error: `harness path escapes its contract location (symlinked parent?): ${slug}`
    }
  }

  // All four files, refuse on any failure — a harness prompt missing its
  // rules or scope must never reach an agent.
  const contents: string[] = []
  for (const file of PROMPT_FILES) {
    try {
      contents.push(await io.readFile(path.join(dir, file), 'utf8'))
    } catch (err) {
      return { ok: false, error: `harness "${slug}" is unreadable (${file}): ${String(err)}` }
    }
  }
  const [skillMd, rulesMd, scopeJson, stateMd] = contents

  // Run-time lint authority: the palette disable is enforced renderer-side
  // against the LIST-time snapshot, so a scope.json hand-tampered after the
  // palette opened (e.g. HARNESS_PROTECTED_GLOBS stripped) would still compose
  // a prompt and mint a binding. Re-run the same lint composition here — the
  // same fs∘shared checks harness:list uses, never reimplemented — and refuse
  // on any error-severity diagnostic. The read loop above already caught a
  // missing file; this catches tamper the fs reads cannot see.
  const diagnostics = await lintHarnessOnDisk(workspaceRoot, slug)
  if (hasLintErrors(diagnostics)) {
    const firstError = diagnostics.find((d) => d.severity === 'error')
    return {
      ok: false,
      error: `harness "${slug}" failed its run-time lint — run refused: ${firstError?.message} (${firstError?.file})`
    }
  }

  const prompt = buildHarnessPrompt({
    slug,
    harnessDir: `${TE_DIR}/agents/${slug}`,
    skillMd,
    rulesMd,
    scopeJson,
    stateMd
  })

  // Binding recorded LAST — only after every validation above passed.
  const registry = deps.registry ?? getHarnessRunRegistry()
  const recorded = await registry.record(workspaceRoot, threadId, slug)
  if (!recorded.ok) {
    return { ok: false, error: recorded.error }
  }
  return { ok: true, prompt }
}
