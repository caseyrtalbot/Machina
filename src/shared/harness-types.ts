/**
 * Agent harness shared types (workstation contracts §5, Phase 1 step 6).
 *
 * A harness is an on-disk folder under `<workspace>/<TE_DIR>/agents/<slug>/`
 * carrying a portable agent definition (SKILL.md), machine-checkable rules
 * (rules.md), a per-task scope contract (scope.json), a deterministic
 * verification gate (verify.sh, never agent-writable), repo memory (state.md),
 * and session handoff notes (handoffs/).
 *
 * Everything here is pure and dependency-free: both the main-process
 * generator (harness-service.ts) and the renderer runner (harness-run.ts)
 * import from this module.
 */
import { HARNESS_PROTECTED_GLOBS } from './constants'
import { AGENT_IDENTITIES } from './agent-identity'

// Re-exported so harness consumers have one import surface; the constant
// itself lives in constants.ts (landed with step 3's watcher auto-reject).
export { HARNESS_PROTECTED_GLOBS, isHarnessProtectedPath } from './constants'

// Re-based on AdapterId in workstation Phase 2 step 1 (the adapter registry
// owns the mapping now, including 'raw' → 'cli-raw'); kept here as a
// re-export so harness consumers keep one import surface. HARNESS_ADAPTERS
// itself stays CLI-only until step 8.
export { identityForAdapter } from './agent-adapters'

/** Adapters a harness can bind to — CLI back-ends only (contracts §5). */
export const HARNESS_ADAPTERS = ['claude', 'codex', 'gemini'] as const
export type HarnessAdapter = (typeof HARNESS_ADAPTERS)[number]

export function isHarnessAdapter(value: unknown): value is HarnessAdapter {
  return typeof value === 'string' && (HARNESS_ADAPTERS as readonly string[]).includes(value)
}

/**
 * Harness slug: lowercase alphanumeric + hyphens, must start alphanumeric,
 * max 41 chars. Deliberately excludes `/`, `.`, and anything else that could
 * traverse out of the agents directory — the slug becomes a path segment.
 */
export const HARNESS_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

export function isValidHarnessSlug(slug: string): boolean {
  return HARNESS_SLUG_RE.test(slug)
}

/**
 * Adapter-identity names are reserved: a harness slug byte-equal to an agent
 * identity (e.g. 'cli-claude') would make its commit trailers
 * indistinguishable from the adapter-identity fallback every ad-hoc or
 * degraded turn gets, corrupting revertAgent scope. Refused at create/run and
 * skipped by the binding backfill.
 */
export function isReservedHarnessSlug(slug: string): boolean {
  return (AGENT_IDENTITIES as readonly string[]).includes(slug)
}

/** Per-task scope contract — the curriculum 14.36 shape (contracts §5). */
export interface HarnessScope {
  readonly goal: string
  readonly allowedGlobs: readonly string[]
  readonly forbiddenGlobs: readonly string[]
  readonly acceptance: string
  readonly rollback: string
}

/**
 * The refuse-to-emit invariant (contracts §5): a scope contract is valid only
 * when its forbiddenGlobs are a superset of HARNESS_PROTECTED_GLOBS (both
 * `.machina` and `.machina-dev` variants — TE_DIR flips per runtime, the
 * on-disk contract must not). The generator aborts before any write when this
 * fails; callers never get a harness whose contract permits touching
 * verify.sh or rules.md.
 */
export function validateHarnessScope(
  scope: HarnessScope
): { ok: true } | { ok: false; error: string } {
  const forbidden = new Set(scope.forbiddenGlobs)
  const missing = HARNESS_PROTECTED_GLOBS.filter((glob) => !forbidden.has(glob))
  if (missing.length > 0) {
    return {
      ok: false,
      error: `scope contract is missing protected forbiddenGlobs: ${missing.join(', ')}`
    }
  }
  return { ok: true }
}

/** SKILL.md frontmatter (contracts §5; Phase 1 uses template defaults). */
export interface HarnessFrontmatter {
  readonly name: string
  readonly description: string
  readonly adapter: HarnessAdapter
  readonly permissionMode: 'queue-all-writes'
  readonly budgets: { readonly maxTurns: number; readonly maxWritesPerMinute: number }
}

