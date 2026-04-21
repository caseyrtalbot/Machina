# Editor

**Files:** `src/renderer/src/panels/editor/EditorPanel.tsx`, `FrontmatterHeader.tsx`, `PropertyInputs.tsx`, `BacklinksPanel.tsx`
**Screens captured:** rich-mode editor on `Security Reviewer.md` with Home + Security Reviewer tabs open. Frontmatter header visible with properties and relationships. Missing: source mode, split view, dirty indicator, conflict banner, slash menu, bubble menu, wikilink hover, tabs overflow, backlinks.
**Canonical tasks:** (1) read and write notes fast; (2) curate frontmatter and relationships; (3) navigate via backlinks and wikilinks; (4) switch between open notes.

## Rubric scores

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | 4/5 | Clear top→bottom: type pill → properties → relationships → title → body |
| Visual hierarchy       | 5/5 | **Best hierarchy in the app.** Title earns its weight, body is the hero |
| Typography             | 5/5 | Display font choice, leading, and measure are on Anthropic/Notion par |
| Density & whitespace   | 4/5 | Frontmatter properties feel slightly sparse; rest is balanced |
| Color & theming        | 4/5 | Restrained, confident; pill tags read cleanly |
| Motion & feedback      | n/a | Static |
| Interaction design     | 3/5 | `+ add connection` / `+ add property` affordances are subtle; tab close X is small |
| Consistency            | 4/5 | Tabs here but not elsewhere — see cross-cutting findings |
| Empty/error/loading    | n/a | Not captured |
| Performance perception | n/a | — |
| Accessibility          | 3/5 | Type chips (`TXT` / `NUM` / `LIST`) are metadata a screen reader probably misreads |
| UX copy                | 4/5 | Mostly excellent; one content typo visible (see below) |
| Platform fit           | 4/5 | — |

## Findings

### F-editor-01 — Property type chips (`TXT` / `NUM` / `LIST`) add load without adding signal
- **Severity:** P1
- **Dimension:** IA, Density & whitespace, UX copy
- **Evidence:** each property row has a tiny muted chip labeling its type next to the key
- **Observation:** the type is already visually encoded by the value (`call` is text, `20` is a number, tag pills are a list). The chips duplicate that signal while adding visual weight and taking horizontal room. They cost attention every time the user scans the frontmatter.
- **Impact:** frontmatter is a high-scan surface — users return to it often. Removing the noise makes every subsequent scan cheaper.
- **Recommendation:** drop the type chips from display. Keep them for the *edit* affordance (a type-picker appears when a user edits or adds a property). If a type chip must stay, collapse it into a subtle glyph on hover only.
- **Effort:** S

### F-editor-02 — Content bug: orphan "P" under "When to Deploy"
- **Severity:** P0 (content, not code)
- **Dimension:** UX copy
- **Evidence:** screenshot 3 — under the H2 "When to Deploy" there's a lone "P" paragraph before "Use proactively after writing code..."
- **Observation:** looks like an authoring artifact from the source note, not a renderer bug. But it's the first line below a prominent heading on a page a reviewer would scroll — it's the kind of thing that breaks trust.
- **Recommendation:** fix the source note. Then: consider an **editor lint** that surfaces suspected artifacts (orphan single-letter paragraphs, double-empty headings, repeated headings) as gentle inline squiggles — like the vault health panel but inline.
- **Effort:** S (content fix); M (lint feature — defer)

### F-editor-03 — `+ add connection` / `+ add property` affordances are too quiet
- **Severity:** P2
- **Dimension:** Interaction design, Visual hierarchy
- **Evidence:** subtle muted-text affordances inline after each relationship row
- **Observation:** a new user will not see these. They look like captions, not buttons.
- **Recommendation:** slightly stronger affordance — either a `+` icon in the section label row (`RELATIONSHIPS  +`), or a dedicated small ghost button at the end of each group with the accent color on hover. Use `colors.accent.default` for the `+` glyph on hover. Frame it with your `floatingPanel.glass.sectionLabel` aesthetic for consistency with the section labels.
- **Effort:** S

### F-editor-04 — Tab bar reads cleanly but has ambiguous dirty indicator + close affordance
- **Severity:** P1
- **Dimension:** Interaction design, Consistency
- **Evidence:** `Home` tab + `Security Reviewer × ` tab with close icon; top-right shows a separate `×` which reads as "close app/window" at first glance
- **Observation:**
  - The top-right `×` near the traffic-light area is confusing on macOS — the window controls are already on the left. This second "x" reads as redundant or dangerous.
  - The tab close `×` is small (estimate ~10px). On a 14" laptop trackpad, that's a frustration point.
  - No visible "dirty" (unsaved) indicator. A small dot would be the standard.
- **Recommendation:**
  - Remove or repurpose the top-right `×` — if it's "close all tabs" or "close workspace," label it or move it into a menu.
  - Make tab close affordance 16px target with a 4px inset hit area.
  - Convert to a unified dirty + close control: subtle dot when dirty, reveals `×` on hover. Pattern from VSCode / Obsidian.
- **Effort:** S

### F-editor-05 — `AGENT` type pill is strong but isolated
- **Severity:** P2
- **Dimension:** Consistency, IA
- **Evidence:** top-left `AGENT` pill with accent outline
- **Observation:** beautiful on its own, but this is the only surface where the type is shown as a large pill. On the canvas, artifact types are shown as title-bar badges. On the sidebar file tree, type isn't shown at all. Three different encodings of the same metadata across three surfaces.
- **Recommendation:** commit to one **type indicator pattern** across the app — pill in the title bar for canvas cards, pill at top of editor header, subtle colored dot in the sidebar file tree. Standardize the pill design so a user learns it once.
- **Effort:** M — touches multiple surfaces

### F-editor-06 — BACKLINKS footer label is buried
- **Severity:** P2
- **Dimension:** Visual hierarchy, IA
- **Evidence:** bottom of screenshot 3 — `BACKLINKS` label with count `17` in far right footer strip
- **Observation:** backlinks are the differentiator feature of any bidirectional-linking tool. Tucking the count into a 9px footer undersells a flagship capability.
- **Recommendation:** elevate backlinks to a dedicated right-rail panel (toggleable) or pin above the footer with a preview list. Obsidian puts backlinks above the fold in the right pane; Tana surfaces them inline. Pick a pattern.
- **Effort:** M

### F-editor-07 — Blockquote description treatment is correct and should be codified
- **Severity:** P2 (this is a *keep this* finding)
- **Dimension:** Typography, Visual hierarchy
- **Evidence:** the italic description below the title with a left border bar is exactly right.
- **Recommendation:** document this as the canonical "note subtitle / description" pattern in the design system. Make it a first-class Tiptap node type if it isn't already, so users get consistency when they write descriptions in their own notes.

## Delight opportunities

- **Cursor trail in long documents** — a very subtle gradient fade in the gutter showing reading progress.
- **Typing feel** — ensure no re-layout on character input. Tiptap can jitter on heavy documents; profile.
- **Auto-frontmatter suggestion** — when a new note is created from a template, infer likely frontmatter fields from sibling notes.
- **Slash-menu that teaches** — Notion's slash menu shows preview cards. Yours could too.

## What was not captured

- Source mode (CodeMirror)
- Split view
- Slash menu open
- Bubble menu on text selection
- Wikilink hover preview
- Conflict banner (flagged in Pass 1 as using wrong amber token)
- Tabs overflow, drag reorder
- Dirty indicator
- BacklinksPanel expanded
- Outline panel
- Editor on a long document (>10k words)

Re-run after capturing slash menu + bubble menu + backlinks + long-document states.
