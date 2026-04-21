# Health (Vault Health)

**Files:** `src/renderer/src/panels/health/HealthPanel.tsx`
**Screens captured:** default list with HARD FAILURES and INTEGRITY sections; 321 issues. Missing: zero-issues state, running state, fix-in-progress state, individual-issue actions.
**Canonical tasks:** (1) trust my vault; (2) see what's wrong; (3) fix it.

## Rubric scores

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | 3/5 | Sections present; no prioritization, no grouping by file |
| Visual hierarchy       | 2/5 | Every issue looks equally urgent; no sense of priority |
| Typography             | 4/5 | Title / description / path hierarchy works |
| Density & whitespace   | 4/5 | Comfortable read |
| Color & theming        | 2/5 | **No severity color encoding.** "Hard failures" and "broken references" render identically |
| Motion & feedback      | n/a | — |
| Interaction design     | 1/5 | **No fix actions.** No bulk fix. No ignore. No copy-path. No jump-to-file |
| Consistency            | 3/5 | Section-label treatment matches system, but the panel itself has no global chrome |
| Empty/error/loading    | n/a | Not captured — ironically, the "healthy vault" empty state is critical |
| Performance perception | n/a | — |
| Accessibility          | 2/5 | Likely all `<div>`s; no list semantics detected |
| UX copy                | 1/5 | **Copy is a diagnostic log, not a product surface.** "rs02 references cc-source-analysis1.5 which does not exist" is a stack trace |
| Platform fit           | 3/5 | — |

This is the weakest surface and the one most likely to embarrass in a tier-1 review. The rendering and typography are correct; everything *about* the content is wrong.

## Findings

### F-health-01 — Panel is a log file, not a product
- **Severity:** P0
- **Dimension:** UX copy, Interaction design, IA
- **Evidence:** screenshot 5 — raw technical messages, no actions, no grouping, no triage
- **Observation:** this panel exposes the engine's internal index state directly. That's fine for a developer console, not for a product. A non-developer user sees "File not in worker index" and has no idea if this is serious, what caused it, or what to do.
- **Impact:** every issue here is an opportunity to teach the user about their vault. Wasted, they become anxiety generators.
- **Recommendation:** rewrite the panel around **verbs** instead of **logs**. Per issue:
  - **Clear name.** "Can't read Architecture.md" instead of "Parse error"
  - **Why it matters.** "This note won't appear in your graph or search" instead of "not in worker index"
  - **Direct action.** `[Open file]` `[Retry]` `[Ignore forever]` buttons
  - **Grouped by root cause.** Three broken references to a single deleted file become one row: "3 notes reference deleted `cc-source-analysis1.5`" with `[Fix all]` and `[Create the missing note]`
- **Effort:** L — this is a redesign, not a polish

### F-health-02 — No severity encoding
- **Severity:** P0
- **Dimension:** Visual hierarchy, Color & theming
- **Evidence:** parse errors and broken references render with identical visual weight
- **Observation:** "parse error" means a file can't be read at all; "broken reference" means a link is dead. Orders of magnitude different. The panel treats them as peers.
- **Recommendation:** three tiers with consistent treatment —
  - **Critical** (red, `colors.claude.error`) — parse errors, file-system errors
  - **Warning** (amber, `colors.claude.warning`) — broken references, missing index entries, stale artifacts
  - **Info** (muted, `colors.text.muted`) — cosmetic or style issues
  Lead with a severity dot or left-edge accent bar. Count each in the header: `Vault Health — 2 critical · 319 warnings · 0 info`.
- **Effort:** M

### F-health-03 — Header is honest but underpowered
- **Severity:** P1
- **Dimension:** IA, UX copy
- **Evidence:** `Vault Health · 321 issues · last checked just now`
- **Observation:** "321 issues" with no visual weight and no CTA. A reviewer reads this as a shrug.
- **Recommendation:** model on `GhostPanel`'s hero-number pattern — big `2` for critical, or big `3` notes-requiring-attention number, with a line underneath telling the user what it means. The number is the trust signal. Match the design language you've already set with Ghosts.
- **Effort:** S (after F-health-02 ships)

### F-health-04 — Duplicate rows for the same file are visual noise
- **Severity:** P1
- **Dimension:** Density & whitespace, IA
- **Evidence:** `Claude Code Source Audit2.5.md` appears three times in a row with three different broken references; `cc-source-analysis1.5.md` appears twice
- **Observation:** these should be grouped *by file*, not by issue. The file is the actionable unit.
- **Recommendation:** default grouping = by file. Expand a file row to see individual issues. Quick actions at the file level. Let the user switch to "by issue type" if they want the current view.
- **Effort:** M

### F-health-05 — No "refresh" or "run again" affordance visible
- **Severity:** P2
- **Dimension:** Interaction design, Platform fit
- **Evidence:** there's a small icon top-right that might be refresh but it's unlabeled
- **Observation:** on a panel about trust, the user needs to know they can re-check on demand after fixing.
- **Recommendation:** explicit `Recheck` button; show last-run time visibly. Consider auto-recheck after a file save.
- **Effort:** S

### F-health-06 — No "filter" or "search" with 321 issues
- **Severity:** P1
- **Dimension:** IA
- **Observation:** at this count, a user can't find anything. Triage becomes scrolling.
- **Recommendation:** top-of-panel filter bar — by severity, by folder, by issue type. Pair with grouping (F-health-04).
- **Effort:** M

### F-health-07 — `INTEGRITY` label is the right pattern; `HARD FAILURES` is not
- **Severity:** P2
- **Dimension:** UX copy, Consistency
- **Evidence:** two sections, `HARD FAILURES` and `INTEGRITY`
- **Observation:** "Integrity" is a property ("is the vault intact?"). "Hard failures" is a severity ("how bad are the issues?"). The two labels don't parallel.
- **Recommendation:** pick one axis — severity (Critical / Warnings / Info) or category (Parsing / References / Index). Don't mix. Severity is more useful for the user.
- **Effort:** S

## Delight opportunities

- **Fixing an issue is a victory moment** — row collapses with a soft check animation; header count decrements with a 300ms tween. Small but reinforcing.
- **Suggested batch actions** — "We detected 18 broken references to deleted file X. Create it? Remove references? Ignore?" as a single actionable card at the top.
- **Health trend** — tiny sparkline in the header showing issue count over the last 7 days. Anxiety-reducer.
- **Celebration at zero** — when health reaches zero issues, show a tasteful "Vault is clean." rather than an empty list.

## What was not captured

- Zero-issues state (critical for defining "healthy")
- Mid-run / running check state
- A single issue's expanded detail
- Any fix action visualized

Re-run after capturing zero-state and an expanded issue detail.