/**
 * Palette-facing summary of one on-disk harness. Widened by the step-7
 * linter (contracts v1.2.4): every summary carries its lint diagnostics —
 * malformed harnesses surface greyed-with-reason instead of silently
 * vanishing from `harness:list`. `adapter` is null when the frontmatter is
 * unreadable (no honest adapter exists; such entries always carry an error
 * diagnostic, which disables run).
 */
export interface HarnessSummary {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly adapter: HarnessAdapter | null
  readonly diagnostics: readonly import('./harness-lint').Diagnostic[]
}

/** harness:create response (contracts §6). `root` = the created harness dir. */
export type HarnessCreateResult =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly error: string }

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Body of a markdown document with a leading `---` frontmatter block removed. */
export function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER_RE, '')
}

/**
 * Result-typed parser for the harness SKILL.md frontmatter. Hand-rolled for
 * the exact subset the generator emits (`key: value` lines plus the one
 * `budgets` flow mapping) so the shared kernel stays dependency-free — this
 * is NOT a general YAML parser. Anything it cannot read is a structured
 * error, which `harness:list` treats as skip-not-throw.
 */
export function parseHarnessFrontmatter(
  md: string
): { ok: true; value: HarnessFrontmatter } | { ok: false; error: string } {
  const match = FRONTMATTER_RE.exec(md)
  if (!match) return { ok: false, error: 'missing frontmatter block' }

  const fields = new Map<string, string>()
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep <= 0) return { ok: false, error: `unparseable frontmatter line: ${line}` }
    const key = line.slice(0, sep).trim()
    const value = line
      .slice(sep + 1)
      .trim()
      // Inline YAML comment (the template emits one on permissionMode).
      .replace(/\s+#.*$/, '')
      .replace(/^['"]|['"]$/g, '')
    fields.set(key, value)
  }

  const name = fields.get('name')
  const description = fields.get('description')
  const adapter = fields.get('adapter')
  const permissionMode = fields.get('permissionMode')
  const budgetsRaw = fields.get('budgets')
  if (!name || !description) return { ok: false, error: 'missing name or description' }
  if (!isHarnessAdapter(adapter)) return { ok: false, error: `unknown adapter: ${adapter}` }
  if (permissionMode !== 'queue-all-writes') {
    return { ok: false, error: `unsupported permissionMode: ${permissionMode}` }
  }
  const budgetsMatch = /^\{\s*maxTurns:\s*(\d+)\s*,\s*maxWritesPerMinute:\s*(\d+)\s*\}$/.exec(
    budgetsRaw ?? ''
  )
  if (!budgetsMatch) return { ok: false, error: `unparseable budgets: ${budgetsRaw}` }

  return {
    ok: true,
    value: {
      name,
      description,
      adapter,
      permissionMode,
      budgets: {
        maxTurns: Number(budgetsMatch[1]),
        maxWritesPerMinute: Number(budgetsMatch[2])
      }
    }
  }
}

export interface HarnessPromptParts {
  readonly slug: string
  /** Workspace-root-relative harness dir, e.g. `.machina-dev/agents/test-fixer`. */
  readonly harnessDir: string
  /** SKILL.md contents (frontmatter is stripped here). */
  readonly skillMd: string
  readonly rulesMd: string
  readonly scopeJson: string
  readonly stateMd: string
}

/**
 * Compose the first-turn prompt for a harness run. Pure: file contents in,
 * one string out. The verify instruction names the on-disk gate script so the
 * agent runs the deterministic check instead of improvising one.
 */
export function buildHarnessPrompt(parts: HarnessPromptParts): string {
  const verifyPath = `${parts.harnessDir}/verify.sh`
  return [
    `You are running the "${parts.slug}" harness in this repository.`,
    '',
    '## Skill',
    '',
    stripFrontmatter(parts.skillMd).trim(),
    '',
    '## Rules',
    '',
    parts.rulesMd.trim(),
    '',
    '## Scope contract (scope.json)',
    '',
    '```json',
    parts.scopeJson.trim(),
    '```',
    '',
    '## Repo memory (state.md)',
    '',
    parts.stateMd.trim(),
    '',
    '## Verification',
    '',
    `When you believe the task is complete, run \`sh ${verifyPath}\` from the repository root and report its full output. Do not edit, chmod, or delete ${verifyPath} or ${parts.harnessDir}/rules.md under any circumstances.`
  ].join('\n')
}
