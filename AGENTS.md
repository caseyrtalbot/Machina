# AGENTS.md

Codex-specific instructions for `/Users/caseytalbot/Projects/thought-engine`.
`CLAUDE.md` remains the fuller project reference. This file is a curated subset, not a
byte-identical mirror — but wherever both documents cover the same ground, the wording
must be identical: one source of truth, twice named. When an architecture fact changes,
update both files with the same words in the same change. `npm run sync:agents` is a
no-op guard so the scoped instructions cannot be overwritten accidentally.

## Read first

For workstation-track work, reconstruct the live gate from disk before editing:

1. `docs/architecture/workstation/HANDOFF.md` — current shipped state and next gate.
2. `docs/architecture/workstation/PLAN.md` — locked vision, primitives, phases, invariants.
3. The active phase spec — the one HANDOFF.md names (currently
   `docs/architecture/workstation/06-phase-3-specs.md`).
4. `docs/architecture/workstation/01-interface-contracts.md` for any touched boundary.
5. Any follow-up document named by the handoff.

Trust those files over memory, older drafts, or stale line numbers. Use `rg` to re-locate
symbols before editing. Do not trust phase/step state restated in this file or in memory;
HANDOFF.md is the only authority for where the workstation track stands.

The untracked `.agents/skills/thought-engine-council/` tree belongs to Casey. Do not edit,
delete, stage, or commit it.

## Multi-agent workflow

- When two or more workstreams are independent, dispatch them in one wave with explicit,
  non-overlapping file ownership. Keep integration and final decisions in the primary thread.
- Give every delegated task its source-of-truth documents, acceptance criteria, and required
  evidence. Agents may spawn narrower helpers, but they must not duplicate another agent's edits.
- Use an independent cold read for changes to trust boundaries, attribution, harness scopes,
  verification gates, or the built-in agent roster. Findings need file:line evidence and an
  explicit clean/no-finding result for reviewed areas.
- Review every agent diff before accepting it. Fresh verification is required after integration;
  an agent's green focused test is evidence, not a completion claim for the combined tree.

## Commands

```bash
npm run dev                 # Electron app with HMR
npm run dev:debug           # Dev app with CDP on port 9222
npm run check               # lint + node/web typecheck + Vitest
npm run build               # typecheck + production build
npm run test:e2e            # build + sequential Playwright e2e
npm run test:live           # CDP checks against a running dev app
npx vitest run <test-file>  # focused test
npm audit --omit=dev        # production dependency audit
```

For installs, use `--cache /tmp/npm-cache-te` because the normal npm cache may contain
root-owned files.

## Git and change discipline

- Start with `git status --short --branch` and inspect the relevant diff. Preserve all
  unrelated dirty and untracked work.
- Tasks land directly on `main`, one completed step per commit, when committing is in
  scope. Do not introduce feature branches merely for ceremony.
- Before any commit or completion claim, run fresh verification appropriate to risk. The
  repository gate is `npm run check`, `npm run build`, dependency audit, relevant e2e or
  built-app probe, and user-visible visual verification for UI work.
- Some tracked files may have `skip-worktree`; inspect with `git ls-files -v | rg '^S'`
  if an edit is missing from the diff.
- E2E can dirty `e2e/fixtures/test-vault/.machina/state.json`; never include that runtime
  mutation in a product change.
- Never weaken or bypass a red gate. Record exact failures and root causes.

## Architecture boundaries

Machina has four code boundaries:

- Main/Node: `src/main/` — services, filesystem, PTYs, IPC authority.
- Preload: `src/preload/` — typed `window.api` bridge.
- Renderer/React: `src/renderer/src/` — panels, hooks, stores, visual state.
- Shared: `src/shared/` — types, IPC contracts, pure engine code.

`src/shared/engine/` must remain free of Electron and React dependencies. Renderer-only
code may use `@renderer/*`; cross-process contracts belong under `@shared/*`.

New IPC behavior follows the existing four-site pattern:

1. Declare the channel/event in `src/shared/ipc-channels.ts`.
2. Register a typed handler in `src/main/ipc/`.
3. Expose it through `src/preload/index.ts`.
4. Consume it through `window.api` in the renderer.

Main owns workspace roots and security-relevant decisions. Do not trust renderer-supplied
roots, harness identities, or approval state when main can resolve them authoritatively.

**Singleton editor surface**: the dock holds at most ONE editor tab (`{ kind: 'editor' }`,
kind-keyed like graph/ghosts/health — no path). Note identity lives only in editor-store
(`openTabs`/`activeNotePath`); the editor surface's internal note-tab bar is the
multi-note UX. Open notes via `openNoteInEditor(path, { preview?, title? })` from
dock-store — never by constructing an editor DockTab with a path (the type forbids it)
and never by pairing `setActiveNote` with a manual dock open. Rationale: per-path editor
dock tabs co-mounted N editor surfaces under KeepAlive that all read the single global
`activeNotePath` and corrupted each other. Legacy per-path editor tabs in old thread
files fold to one at the dock-store seed boundary (paths harvested into
`editor-store.restoreTabs`). Agent-driven editor opens carry the note as
`DockAction.notePath`, not on the tab.

