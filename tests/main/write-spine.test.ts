// @vitest-environment node
//
// PLAN Layer 1 item 3 — "one write spine" as a permanent greppable invariant.
// Every agent-originated vault write must route through
// `src/main/utils/note-write.ts` (which owns the only raw fs write primitives,
// alongside its `atomic-write.ts` helper). This scan reads the real source of
// the agent-write lane and fails with `file:line + matched text` if a raw write
// primitive reappears, so a regression names itself.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const rel = (abs: string): string => relative(REPO_ROOT, abs)

/** Replace comment bodies with spaces, preserving newlines so line numbers hold. */
const blankSpans = (text: string, re: RegExp): string =>
  text.replace(re, (m) => m.replace(/[^\n]/g, ' '))
const stripJsComments = (text: string): string =>
  blankSpans(blankSpans(text, /\/\*[\s\S]*?\*\//g), /(^|[^:])\/\/[^\n]*/g)

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

const NATIVE_TOOLS_DIR = join(REPO_ROOT, 'src/main/services/machina-native-tools')

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((abs) => statSync(abs).isFile() && abs.endsWith('.ts') && !/\.(test|spec)\./.test(abs))
}

// The agent-write lane: files that synthesize or mutate vault content on an
// agent's behalf. None may hold a raw fs write primitive of their own.
const LANE_FILES: readonly string[] = [
  join(REPO_ROOT, 'src/main/services/mcp-server.ts'),
  join(REPO_ROOT, 'src/main/services/vault-query-facade.ts'),
  join(REPO_ROOT, 'src/main/ipc/ghost-emerge.ts'),
  ...tsFiles(NATIVE_TOOLS_DIR)
]

// Raw fs write primitives. `open(` is included because an fs handle opened for
// write is the same escape hatch under another name.
const RAW_WRITE_RE =
  /\b(?:writeFileSync|writeSync|openSync|createWriteStream|appendFile|appendFileSync|open)\s*\(/g

describe('write-spine invariant (PLAN Layer 1 item 3)', () => {
  it('no agent-write-lane file holds a raw fs write primitive', () => {
    const offenders: string[] = []
    for (const abs of LANE_FILES) {
      const src = stripJsComments(readFileSync(abs, 'utf-8'))
      for (const m of src.matchAll(RAW_WRITE_RE)) {
        offenders.push(`${rel(abs)}:${lineAt(src, m.index)} — ${m[0]}`)
      }
    }
    expect(
      offenders,
      `raw fs write primitives outside note-write.ts:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  it('the write-spine consumers import from the note-write module', () => {
    const mustImport = [
      join(REPO_ROOT, 'src/main/services/vault-query-facade.ts'),
      join(REPO_ROOT, 'src/main/ipc/ghost-emerge.ts')
    ]
    for (const abs of mustImport) {
      const src = readFileSync(abs, 'utf-8')
      expect(src, `${rel(abs)} must import from the note-write module`).toMatch(
        /from ['"].*utils\/note-write['"]/
      )
    }
  })

  it('native note-tools writes only through the facade, never note-write directly', () => {
    // Layer 1 item 4: the native lane converged onto VaultQueryFacade, so
    // note-tools must NOT hold its own stamped-write call — the facade owns the
    // single audited/stamped write spine. If this regresses, the native lane has
    // grown a second write path that skips the facade's audit + Spotlighting.
    const abs = join(REPO_ROOT, 'src/main/services/machina-native-tools/note-tools.ts')
    const src = stripJsComments(readFileSync(abs, 'utf-8'))
    expect(src, 'note-tools.ts must not call writeStampedNote/createStampedNote').not.toMatch(
      /\b(?:writeStampedNote|createStampedNote)\s*\(/
    )
    expect(src, 'note-tools.ts must not import the note-write module').not.toMatch(
      /from ['"].*utils\/note-write['"]/
    )
  })
})
