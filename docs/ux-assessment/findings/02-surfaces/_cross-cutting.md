# Cross-cutting observations (Pass 2)

Findings that span multiple surfaces. Capture these once; don't repeat them on each per-surface report.

## F-cross-01 — The left sidebar is the same on every panel, and it shouldn't be
- **Severity:** P0
- **Dimension:** IA, Visual hierarchy, Density
- **Evidence:** all five screenshots show an identical sidebar — vault picker, Daily Notes calendar, TAGS, full file tree.
- **Observation:** **the calendar eats ~200px of sidebar vertical space on panels where dates are irrelevant** (Graph, Canvas in its pure spatial mode, Health). The file tree is the primary navigation for 80% of user tasks but sits below the fold on a 13" laptop because the calendar is always there.
- **Impact:** the single most universal UI element in the app is working hard *against* its most common use case. A reviewer on a laptop will see this immediately.
- **Recommendation:**
  - Make sidebar sections **collapsible and per-panel-configurable**. On Graph, default: hide Daily Notes.
  - Or, more ambitious: make the sidebar **contextual to the active panel**. Canvas sidebar could show "Canvas on this file-tree filter"; Graph sidebar could show a legend; Ghosts sidebar could show tier filters. The activity bar already gates panel selection — the sidebar should answer *"what do I need when I'm doing this?"*.
  - At minimum: collapse Daily Notes by default. Most users open the app to a task, not to a calendar.
- **Effort:** M (collapsible); L (contextual)

## F-cross-02 — Tab model is inconsistent across panels
- **Severity:** P1
- **Dimension:** Consistency, IA
- **Evidence:** Editor has a tab bar with Home + Security Reviewer (screenshot 3). Canvas, Graph, Ghosts, Health have no tab bar.
- **Observation:** a user who learns "tabs exist" in the editor will expect them to exist everywhere and be surprised they don't. Conversely, a user who learns "the active view swaps the whole panel area" (as on Canvas/Graph/Ghosts/Health) will be confused when the Editor retains history behind tabs.
- **Recommendation:** decide the tab scope and commit:
  - **Option A (Obsidian model):** tabs are universal — you can have a Canvas tab next to an Editor tab next to a Graph tab in the same tab row. Any panel can live in a tab. This is the most powerful.
  - **Option B (VSCode model):** tabs are file-scoped — they only appear for openable files (notes, images, PDFs). System panels (Graph, Ghosts, Health, Canvas-as-surface) are activity-bar driven and swap the whole workspace.
  - Today you're between the two. Pick one.
- **Effort:** L (architecture); M (minimum: document the intent and align edge cases)

## F-cross-03 — Floating chrome patterns are inconsistent
- **Severity:** P1
- **Dimension:** Consistency, Visual hierarchy
- **Evidence:**
  - Canvas: floating toolbar left-edge, agent badges top-right, minimap bottom-right, zoom% mid-toolbar
  - Graph: meta chip top-left, hint chip top-center, settings gear top-right, enrichment hint bottom-center, fit/zoom bottom-left
  - Ghosts: list only, popover on hover
  - Editor: tab bar top, frontmatter inline, footer backlinks count bottom
  - Health: sections inline, icon top-right
- **Observation:** every surface has its own chrome pattern. A user can't generalize "where do I look for status?" or "where do I find settings?" across the app.
- **Recommendation:** define a **three-zone chrome system** and apply consistently:
  - **Top strip**: context (title, meta chips, tabs) — left; primary action / settings — right
  - **Bottom strip** (optional, surface-dependent): status bar with consistent sections (count · zoom · selection · hint)
  - **Edge rails** (optional): panel-local tools (canvas toolbar, editor outline)
  Document in the design system. Retrofit gradually.
- **Effort:** L (design); M (per-surface retrofit)

## F-cross-04 — Icon strokes are inconsistent across the app
- **Severity:** P2
- **Dimension:** Consistency, Typography (as applied to icon weight)
- **Evidence:** ActivityBar has inline-SVG icons (stroke-width 1.5); Phosphor Icons is a dependency but used elsewhere; canvas toolbar has its own SVG set.
- **Observation:** at high zoom or on a Retina display the mixed strokes show — subtle but a trained eye will catch it.
- **Recommendation:** standardize on Phosphor `duotone` or `regular` at a single size; retire inline-SVG icons. See Pass 1 F-static-15.
- **Effort:** M

