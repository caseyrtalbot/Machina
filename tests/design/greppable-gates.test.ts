// @vitest-environment node
//
// ADR 0005 (design constitution) — the six greppable gates as permanent
// invariants. Each gate below is one of the enforcement rules from
// `docs/architecture/adr/0005-...md` §Enforcement / §Greppable gates. These are
// filesystem scans (hence the node environment): they read the real source tree
// and fail with the offending `file:line + matched text` so a regression names
// itself. Scans walk directories rather than hardcoded file lists so new files
// are covered by construction; the only hardcoded inputs are the *documented
// exemptions* (the hex allowlist zones, the inline-style ceilings, and the
// ratified transition vocabulary), each justified inline.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const RENDERER = join(REPO_ROOT, 'src/renderer/src')

// ── shared walk / read helpers ──────────────────────────────────────────────

const isTestFile = (rel: string): boolean =>
  rel.includes(`${sep}__tests__${sep}`) || /\.(test|spec)\./.test(rel)

/** Recursively list files under `dir` matching one of `exts`, excluding tests. */
function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      out.push(...walk(abs, exts))
    } else if (exts.some((e) => name.endsWith(e)) && !isTestFile(relative(RENDERER, abs))) {
      out.push(abs)
    }
  }
  return out
}

const rel = (abs: string): string => relative(REPO_ROOT, abs)

/** Replace comment bodies with spaces, preserving newlines so line numbers hold. */
const blankSpans = (text: string, re: RegExp): string =>
  text.replace(re, (m) => m.replace(/[^\n]/g, ' '))

