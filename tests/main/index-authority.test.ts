// @vitest-environment node
//
// PLAN Layer 1 item 5 — "one index authority" as permanent greppable invariants.
// The main-process VaultIndex is the single parse authority; the renderer
// vault-worker is a diff-fed projection (graph + search built from main-parsed
// VaultIndexEntry upserts, never from raw markdown). These scans fail with the
// offending file if a second parse+graph ingestion path reappears.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const rel = (abs: string): string => relative(REPO_ROOT, abs)
const SRC = join(REPO_ROOT, 'src')

/** All .ts/.tsx source files under src/ (excluding tests). */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      out.push(...sourceFiles(abs))
    } else if (/\.(ts|tsx)$/.test(abs) && !/\.(test|spec)\./.test(abs)) {
      out.push(abs)
    }
  }
  return out
}

/** Files whose source matches re, excluding colocated __tests__ dirs. */
function filesInvoking(re: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((abs) => !abs.includes('__tests__'))
    .filter((abs) => re.test(readFileSync(abs, 'utf-8')))
    .map(rel)
    .sort()
}

describe('index-authority invariants (PLAN Layer 1 item 5)', () => {
  it('parseArtifact is invoked from exactly one ingestion site (VaultIndex)', () => {
    // Invocation (`parseArtifact(...)`) — parser.ts holds the definition
    // (`function parseArtifact(`), which the negative lookbehind excludes.
    // Re-export sites (`export { parseArtifact }`) never match a call.
    const invokers = filesInvoking(/(?<!function )parseArtifact\(/)
    expect(
      invokers,
      'markdown may be parsed into Artifacts only inside VaultIndex (src/shared/engine/indexer.ts)'
    ).toEqual(['src/shared/engine/indexer.ts'])
  })

  it('buildGraph is invoked only by VaultIndex and the worker projection', () => {
    const invokers = filesInvoking(/(?<!function )buildGraph\(/)
    expect(
      invokers,
      'graph ingestion is VaultIndex (authority) + vault-worker-helpers (projection) only'
    ).toEqual(['src/renderer/src/engine/vault-worker-helpers.ts', 'src/shared/engine/indexer.ts'])
  })

  it('the worker projection ingests parsed entries, never raw markdown', () => {
    // The worker must not import the parser (directly or via gray-matter): its
    // only input is VaultIndexEntry objects parsed by the main process.
    const helpers = readFileSync(
      join(REPO_ROOT, 'src/renderer/src/engine/vault-worker-helpers.ts'),
      'utf-8'
    )
    expect(helpers, 'vault-worker-helpers.ts must not import the artifact parser').not.toMatch(
      /parseArtifact/
    )
    expect(helpers, 'vault-worker-helpers.ts must not parse frontmatter itself').not.toMatch(
      /gray-matter/
    )
    expect(helpers, 'vault-worker-helpers.ts must ingest VaultIndexEntry diffs').toMatch(
      /VaultIndexEntry/
    )
  })

  it('the system-artifact runtime no longer parses or graph-builds inline', () => {
    // Item 5 deleted syncSystemArtifactFromDisk: system-artifact edits flow
    // through watcher → main VaultIndex → vault:index-delta like every note.
    const runtime = readFileSync(
      join(REPO_ROOT, 'src/renderer/src/system-artifacts/system-artifact-runtime.ts'),
      'utf-8'
    )
    for (const banned of [
      'parseArtifact',
      'buildGraph',
      'readFile',
      'syncSystemArtifactFromDisk'
    ]) {
      expect(runtime, `system-artifact-runtime.ts must not reference ${banned}`).not.toContain(
        banned
      )
    }
  })

  it('renderer hydration is snapshot+delta fed, not per-file content reads', () => {
    // App.tsx must hydrate the worker from vault:index-snapshot and keep it
    // fresh via vault:index-delta; a returning fs.readFile-driven md ingestion
    // means the second read+parse pipeline this item deleted has grown back.
    const app = readFileSync(join(REPO_ROOT, 'src/renderer/src/App.tsx'), 'utf-8')
    expect(app, 'App.tsx must hydrate from the index snapshot').toMatch(/indexSnapshot\(/)
    expect(app, 'App.tsx must subscribe to index deltas').toMatch(/indexDelta\(/)
    expect(app, 'App.tsx must not re-read note content for ingestion').not.toMatch(/fs\.readFile\(/)
  })
})
