# Ghosts

**Files:** `src/renderer/src/panels/ghosts/GhostPanel.tsx`
**Screens captured:** default list with hover popover (VIBE CODING · 18 references) expanded. Missing: empty state, zero-ghosts state, action CTA state.
**Canonical tasks:** (1) see what's referenced but unwritten; (2) understand which ghosts matter most; (3) promote a ghost to a real note.

## Rubric scores

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | 5/5 | Hero count → ranked bands → detail popover is perfect editorial |
| Visual hierarchy       | 5/5 | **Best hierarchy in the app alongside editor title.** Number reads as the thing |
| Typography             | 5/5 | Hero number weight + subdued caption + small-caps bands |
| Density & whitespace   | 4/5 | Generous; list rows could be tighter |
| Color & theming        | 5/5 | Monochrome restraint; accent appears only where meaningful |
| Motion & feedback      | n/a | Popover presumably animates; not captured |
| Interaction design     | 3/5 | Popover anchor is unclear; hero number has no action |
| Consistency            | 4/5 | Small-caps section labels match the design system well |
| Empty/error/loading    | n/a | Not captured |
| Performance perception | n/a | — |
| Accessibility          | 3/5 | Popover content density great, but dialog semantics unclear |
| UX copy                | 5/5 | "ghosts across your vault" — confident product voice |
| Platform fit           | 5/5 | — |

This is the strongest screen in the audit.

## Findings

### F-ghosts-01 — The hero "201" has no action
- **Severity:** P1
- **Dimension:** Interaction design
- **Evidence:** big "201" with caption "ghosts across your vault"
- **Observation:** a 72pt number is a promise of importance. A reviewer expects it to be interactive — tap to filter, click to see the global reference graph, etc. Right now it's ornament.
- **Recommendation:** at least make it copy the count to clipboard on click (minor). Better: clicking the number opens a summary modal — "201 ghosts cite 1,247 references. 87 would benefit from being real notes." The goal is to turn the passive signal into an active product surface.
- **Effort:** M (for a real summary); S (for a minor click affordance)

### F-ghosts-02 — Popover anchor is not visually linked to the row
- **Severity:** P1
- **Dimension:** Interaction design, Visual hierarchy
- **Evidence:** `VIBE CODING · 18 references` popover floats mid-screen with no visible tail/arrow pointing to the source row; the underlying `VIBE CODING` row in the list is visually indistinguishable from the other moderate-tier rows at this moment.
- **Observation:** the user triggered the popover by hovering a row, but the link between popover and row is lost. On a crowded list, "which ghost is this showing?" is a real question.
- **Recommendation:**
  - Highlight the source row (accent tint background or a left-edge accent bar) when its popover is open.
  - Add a small tail/arrow on the popover pointing to the row.
  - Consider anchoring the popover *next to the row* on the right, like Apple Mail's hover previews, rather than free-floating.
- **Effort:** S

### F-ghosts-03 — Ranked tiers (`FREQUENTLY REFERENCED` / `MODERATE` / `SPARSE`) don't show counts
- **Severity:** P2
- **Dimension:** IA, UX copy
- **Evidence:** section labels have no count
- **Observation:** user scrolls and has no sense of how far into the list they are or how much is left. Adding counts after each label (`FREQUENTLY REFERENCED · 12`) is a ~5-character, zero-code-debt upgrade.
- **Recommendation:** append `· {count}` in muted text after each section label.
- **Effort:** S

### F-ghosts-04 — No "promote to note" affordance in the list rows
- **Severity:** P1
- **Dimension:** Interaction design, IA
- **Observation:** the whole point of surfacing ghosts is to convert them into real notes. Neither the list nor the popover shows a clear "Create note" action.
- **Recommendation:**
  - On hover of a row: right-side CTA "Create note →" appears
  - In the popover: primary button "Create VIBE CODING note" with optional template picker
  - After promotion: the row animates out; the hero count decrements with a 400ms tween
- **Effort:** M

### F-ghosts-05 — Popover reference list is excellent but truncates silently
- **Severity:** P2
- **Dimension:** Density & whitespace, UX copy
- **Evidence:** popover shows ~13 references with "Referenced in frontmatter of..." subtitles; list appears to end with no "see more" indicator
- **Observation:** this popover is showing 13 of 18 references. A reviewer notices numbers that don't match.
- **Recommendation:** when truncated, add a final row `+ 5 more references →` as a clickable link that expands or opens a dedicated reference view.
- **Effort:** S

### F-ghosts-06 — Moderate-rank rows lack visible signal of their rank
- **Severity:** P2
- **Dimension:** Visual hierarchy
- **Evidence:** rows in FREQUENTLY REFERENCED vs MODERATE vs SPARSE look identical except for their section header
- **Observation:** if a reader scrolls and loses the section header, they can't tell where they are. The section header is doing all the work; the rows do none.
- **Recommendation:** subtle per-tier cue — for frequently referenced, a small accent-colored tick or slightly heavier text; for moderate, default; for sparse, muted. Don't overdo it.
- **Effort:** S

## Delight opportunities

- **Ghost-to-note animation** — on promotion, the ghost row collapses, a card bubble rises, and if the canvas is visible it lands there with a settle. Signature moment.
- **Connection preview** — on hover, the graph view (if open in a split) highlights where the ghost would sit if promoted.
- **Weekly ghost digest** — "3 new ghosts emerged this week. 1 has 18 references — promote?" As a dismissible toast on app launch.
- **Ghost synthesis** — already on your roadmap per memory. Preserve the visual language (hero count, ranked tiers) when shipping.

## What was not captured

- Zero-ghosts state (what does success look like?)
- Empty vault state
- Popover with *no* references (edge case)
- Interaction with the synthesis agent (Librarian/Curator hookup)
- Filter/search UI (if any)

Re-run after capturing zero-state and post-synthesis states.
