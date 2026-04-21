# UX Assessment — Handoff Index

Three release arcs, three self-contained handoff documents. Each is designed to be picked up cold in a fresh Claude Code context window.

## Documents

| File | Arc | Scope | Effort | Status |
|------|-----|-------|-------:|--------|
| [v1.1-polish.md](v1.1-polish.md) | **v1.1 Polish** | a11y strike, token hygiene, Canvas/Editor/Ghosts/Health polish | ~60 hrs / 2 wks | **Ready to execute** |
| [v1.2-upgrade.md](v1.2-upgrade.md) | **v1.2 Upgrade** | Shared state primitives, Health redesign, Sidebar, Tension anchoring, Graph, Ghosts-to-action | ~200 hrs / 4–6 wks | Spec ready; depends on v1.1 |
| [v2-architecture.md](v2-architecture.md) | **v2 Architecture** | Canvas decomposition, chrome system, tab model, icon unification | ~200 hrs / 4–6 wks | Spec ready; depends on v1.2 |

## How to use a handoff

1. **Read the document top to bottom once.** It is designed to stand alone — it cites the source findings and the exact files/lines to touch.
2. **Read the two linked background docs** each handoff references (`plan.md`, the relevant finding files). Don't skip these.
3. **Run the pre-flight checklist.** It verifies baseline state before any edit.
4. **Follow the task list in order.** Each task has a "Definition of done" with a verification command.
5. **Pause at the commit gate** (per repo convention) — show summary + `npm run check` results before committing.

## Cross-document context

All three arcs share these source materials:

- [docs/ux-assessment/plan.md](../plan.md) — assessment methodology, rubric, surface inventory
- [docs/ux-assessment/findings/01-static-audit.md](../findings/01-static-audit.md) — Pass 1 findings (token adherence, a11y primitives, architecture drifts)
- [docs/ux-assessment/findings/02-surfaces/](../findings/02-surfaces/) — Pass 2 per-surface critiques (canvas, graph, editor, ghosts, health, + cross-cutting)
- [docs/ux-assessment/findings/05-roadmap.md](../findings/05-roadmap.md) — prioritized backlog + release sequencing

## Repo conventions the handoff assumes

Pulled from `AGENTS.md`, `CLAUDE.md`, and user preferences. Every handoff document restates these so it stands alone, but they live here as the canonical reference:

- **Quality gate:** `npm run check` must pass clean (lint + typecheck + tests) before commit.
- **File size:** keep files under ~800 lines. Three files (`CanvasView.tsx`, `CanvasToolbar.tsx`, `FrontmatterHeader.tsx`) already violate this — v1.1 does **not** refactor them, v2 does.
- **Token usage:** import from `src/renderer/src/design/tokens.ts`; never hardcode hex or px. Pass 1 flagged 5 specific violations — v1.1 fixes them.
- **Commit style:** `<type>: <description>` (feat | fix | refactor | polish | docs | test | chore | perf | a11y). Direct commits to `main` are OK for small fixes, but v1.1 ships as a feature branch and PR since it spans ~30 commits.
- **Commit gate:** pause and present summary + test/typecheck output before committing, wait for the user's green light.
- **Prettier:** single quotes, no semicolons, 100-char width.
- **TypeScript:** strict mode; `_`-prefixed names are exempt from unused-vars lint.
- **IPC timeouts:** critical IPC calls wrapped with `withTimeout(call, ms, label)`.

## Out of scope across all three arcs

These are intentionally *not* in any arc:

- Performance engineering on the 885+ node canvas (needs profiling, separate workstream)
- Theme × accent matrix QA across all 48 combinations (separate QA pass)
- Cross-platform port (Windows/Linux) — product is macOS-only per `README.md`
- Backend/agent feature work beyond what the UX fixes touch
- Telemetry / analytics

## Switching context

When this conversation is archived and a new session picks up v1.1:

1. The new session's prompt should reference `docs/ux-assessment/handoff/v1.1-polish.md` by path.
2. The new session should start by reading that file, then the three linked background docs, then running the pre-flight checklist.
3. This README plus the findings docs provide all necessary context — no conversation history needed.