## F-cross-05 — Section label typography is used inconsistently
- **Severity:** P2
- **Dimension:** Typography, Consistency
- **Evidence:** `DAILY NOTES`, `TAGS`, `FREQUENTLY REFERENCED`, `MODERATE`, `SPARSE`, `HARD FAILURES`, `INTEGRITY`, `BACKLINKS`, `ENRICHMENT`, `RELATIONSHIPS`, `CONNECTIONS`, `APPEARS IN` — all small-caps section labels with slightly varying weights and letter-spacing.
- **Observation:** the token system defines `typography.metadata` and `floatingPanel.glass.sectionLabel`. Worth auditing that both are used at the declared call sites and consolidating to a single source.
- **Recommendation:** grep for any `text-transform: uppercase` + manual letter-spacing combos and replace with the tokens. Add a `<SectionLabel>` component if one doesn't exist.
- **Effort:** S

## F-cross-06 — First-time user onboarding to each panel is zero
- **Severity:** P1
- **Dimension:** IA, UX copy
- **Observation:** Graph has one helpful hint line. No other panel does. A new user lands on Canvas, Ghosts, or Health and has to figure out what's going on.
- **Recommendation:** one-line **panel-purpose copy** at the top of each panel in empty / sparse states. Not a tutorial — a sentence. "Machina tracks the ideas you've referenced but haven't written yet. The bigger the number, the more it matters." Dismissible with a checkbox "Don't show again."
- **Effort:** M

## F-cross-07 — No visible global search
- **Severity:** P1
- **Dimension:** IA
- **Evidence:** top of sidebar has a `Search...` field; no global palette captured in screenshots
- **Observation:** the command palette exists (`design/components/CommandPalette.tsx`) but from screenshots alone it's not visible as a first-class surface. A user who doesn't know about `⌘K` has to open the sidebar to search.
- **Recommendation:** consider a small search chip in the shell chrome (top-center or top-right) that opens the command palette. Like Cursor, Linear. The sidebar search is OK for file-scoped search; there should be an app-level search too.
- **Effort:** S

## F-cross-08 — Vault picker shows a path truncated mid-string
- **Severity:** P2
- **Dimension:** UX copy, Visual hierarchy
- **Evidence:** sidebar shows `Casey Central · /Users/caseytalbot/Desktop/...` — path truncates mid-way
- **Observation:** truncation is fine; the dot (`·`) suggests there's more and nothing shows on hover from the capture. If a user has multiple vaults with similar names, disambiguation is painful.
- **Recommendation:** on hover, tooltip with full path. Click to open vault picker. Small yellow dot on the right probably indicates "unsaved changes" or "indexing" — label it.
- **Effort:** S

---

## F-cross-09 — Tensions are narrated in the sidebar, not shown in the canvas
- **Severity:** P1
- **Dimension:** IA, Visual hierarchy, Consistency
- **Evidence:** medium-density canvas capture shows a `TENSIONS` section top-of-sidebar with two entries and red indicators. The canvas itself shows no tension-related styling on the cards involved.
- **Observation:** tensions are a signature differentiator (per `system-artifacts`, `EDGE_KIND_COLORS.tension`, `ARTIFACT_COLORS.tension`). The sidebar lists them; the canvas — the visual surface that should *show* them — does not. The tension system is text-first in a spatial-thinking app.
- **Recommendation:** route tension clicks to the canvas as a focus/highlight action, render a subtle amber anchor on participating cards, use the existing `tension` edge kind color between them. Covered in detail at `canvas.md#f-canvas-11`. This is a high-leverage ~M-effort upgrade.
- **Effort:** M

---

## Notes on what's *right*

This is a serious product. The typography, color discipline, spacing instincts, and restraint across these five surfaces are on par with top teams. The Ghosts panel and the Editor title treatment would hold up unmodified at Notion or Linear. The graph color palette is genuinely beautiful. The decision to build on Pixi for the canvas and React for everything else, with a token system that expresses structural color as CSS variables, is a better foundation than most apps at this stage.

The gaps are almost entirely in **interaction affordances and state coverage**, not craft. A focused 6-week polish sprint on the findings above would move this from "impressive solo project" to "tier-1 product surface."