const stripCssComments = (text: string): string => blankSpans(text, /\/\*[\s\S]*?\*\//g)
const stripJsComments = (text: string): string =>
  blankSpans(blankSpans(text, /\/\*[\s\S]*?\*\//g), /(^|[^:])\/\/[^\n]*/g)

/** 1-based line number of a character offset. */
const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

// ─────────────────────────────────────────────────────────────────────────────
// Gate 1 — zero off-palette hex.
// Hex literals may live ONLY in the palette-definition allowlist. Everywhere
// else in the renderer they must be tokens.
// ─────────────────────────────────────────────────────────────────────────────

// Palette-definition source files (verified against the tree). Hex here IS the
// palette.
const HEX_ALLOWLIST_FILES = new Set(
  [
    'src/renderer/src/design/tokens.ts',
    'src/renderer/src/design/themes.ts',
    'src/renderer/src/design/apply-accent.ts',
    // CARD_TYPE_COLORS for Pixi (canvas cards render outside the DOM, so no CSS
    // var); the file's own doc-comment ties it to this allowlist.
    'src/renderer/src/panels/canvas/canvas-colors.ts'
  ].map((p) => join(REPO_ROOT, p))
)

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g

/**
 * index.css carries hex in two allowlisted zones only:
 *   (a) the vendored Tailwind prelude — every line at/above the sentinel comment
 *       (matched by TEXT, never line number);
 *   (b) the app token block — the first `:root {` after the sentinel through its
 *       column-0 close (matched structurally).
 * Returns the set of 1-based line numbers that fall in an allowed zone.
 */
function indexCssAllowedHexLines(text: string): (line: number) => boolean {
  const lines = text.split('\n')
  const sentinel = lines.findIndex((l) => l.includes('END vendored Tailwind prelude'))
  if (sentinel < 0) throw new Error('index.css: vendored-prelude sentinel comment not found')
  const preludeMax = sentinel + 1 // 1-based, inclusive

  const rootIdx = lines.findIndex((l, i) => i > sentinel && /^:root \{/.test(l))
  if (rootIdx < 0) throw new Error('index.css: app token `:root {` block not found after sentinel')
  let closeIdx = -1
  for (let i = rootIdx + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) {
      closeIdx = i
      break
    }
  }
  if (closeIdx < 0) throw new Error('index.css: app token `:root {` block never closes')
  const tokenLo = rootIdx + 1 // 1-based
  const tokenHi = closeIdx + 1
  return (line) => line <= preludeMax || (line >= tokenLo && line <= tokenHi)
}

describe('Gate 1 — zero off-palette hex', () => {
  it('has no hex literal outside palette definitions', () => {
    const violations: string[] = []

    // TS/TSX (comment-stripped so shas / issue refs in comments never trip it).
    for (const abs of walk(RENDERER, ['.ts', '.tsx'])) {
      if (HEX_ALLOWLIST_FILES.has(abs)) continue
      const src = stripJsComments(readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(HEX_RE)) {
        violations.push(`${rel(abs)}:${lineAt(src, m.index)}  ${m[0]}`)
      }
    }

    // CSS. index.css uses zone allowlisting; every other css file must be hex-free.
    // Zones are detected from RAW text (the sentinel + block markers live inside
    // comments); hex is matched on comment-stripped text. blankSpans preserves
    // newlines so line numbers align across both.
    const indexCssPath = join(RENDERER, 'assets/index.css')
    for (const abs of walk(RENDERER, ['.css'])) {
      const raw = readFileSync(abs, 'utf8')
      const src = stripCssComments(raw)
      const allowed = abs === indexCssPath ? indexCssAllowedHexLines(raw) : () => false
      for (const m of src.matchAll(HEX_RE)) {
        const line = lineAt(src, m.index)
        if (!allowed(line)) violations.push(`${rel(abs)}:${line}  ${m[0]}`)
      }
    }

    expect(
      violations,
      `Off-palette hex found. Move the value into a token (design/tokens.ts →\n` +
        `assets/index.css :root), or add the file to HEX_ALLOWLIST_FILES only if it\n` +
        `is a genuine palette definition:\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — zero static inline style={{}} beyond documented exemptions.
// Ceiling model: each exempted file may carry up to N `style={` sites (its
// current runtime-computed count); any file NOT in the map must have zero.
// Tradeoff (documented): a NEW static style added to an already-exempted file
// only fails if it pushes that file over its ceiling. Panels were converted in
// ADR-0005 slices 3–6; every surviving site was hand-audited as runtime-computed
// (widths, positions, display toggles, colors from variables) except two
// forced-inline SectionLabel sites (BacklinksPanel.tsx:294, GhostPanel.tsx:336)
// and AgentShell's three Electron-only `WebkitAppRegion` sites — all inside the
// ceilings below.
// ─────────────────────────────────────────────────────────────────────────────

// Relative to src/renderer/src. Derived from the current tree, hand-audited
// against docs/HANDOFF.md's documented per-directory totals: canvas 28, graph 2,
// editor 9, sidebar 8, ghosts 3. `components` is 13 here (HANDOFF's slice-6 row
// said 10; the delta is dynamic emptystate/overlay/onboarding sites, all
// audited). `agent-shell` (23) was converted in slice 4 and is not restated in
// HANDOFF's slice-6 gate row; its sites are all runtime-computed.
const INLINE_STYLE_CEILINGS: Record<string, number> = {
  // canvas (28)
  'panels/canvas/SystemArtifactCard.tsx': 4,
  'panels/canvas/SectionOverlay.tsx': 4,
  'panels/canvas/CanvasSurface.tsx': 4,
  'panels/canvas/PdfCard.tsx': 2,
  'panels/canvas/CardShell.tsx': 2,
  'panels/canvas/CanvasMinimap.tsx': 2,
  'panels/canvas/BlockCard.tsx': 2,
  'panels/canvas/WorkbenchFileCard.tsx': 1,
  'panels/canvas/SplitDividerAndPanel.tsx': 1,
  'panels/canvas/shared/CardBadge.tsx': 1,
  'panels/canvas/EdgeDots.tsx': 1,
  'panels/canvas/ConnectionDragOverlay.tsx': 1,
  'panels/canvas/ClusterLabels.tsx': 1,
  'panels/canvas/CardShellSkeleton.tsx': 1,
  'panels/canvas/CardLodPreview.tsx': 1,
  // graph (2)
  'panels/graph/GraphDetailDrawer.tsx': 2,
  // editor (9)
  'panels/editor/BacklinksPanel.tsx': 4,
  'panels/editor/PropertyInputs.tsx': 2,
  'panels/editor/FrontmatterHeader.tsx': 2,
  'panels/editor/OutlinePanel.tsx': 1,
  // sidebar (8)
  'panels/sidebar/FileTree.tsx': 5,
  'panels/sidebar/Sidebar.tsx': 2,
  'panels/sidebar/TagBrowser.tsx': 1,
  // ghosts (3)
  'panels/ghosts/GhostPanel.tsx': 3,
  // components (13)
  'components/SettingsModal.tsx': 2,
  'components/overlay/Overlay.tsx': 2,
  'components/OnboardingOverlay.tsx': 2,
  'components/emptystate/EmptyState.tsx': 2,
  'components/overlay/Modal.tsx': 1,
  'components/emptystate/Spinner.tsx': 1,
  'components/emptystate/LoadingState.tsx': 1,
  'components/ContextMenu.tsx': 1,
  'components/CliAgentBadge.tsx': 1,
  // agent-shell (23) — slice 4
  'panels/agent-shell/agent-badge.tsx': 6,
  'panels/agent-shell/AgentShell.tsx': 3,
  'panels/agent-shell/ThreadPanel.tsx': 2,
  'panels/agent-shell/TerminalStrip.tsx': 2,
  'panels/agent-shell/HeaderFilesSidePanel.tsx': 2,
  'panels/agent-shell/ApprovalsTray.tsx': 2,
  'panels/agent-shell/tool-renderers/ReadNoteCard.tsx': 1,
  'panels/agent-shell/TitlebarPanelToggle.tsx': 1,
  'panels/agent-shell/ThreadSidebar.tsx': 1,
  'panels/agent-shell/ThinkingIndicator.tsx': 1,
  'panels/agent-shell/SurfaceDock.tsx': 1,
  'panels/agent-shell/dock-adapters/TerminalDockAdapter.tsx': 1,
  // primitives (dynamic merged / computed styles)
  'design/components/SectionLabel.tsx': 1,
  'hooks/useClaudeContext.tsx': 1
}

describe('Gate 2 — inline style ceilings', () => {
  it('has no static inline style beyond the documented exemption ceilings', () => {
    const violations: string[] = []
    for (const abs of walk(RENDERER, ['.ts', '.tsx'])) {
      const relFromRenderer = relative(RENDERER, abs).split(sep).join('/')
      const count = (readFileSync(abs, 'utf8').match(/style=\{/g) || []).length
      const ceiling = INLINE_STYLE_CEILINGS[relFromRenderer] ?? 0
      if (count > ceiling) {
        violations.push(
          `${rel(abs)}  has ${count} \`style={\` (ceiling ${ceiling}). ` +
            `Move static styles to a te- class; if runtime-computed, raise the ceiling.`
        )
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gate 3 — zero Tailwind (repo-wide). Complements
// tests/main/vite-build-entries.test.ts (engine-absence in vite config) with the
// dependency + stylesheet + config surface.
// ─────────────────────────────────────────────────────────────────────────────

describe('Gate 3 — zero Tailwind', () => {
  it('has no tailwindcss dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(deps).filter((d) => /tailwind/i.test(d))).toEqual([])
  })

  it('has no tailwindcss package in the lockfile', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8'))
    const pkgs: Record<string, unknown> = lock.packages ?? {}
    const hits = Object.keys(pkgs).filter((p) => /(^|\/)tailwindcss($|\/)/.test(p))
    expect(hits).toEqual([])
  })

  it('has no @tailwind / @import tailwindcss in any renderer stylesheet', () => {
    const violations: string[] = []
    for (const abs of walk(RENDERER, ['.css'])) {
      const src = stripCssComments(readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(/@tailwind\b|@import\s+['"]tailwindcss/g)) {
        violations.push(`${rel(abs)}:${lineAt(src, m.index)}  ${m[0]}`)
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })

  it('has no tailwind plugin in electron.vite.config.ts', () => {
    const src = readFileSync(join(REPO_ROOT, 'electron.vite.config.ts'), 'utf8')
    // Prose/comment mentions are allowed; a real import or plugin() call is not.
    const stripped = stripJsComments(src)
    expect(/tailwind/i.test(stripped), 'tailwind referenced in vite config code').toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gate 4 — zero useState hover. Interaction states are CSS :hover, never React
// state.
// ─────────────────────────────────────────────────────────────────────────────

describe('Gate 4 — no useState hover', () => {
  it('has no useState declaration bound to a hover name', () => {
    const violations: string[] = []
    // e.g. `const [isHovered, setIsHovered] = useState(false)`
    const re = /const\s*\[\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\]\s*=\s*useState\b/g
    for (const abs of walk(RENDERER, ['.ts', '.tsx'])) {
      const src = stripJsComments(readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(re)) {
        if (/hover/i.test(m[1]) || /hover/i.test(m[2])) {
          violations.push(`${rel(abs)}:${lineAt(src, m.index)}  ${m[0].trim()}`)
        }
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gate 5 — transitions only from the ratified motion vocabulary.
// Two-tier, deliberate (see HANDOFF): the `--t-*` motion catalog plus the
// pre-existing exact-value `--transition-*` tokens. Layer 4 later collapses these
// to three durations + two easings; until then both tiers are ratified.
// Out-of-scope by design (NOT transition declarations, so the scanners never
// reach them): the imperative `container.style.animation = 'te-scale-in ...'` in
// slash-command.tsx + wikilink-suggestion.tsx, and NoteCard's `cssText`.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITION_VARS = new Set([
  // motion catalog (Theme.tsx re-emits micro/fast/med/slow/surface; reveal/spring
  // are CSS-only)
  '--t-micro',
  '--t-fast',
  '--t-med',
  '--t-slow',
  '--t-surface',
  '--t-reveal',
  '--t-spring',
  // pre-existing exact-value tokens (whole defined --transition-* family)
  '--transition-hover',
  '--transition-focus-ring',
  '--transition-tooltip',
  '--transition-modal-fade',
  '--transition-settings-slide',
  '--transition-command-palette'
])

/** True when a transition value draws only from the ratified vocabulary. */
function isAcceptedTransition(prop: string, rawValue: string): boolean {
  const value = rawValue.replace(/\s+/g, ' ').trim()
  if (prop === 'transition-property') return true // name-only, no timing
  if (value === 'none') return true
  // prefers-reduced-motion a11y reset — the universal near-zero override.
  if (/^0\.01ms\b/.test(value)) return true

  const vars = [...value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1])
  if (vars.length === 0) return false // raw duration/easing, no token
  if (vars.some((v) => !ALLOWED_TRANSITION_VARS.has(v))) return false

  // Nothing raw may hide alongside the tokens: strip var() refs, then reject any
  // leftover duration or easing keyword.
  const rest = value.replace(/var\(\s*--[\w-]+\s*\)/g, ' ')
  if (/\b\d*\.?\d+\s*m?s\b/.test(rest)) return false
  if (/\b(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier|steps)\b/.test(rest)) return false
  return true
}

// Matches transition shorthand + longhands, joining multi-line values (up to the
// terminating ; or }). Lookbehind excludes custom props (--default-transition-*)
// and vendor-prefixed forms.
const CSS_TRANSITION_RE =
  /(?<![\w-])transition(-property|-duration|-timing-function)?\s*:\s*([^;{}]+?)\s*[;}]/gi

describe('Gate 5 — ratified transition vocabulary', () => {
  it('has no off-vocabulary transition in renderer stylesheets', () => {
    const violations: string[] = []
    for (const abs of walk(RENDERER, ['.css'])) {
      const src = stripCssComments(readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(CSS_TRANSITION_RE)) {
        const prop = 'transition' + (m[1] ?? '')
        if (!isAcceptedTransition(prop, m[2])) {
          violations.push(`${rel(abs)}:${lineAt(src, m.index)}  ${prop}: ${m[2].trim()}`)
        }
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })

  it('has no off-vocabulary transition in renderer inline styles', () => {
    // Token DEFINITION / emit files are the vocabulary source, not consumers.
    const skip = new Set(
      ['design/tokens.ts', 'design/themes.ts', 'design/Theme.tsx'].map((p) => join(RENDERER, p))
    )
    // camelCase style keys with a string value: transition / transitionProperty /
    // transitionDuration / transitionTimingFunction.
    const re = /(?<![\w-])transition(Property|Duration|TimingFunction)?\s*:\s*(['"`])([^'"`]*)\2/g
    const camelToCss: Record<string, string> = {
      Property: '-property',
      Duration: '-duration',
      TimingFunction: '-timing-function'
    }
    const violations: string[] = []
    for (const abs of walk(RENDERER, ['.ts', '.tsx'])) {
      if (skip.has(abs)) continue
      const src = stripJsComments(readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(re)) {
        const prop = 'transition' + (m[1] ? camelToCss[m[1]] : '')
        if (!isAcceptedTransition(prop, m[3])) {
          violations.push(`${rel(abs)}:${lineAt(src, m.index)}  ${prop}: ${m[3]}`)
        }
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gate 6 — no appearance axes in settings-store.
// The removed axis keys (accent id + custom hex, the `env` container that held
// opacity/blur/font-size/density/radii/background-tint/canvas-grid, and the font
// pickers) may appear ONLY inside `delete state.X` migration cleanup — never as
// active state fields. Matches key names, not prose (comments + migration deletes
// are excluded before scanning).
// ─────────────────────────────────────────────────────────────────────────────

describe('Gate 6 — no appearance axes in settings-store', () => {
  it('reintroduces no removed appearance-axis key', () => {
    const abs = join(RENDERER, 'store/settings-store.ts')
    const src = stripJsComments(readFileSync(abs, 'utf8'))
    const lines = src.split('\n')

    // Forbidden as active declarations. `env` is the appearance container; the
    // rest are axis names (direct or reintroduced-under-a-new-name).
    const forbidden: readonly RegExp[] = [
      /\benv\b/,
      /accent/i,
      /custom(?:accent)?hex/i,
      /opacity/i,
      /\bblur\b/i,
      /density/i,
      /\bradi(?:us|i)\b/i,
      /\btint\b/i,
      /canvas\s*grid/i,
      /\b(?:display|body|mono)font\b/i,
      /fontsize/i,
      /fontfamily/i
    ]

    const violations: string[] = []
    lines.forEach((line, i) => {
      if (/delete\s+state\./.test(line)) return // migration cleanup names dead keys
      for (const re of forbidden) {
        const m = re.exec(line)
        if (m) violations.push(`${rel(abs)}:${i + 1}  matched /${re.source}/ → "${line.trim()}"`)
      }
    })
    expect(
      violations,
      `Appearance axis reintroduced in settings-store:\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })
})
