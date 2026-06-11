import { TE_DIR } from '@shared/constants'
import type { Artifact } from '@shared/types'

/**
 * Cap per enrichment run. The native agent bounds one turn to
 * MAX_TOOL_ITERATIONS (8) *model rounds*, and one round can carry parallel
 * tool calls — so the prompt instructs batched rounds (all reads, then all
 * searches, then all edits: ~3-4 rounds for the whole batch). If the model
 * serializes per-note anyway, the run stops at the budget and the agent emits
 * a `turn_limit` event; the pill reports "stopped mid-batch" rather than
 * "finished". Repeated runs walk the backlog — enriched files drop out of the
 * selection on the next vault parse, which is the incremental bookkeeping
 * (no manifest).
 */
export const MAX_ENRICHMENT_TARGETS = 8

export interface EnrichmentTarget {
  readonly id: string
  readonly title: string
  /** Vault-relative path, as the native agent's note tools expect. */
  readonly path: string
}

/**
 * True when nothing ties the artifact into the knowledge graph: no tags, no
 * frontmatter relationships, and no body wikilinks. Matches what
 * graph-builder actually turns into edges, so a note with body [[wikilinks]]
 * but bare frontmatter is correctly counted as connected.
 */
export function isUnconnected(a: Artifact): boolean {
  return (
    a.tags.length === 0 &&
    a.connections.length === 0 &&
    a.clusters_with.length === 0 &&
    a.tensions_with.length === 0 &&
    a.related.length === 0 &&
    a.appears_in.length === 0 &&
    a.bodyLinks.length === 0
  )
}

function toVaultRelative(absPath: string, vaultPath: string): string | null {
  const root = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`
  return absPath.startsWith(root) ? absPath.slice(root.length) : null
}

/**
 * All enrichment candidates, sorted by path so batches are deterministic.
 * Excludes app-internal files under TE_DIR (the agent must never write there)
 * and artifacts whose path is unknown or outside the vault root.
 */
export function selectEnrichmentTargets(
  artifacts: readonly Artifact[],
  pathById: Readonly<Record<string, string>>,
  vaultPath: string
): EnrichmentTarget[] {
  const targets: EnrichmentTarget[] = []
  for (const a of artifacts) {
    if (!isUnconnected(a)) continue
    const abs = pathById[a.id]
    if (!abs) continue
    const rel = toVaultRelative(abs, vaultPath)
    if (rel === null) continue
    if (rel === TE_DIR || rel.startsWith(`${TE_DIR}/`)) continue
    targets.push({ id: a.id, title: a.title, path: rel })
  }
  return targets.sort((x, y) => x.path.localeCompare(y.path))
}

/** One-turn enrichment instruction for the native agent over a capped batch. */
export function buildEnrichmentPrompt(targets: readonly EnrichmentTarget[]): string {
  const list = targets.map((t) => `- ${t.path} ("${t.title}")`).join('\n')
  return `Enrich these unconnected vault notes so they join the knowledge graph:

${list}

For each note: read it first, then search the vault for genuinely related notes, and connect it with edit_note — add 2-4 frontmatter tags and [[wikilinks]] to the related notes (in frontmatter connections or woven into the body where natural). Preserve all existing content. Skip a note rather than inventing a connection that isn't real. Finish with a one-line summary per note of what you added.

You have a hard budget of 8 tool rounds for this turn, so batch your tool calls instead of working one note at a time: issue the read_note calls for ALL listed notes together in one parallel block, then the search_vault calls together, then the edit_note calls together.`
}
