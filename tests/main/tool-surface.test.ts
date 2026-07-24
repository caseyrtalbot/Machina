// @vitest-environment node
//
// PLAN Layer 1 item 4 — "one tool surface" as permanent greppable invariants.
// The native note lane and the MCP lane share ONE Spotlighting definition and
// ONE audited vault-access facade. These scans fail with the offending file if
// a second definition or a facade bypass reappears in the note lane.

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

describe('tool-surface invariants (PLAN Layer 1 item 4)', () => {
  it('SPOTLIGHT_BOUNDARY + wrapSpotlighting are defined in exactly one module', () => {
    // A DEFINITION, not an import: `const SPOTLIGHT_BOUNDARY =` /
    // `function wrapSpotlighting(` / `function unwrapSpotlighting(`. Import
    // sites (`import { wrapSpotlighting } from ...`) never match these.
    const DEFINITION_RE =
      /(?:export\s+)?const\s+SPOTLIGHT_BOUNDARY\b|(?:export\s+)?function\s+(?:wrap|unwrap)Spotlighting\b/
    const definers = sourceFiles(SRC)
      .filter((abs) => DEFINITION_RE.test(readFileSync(abs, 'utf-8')))
      .map(rel)
      .sort()
    expect(definers, 'Spotlighting must be defined only in src/shared/spotlighting.ts').toEqual([
      'src/shared/spotlighting.ts'
    ])
  })

  it('the native note lane reads and writes through the shared facade', () => {
    // readNote / editNote pre-read go through ctx.facade.readFile (audited +
    // boundary-guarded); write_note / edit_note go through ctx.facade.writeFile.
    // If either disappears, the note lane has grown a facade-bypassing path.
    const abs = join(REPO_ROOT, 'src/main/services/machina-native-tools/note-tools.ts')
    const src = readFileSync(abs, 'utf-8')
    expect(src, 'note-tools.ts must read via the facade').toMatch(/ctx\.facade\.readFile\(/)
    expect(src, 'note-tools.ts must write via the facade').toMatch(/ctx\.facade\.writeFile\(/)
    expect(src, 'note-tools.ts must wrap read/search output via @shared/spotlighting').toMatch(
      /from ['"]@shared\/spotlighting['"]/
    )
  })

  it('all canvas file mutation converges on the shared applier (canvas-apply.ts)', () => {
    // Both lanes persist canvas node/edge plans through applyCanvasPlanToFile in
    // canvas-apply.ts. canvas-tools.ts must NOT hand-roll a canvas file write
    // (no fs.writeFile) and must NOT re-implement the mutation kernel (no direct
    // applyPlanOps call) — otherwise the duplicate mutation path this item
    // deleted has grown back.
    const canvasTools = readFileSync(
      join(REPO_ROOT, 'src/main/services/machina-native-tools/canvas-tools.ts'),
      'utf-8'
    )
    expect(canvasTools, 'canvas-tools.ts must not write canvas files directly').not.toMatch(
      /fs\.writeFile\(/
    )
    expect(canvasTools, 'canvas-tools.ts must not re-implement the mutation kernel').not.toMatch(
      /applyPlanOps\(/
    )
    expect(canvasTools, 'canvas-tools.ts must route writes through canvas-apply.ts').toMatch(
      /from ['"]\.\.\/canvas-apply['"]/
    )
    expect(
      canvasTools,
      'canvas-tools.ts must wrap read_canvas output via @shared/spotlighting'
    ).toMatch(/from ['"]@shared\/spotlighting['"]/)

    const mcpServer = readFileSync(join(REPO_ROOT, 'src/main/services/mcp-server.ts'), 'utf-8')
    expect(mcpServer, 'mcp-server.ts must apply canvas plans via canvas-apply.ts').toMatch(
      /from ['"]\.\/canvas-apply['"]/
    )
  })
})