## Workstation safety invariants

- CLI-agent containment is post-persistence, not write prevention. Writes are already on
  disk when reviewed; Approve commits them and Reject reverts them through git. UI and
  docs must describe this honestly.
- Rollback coverage is the approvals gate. Do not reintroduce the retired pre-run snapshot
  or weaken watcher/queue/revert coverage without an equivalent evidence gate.
- `AgentWriteWatcher` has its own ignore policy. Reusing vault-watcher ignores would blind
  dotfiles, `.env`, and harness verification files.
- Use `TE_DIR`; never hardcode `.machina`. Development uses `.machina-dev`. The deliberate
  exception is `HARNESS_PROTECTED_GLOBS`, which covers both variants.
- Harness creation is refuse-before-write. Calls with `overrides` constructively union
  mandatory protected globs before validation; template-only calls must instead refuse a
  defective template that omits them. In both paths, validate scope, lint, and prove the
  generated frontmatter round-trips before `mkdir` or file output.
- `HarnessRunRegistry` is the thread-to-agent attribution authority. Thread frontmatter is
  display/persistence input, not authority. Bindings snapshot the authoritative adapter;
  a positively known adapter/identity mismatch fails closed before PTY input.
- Ad-hoc `cli-raw` remains a plain PTY with structured input disabled. A harness-bound raw
  turn requires a main-validated, single-line invocation template containing a standalone
  `{prompt}` command word; every placeholder is unquoted/unescaped in one hook-observable
  simple command. Reject controls, DEL/C1 bytes, lone UTF-16 surrogates, arithmetic/
  subscript contexts, unstable spacing/escapes, interactive history expansion, and
  unquoted literal arguments after the executable. Prompt substitution is single-quoted,
  the final PTY command is validated, and the executable is alias-stabilized. Same-named
  shell functions remain an explicit shell-resolution caveat. The template is snapshotted
  in the main-owned binding, never trusted from renderer thread state.
- All agent-originated PTY input continues through the spawner and `writeAgentInput` so
  write arbitration and attribution-window ordering remain intact; never write a raw
  harness command directly to a PTY. Queue refusal must roll back both the raw expectation
  and the turn window.
- A harness run lints, prompts, and binds from one main-read snapshot. Required harness
  files and `handoffs/` must remain regular, realpath-confined entries; never follow a leaf
  symlink into prompt or verification content.
- Preserve degrade-not-fail semantics where the contracts require them, but surface
  degraded containment visibly and audit the coverage gap.
- Renderer IPC timeouts are non-cancelling. A timed-out agent delivery, spawn, harness run,
  or thread save is `indeterminate`, not retryable success/failure. Keep the late operation
  attached, replay Stop onto late native run ids when possible, and keep sending blocked
  until main-originated completion/refusal settles it. Thread deletion/close must tombstone
  late work; workspace switches fence stale dispatch state without auto-killing
  old-workspace PTYs unless OQ8 is separately ratified.
- Extend existing stores, IPC maps, adapters, and dock patterns rather than creating a
  parallel implementation.

## Implementation conventions

- TypeScript strict mode; Prettier uses single quotes, no semicolons, 100-column width.
- Prefer immutable updates. Zustand tests reset with
  `store.setState(store.getInitialState())` in `beforeEach`.
- Keep files below 800 lines. `thread-store.ts` is already over the threshold; do not grow
  it.
- Use `Result<T>` for expected engine failures and branded ids where established.
- Critical renderer-to-main calls use `withTimeout(call, ms, label)`.
- User-edit content pushes happen in user-action callbacks, never a syncing `useEffect`.
- UI uses `design/tokens.ts`, theme CSS variables, and existing components. Do not hardcode
  hex colors or arbitrary pixel values. Machina is dark-only with runtime accent changes.
- Preserve terminal/block behavior and latency; PTY migration reprojects a live session
  and must not silently kill or duplicate it.

## Testing and UI evidence

- Unit tests use Vitest/happy-dom; Node integrations declare
  `// @vitest-environment node`; e2e is serial Playwright.
- Test contracts and failure behavior, not only successful rendering. Security-relevant
  input paths need negative tests that prove nothing was written.
- Built-app probes should wait for boot/reload to settle before `page.evaluate`; locator
  waits survive navigation, evaluate contexts do not.
- Non-packaged Electron runs share Application Support state. Treat surprising persisted
  state as a possible test contaminant before changing product behavior.
- Drive CDP/Playwright checks directly. Ask Casey only for genuinely visual acceptance,
  phrased as user-visible actions rather than DevTools or localStorage instructions.

## Compaction priorities

Preserve the active plan and step, verification evidence, agent findings, corrected root
causes, and architecture decisions. Deprioritize dead-end searches and raw outputs that
have already been summarized.
