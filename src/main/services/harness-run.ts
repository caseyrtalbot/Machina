/**
 * Main-side harness-run composition (workstation contracts §4/§6, v1.2.2).
 *
 * The renderer creates the thread and keeps the send timing; MAIN validates
 * the slug, inspects each run-critical leaf once, composes the first-turn
 * prompt from those exact linted bytes, and records the write-once
 * thread↔slug binding — the binding is
 * recorded ONLY after main's own validation, so a forged renderer request can
 * never mint one. Each failure returns a structured error and records no
 * binding. The realpath re-check discharges contracts v1.1.5 residual #1
 * (read/exec-time re-check): equality, not containment — same rationale as
 * harness-service invariant 4.
 *
 * Inspection and registry are injected so composition unit-tests without
 * Electron and can prove one-snapshot authority.
 */
import { TE_DIR } from '../../shared/constants'
import {
  buildHarnessPrompt,
  isReservedHarnessSlug,
  isValidHarnessSlug,
  validateHarnessTaskBrief,
  type HarnessAdapter,
  type HarnessBudgets
} from '../../shared/harness-types'
import { SAFE_ID_RE } from '../../shared/git-types'
import { hasLintErrors } from '../../shared/harness-lint'
import { getHarnessRunRegistry, type HarnessBinding } from './harness-run-registry'
import { inspectHarnessOnDisk, type HarnessInspection } from './harness-service'

export type HarnessRunResult =
  | { readonly ok: true; readonly prompt: string; readonly adapter: HarnessAdapter | null }
  | { readonly ok: false; readonly error: string }

export interface HarnessRunDeps {
  readonly inspect?: (workspaceRoot: string, slug: string) => Promise<HarnessInspection>
  readonly registry?: {
    record(
      workspaceRoot: string,
      threadId: string,
      slug: string,
      budgets?: HarnessBudgets,
      invocationTemplate?: string,
      adapter?: HarnessAdapter
    ): Promise<{ ok: true } | { ok: false; error: string }>
    get(workspaceRoot: string, threadId: string): HarnessBinding | undefined
  }
}

export async function composeHarnessRun(
  workspaceRoot: string,
  slug: string,
  threadId: string,
  taskBrief: string,
  deps: HarnessRunDeps = {}
): Promise<HarnessRunResult> {
  // Mandatory per-run goal validation is first: direct service callers must
  // not touch the filesystem or mint/load a binding for an invalid brief.
  const validatedTaskBrief = validateHarnessTaskBrief(taskBrief)
  if (!validatedTaskBrief.ok) return { ok: false, error: validatedTaskBrief.error }

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

  // One authoritative inspection owns both content lint and composition.
  // There is no second read whose result can diverge after lint passes.
  const inspect = deps.inspect ?? inspectHarnessOnDisk
  const inspection = await inspect(workspaceRoot, slug)
  if (hasLintErrors(inspection.diagnostics)) {
    const firstError = inspection.diagnostics.find((d) => d.severity === 'error')
    return {
      ok: false,
      error: `harness "${slug}" failed its run-time lint — run refused: ${firstError?.message} (${firstError?.file})`
    }
  }
  if (inspection.files === undefined || inspection.frontmatter === null) {
    return {
      ok: false,
      error: `harness "${slug}" has no stable validated snapshot — run refused`
    }
  }
  const { skillMd, rulesMd, scopeJson, stateMd } = inspection.files

  const prompt = buildHarnessPrompt({
    slug,
    harnessDir: `${TE_DIR}/agents/${slug}`,
    taskBrief: validatedTaskBrief.value,
    skillMd,
    rulesMd,
    scopeJson,
    stateMd
  })

  // Adapter, budgets, and raw invocation are parsed from the same SKILL.md
  // bytes above and snapshotted together. Later edits affect a future binding.
  const { adapter, budgets, invocationTemplate } = inspection.frontmatter

  // Binding recorded LAST — only after every validation above passed.
  const registry = deps.registry ?? getHarnessRunRegistry()
  const recorded = await registry.record(
    workspaceRoot,
    threadId,
    slug,
    budgets,
    invocationTemplate,
    adapter
  )
  if (!recorded.ok) {
    return { ok: false, error: recorded.error }
  }
  const authoritative = registry.get(workspaceRoot, threadId)
  if (authoritative === undefined || authoritative.slug !== slug) {
    return { ok: false, error: 'harness binding authority unavailable after record' }
  }
  return { ok: true, prompt, adapter: authoritative.adapter ?? null }
}
