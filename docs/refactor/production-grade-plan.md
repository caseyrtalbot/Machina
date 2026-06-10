# Machina Production-Grade Plan

Synthesized from a 12-dimension, 154-finding audit (2026-06-09). Findings marked *verified* survived adversarial verification; unverified medium/low claims were weighed and either folded in, deferred, or rejected below.

**Vision yardstick:** infinite canvas for connections, integrated terminal, vault ontology (tags/links/ghosts/emergence), Claude+Codex AI, PDF embedding, frictionless onboarding, dark/glass/Ember design. Every item below either fixes a data-loss/correctness path, deletes weight that doesn't earn its place, or closes a gap to that vision.

## Wave structure

- **Wave 1 — Foundation & correctness.** Verified bugs, data-loss paths, production gaps, dead-weight deletions. Items have **disjoint file sets** and are safe to implement in parallel by independent agents.
- **Wave 2 — Coherence.** Architecture convergence, design-system consistency, UX friction. Runs after Wave 1 (may touch Wave 1 files).
- **Wave 3 — Vision.** Missing capabilities: search, linking, PDF/embeds, onboarding journey, spatial parity.

**Wave 1 ground rule:** `src/shared/ipc-channels.ts`, `src/preload/index.ts`, and `src/main/index.ts` belong exclusively to item 1.9 (deletion sweep). No Wave 1 item may add a new IPC channel; fixes that need one (doc save-failed event, shell-hook installer) are scheduled in Wave 2.

---

## Wave 1 — Foundation & correctness

### 1.1 Trash, PathGuard, and the document lifecycle: kill every data-loss path (L)

**Files:** `src/main/ipc/filesystem.ts`, `src/main/services/document-manager.ts`, `src/renderer/src/hooks/useDocument.ts`, `src/renderer/src/panels/editor/EditorPanel.tsx`, `src/renderer/src/panels/editor/SourceEditor.tsx`, `src/renderer/src/store/editor-store.ts`, `src/renderer/src/panels/sidebar/Sidebar.tsx`, `src/renderer/src/panels/agent-shell/dock-adapters/FilesDockAdapter.tsx`, `src/renderer/src/panels/editor/EditorBreadcrumb.tsx` (delete), plus unit tests.

Six coordinated fixes, one owner (they share files):

1. **Trash, not rm -rf.** `shell:trash-item` (filesystem.ts:268-271) currently runs `rm(args.path, { recursive: true })` with no PathGuard. Replace with Electron `shell.trashItem(resolved)` and route the path through `guardPath(args.path, 'shell:trash-item')` like the sibling fs handlers. While there: add `guardPath` to `fs:list-all-files` (line ~122), `shell:open-path`, `shell:show-in-folder`; restrict `shell:open-external` to http/https (reuse `isExternalHttpNavigation` from external-navigation.ts). Test: out-of-vault path throws.
2. **Conflict resolution does what the button says.** `resolveConflict('disk')` (useDocument.ts:140-144) calls close→open, but `DocumentManager.close` flushes dirty content to disk first (document-manager.ts:82-86) — it overwrites the external change. Fix in main only (no new IPC): track a `conflicted` flag on the open Document (set when conflict detected, cleared on resolve-keep-mine/save); `close()` skips the dirty flush while conflicted. Unit test: open → dirty → external change → resolve 'disk' → disk content unchanged, editor shows disk version.
3. **Stale dirty flag blocks external/agent edits forever.** editor-store sets `isDirty` on every keystroke (editor-store.ts:161) and nothing clears it on autosave, so EditorPanel's sync effect (EditorPanel.tsx:246-249) never applies external changes and the next keystroke clobbers agent edits. Clear store dirty on the docSaved event — or better, derive dirty solely from `useDocument` and delete the duplicate store flag. Handle the external-change event explicitly: re-parse `doc.content` into Tiptap (at minimum with a visible "file updated" affordance).
4. **Source mode bypasses DocumentManager.** SourceEditor onChange only does store `setContent` (EditorPanel.tsx:438) — no autosave, and mode-switch loses edits because the Tiptap sync effect bails while dirty. Route source changes through `doc.update` (debounced) so DocumentManager owns persistence in both modes; on rich→source seed CodeMirror from the freshly serialized Tiptap doc; on source→rich re-parse store content into Tiptap (reset `prevLoadedPathRef`) before allowing edits.
5. **Rename/move re-keys open documents.** Sidebar rename (Sidebar.tsx:447-465) and drag-move (FilesDockAdapter.tsx:361-370) call `fs:rename-file` with no doc/store update — the next autosave resurrects the old file. Add `documentManager.rename(oldPath, newPath)` called from the existing `fs:rename-file` handler in main (no new channel); add a `mapPaths` helper in editor-store updating openTabs/activeNotePath/history, called from both rename and move flows. Also decouple the backlink-rewrite decision from id derivation: rewrite whenever `oldStem !== newStem` (Sidebar.tsx:444), and route backlink-file rewrites through the document IPC path rather than raw `fs.writeFile` so open dirty files aren't clobbered.
6. **Delete the dead split-pane path.** No caller passes EditorPanel's `filePath` prop; `splitNotePath`/`openSplit`/`closeSplit` (editor-store.ts:169-170), EditorBreadcrumb.tsx, cursorLine/cursorCol tracking + `handleSelectionUpdate` work, and `migrateLegacyWikilinks` (+tests) have zero consumers. Delete all of it, including the latent cross-file frontmatter write bug branch (EditorPanel.tsx:423-429).

### 1.2 Frontmatter property edits must round-trip YAML (M)

**Files:** `src/renderer/src/panels/editor/markdown-utils.ts`, `src/renderer/src/panels/editor/FrontmatterHeader.tsx`, tests.

`parseFrontmatter` only matches flat top-level `key: value` lines and `dispatchChange` re-serializes the whole block from that lossy parse (FrontmatterHeader.tsx:338-342) — one property edit silently deletes nested maps, block scalars, and comments. Fix: patch only the changed key in the raw YAML text, or parse with js-yaml (already in the tree via gray-matter) and round-trip unknown structures verbatim. Add tests with nested maps, block scalars (`|`, `>`), and comments surviving an edit.

### 1.3 Engine kernel correctness: connections and ghosts actually work (M)

**Files:** `src/shared/engine/graph-builder.ts`, `src/shared/engine/ghost-index.ts`, `src/shared/engine/parser.ts`, `src/shared/engine/concept-extractor.ts`, `src/shared/engine/ontology-types.ts`, `tests/engine/*`.

1. **Phantom frontmatter connections (verified).** graph-builder.ts:117-122 uses the raw frontmatter value as node id for connection/cluster/tension/appears_in/related edges; the app's own autocomplete inserts *titles*, so edges point at phantom nodes. Route all five relationship arrays through the same `lowerTitleToId.get(...) ?? lowerToId.get(...) ?? v` lookup `sources` already uses. Regression test: title-vs-id mismatch (id from filename stem, title from frontmatter/H1).
2. **Capitalized wikilinks dropped from ghosts (verified).** Ghost ids are lowercased but `extractContext` (ghost-index.ts:51) builds a case-sensitive regex against the original body, and the frontmatter fallback uses case-sensitive `.includes()` — `[[Richard Hamming]]` yields zero ghost entries. Add the `i` flag, lowercase both sides of the membership check, and preserve first-seen original casing for display (return `{raw, lower}` from `extractBodyWikilinks`).
3. **Case-split duplicate ghost nodes.** Key placeholder nodes by lowercase id, store first-seen display casing in `node.title`, so frontmatter and body references converge.
4. **Code fences create false edges.** Add a shared `stripCode` helper (fenced blocks + inline spans) applied before wikilink and concept extraction in parser.ts and concept-extractor.ts. Test with a fenced `[[fake link]]`.
5. **No fabricated dates.** `toDateString` (parser.ts:38-42) stamps "today" on files without frontmatter dates. Make created/modified optional and return undefined when absent.
6. **derived_from edge weight.** Add `derived_from` to `EDGE_WEIGHT_TABLE` (ontology-types.ts:111-118) with an explicit value and comment so the omission is a decision.

Update tests/engine/ghost-index.test.ts to exercise the real parser→graph→ghost pipeline instead of hand-built nodes.

### 1.4 Canvas mutation safety: undo everything, destroy nothing silently (L)

**Files:** `src/renderer/src/store/canvas-store.ts`, `src/renderer/src/panels/canvas/canvas-commands.ts`, `CanvasToolbar.tsx`, `CanvasView.tsx`, `use-canvas-keyboard-shortcuts.ts`, `use-canvas-drag.ts`, `ConnectionDragOverlay.tsx`, `NoteCard.tsx`, `CardShell.tsx`, `ProjectFolderCard.tsx` (all under `src/renderer/src/panels/canvas/`), tests.

1. **CommandStack becomes the single mutation entry point.** Today only card-add/import/show-connections/folder-map are undoable. Wrap as commands: node remove (capture node + attached edges — keyboard Delete at use-canvas-keyboard-shortcuts.ts:84-93 and every card close button), drag-end (capture start/end positions in use-canvas-drag.ts), resize-end, addEdge/removeEdge (ConnectionDragOverlay.tsx:53), type conversion, and tile/semantic layouts (capture position map).
2. **Clear with confirm + undo.** CanvasToolbar onClear (612-630) → CanvasView (474-487) wipes nodes/edges via setState and autosave persists it. Route through `commandStack.execute` capturing prior nodes/edges/ontology, behind a two-click "Clear? → Confirm" state.
3. **Type conversion must not erase content.** `updateNodeType` (canvas-store.ts:307-313) sets `content: ''`. Preserve content for text↔markdown↔code (reset only metadata via `getDefaultMetadata`); wipe only where meaningless (→terminal); push through CommandStack.
4. **removeNode hygiene.** Clear `lockedCardId`/`focusedCardId` when they reference the removed id (currently strands wheel/pan dead); if the removed node is `type === 'terminal'` with a session id, invoke `terminal.kill` so canvas Delete stops orphaning live PTYs (kill currently lives only in TerminalCard.handleClose).
5. **NoteCard frontmatter strip.** Only strip when content starts with `---\n` and the closing delimiter is at line start (currently corrupts notes with `---` hr lines); extract the duplicated load/reload logic into one helper.
6. **Dead `collapsed` state.** Delete the unused folder open/closed emoji branch in ProjectFolderCard (nothing ever toggles it).

### 1.5 Canvas persistence: atomic writes, no silent reset (S)

**Files:** `src/main/ipc/canvas.ts`, `src/renderer/src/panels/canvas/canvas-io.ts`.

`canvas:save` writes directly (no tmp+rename) and `deserializeCanvas` swallows JSON.parse failures by returning an empty canvas — a crash mid-write silently destroys the spatial arrangement on next launch. Write canvas files atomically (same tmp-file+rename mechanics as file-service.ts); on parse failure, copy the corrupt file to `canvas.json.bak` and return an error the renderer surfaces instead of an empty `createCanvasFile()`.

### 1.6 FileViewCard 'r' hotkey stops eating keystrokes (S)

**Files:** `src/renderer/src/panels/canvas/FileViewCard.tsx`, `src/renderer/src/panels/canvas/shared/codemirror-setup.ts`.

The window-level 'r'/'R' refresh listener (FileViewCard.tsx:236-248) fires while typing in editable section cards and replaces the doc with on-disk content, losing debounced edits; Cmd+R also triggers it. Guard with "target not inside `.cm-editor`" (or an `isEditingSurfaceActive()` check) and require no modifier keys; add the keydown stopPropagation handler to `createEditorExtensions` the way CodeCard.tsx:77-81 does.

### 1.7 Wire the block protocol end to end (L)

**Files:** `src/renderer/src/store/block-store.ts`, `src/main/services/block-watcher.ts`, `src/shared/engine/block-detector.ts`, `src/shared/engine/block-model.ts`, `src/main/ipc/shell.ts`, `resources/shell-hooks/te.zsh`, `te.bash`, `te.fish`, `src/renderer/src/panels/canvas/useTerminalStatus.ts`, `src/main/services/pty-monitor.ts`, `src/renderer/src/panels/canvas/TerminalCard.tsx`, `BlockCard.tsx`, `block-pin.ts`, `docs/architecture/block-protocol.md`, CLAUDE.md/AGENTS.md block sections.

The main process produces Block snapshots but no renderer code subscribes — the entire feature is inert. All existing IPC channels suffice; no preload changes needed.

1. **Consume block:update.** Add a module-level subscription in block-store.ts (mirror the `window.api.on.healthReport` pattern in vault-health-store.ts:144): `window.api.on.blockUpdate(({sessionId, block}) => useBlockStore.getState().applyUpdate(sessionId, block))`, plus `clearSession` on terminal exit. Integration test drives an event through the subscription into the store.
2. **Populate Block.command.** BlockWatcher starts blocks with `command: ''`, which kills the CLI thread bridge and agent session listener. zsh/bash preexec receive the command — emit it as a percent-encoded `cmd=` key in `te-command-start`, parse in block-detector, pass to `startBlock`. Fallback: derive via `extractCommand(stripTerminalControls(outputText))` at command-end. Replay-test a real hook-marked session.
3. **Fix te.fish on macOS.** `date +%s%3N` yields a non-numeric ts on BSD date (blocks never form); compute ms without `%N` (`math (date +%s) x 1000`) and replace the file-scope `exit 0` re-source guard with a conditional (it currently kills the shell on double-source).
4. **terminal:exit reaches the main renderer.** shell.ts:70 sends only to the webview; also send to the main BrowserWindow (like block:update) so `useTerminalStatus.markSettled` fires. Handle the webview's `session-exited` ipc-message in TerminalCard (only `session-created` is handled today) to show the dead-session overlay on normal exit; replace the nonexistent `'crashed'` webview event with `'render-process-gone'` (Electron 39).
5. **Fix status detection.** `ps -o comm=` returns `/bin/zsh` on macOS — not in either shell set, so idle shells show busy forever. Match on `basename(comm)` in useTerminalStatus.ts and pty-monitor.ts, and once blocks flow, derive busy from "a running block exists" rather than ps'ing the shell pid (structurally incapable of seeing foreground commands).
6. **Bound the pipeline.** Cap block output (head 64KB + tail 256KB with truncation marker) in block-model.ts, throttle emits to ~10Hz per session in block-watcher/shell.ts, and drop the duplicate `outputBytes` Uint8Array from the IPC payload (BlockCard only uses outputText).
7. **Pins survive restart.** At pin time (block-pin.ts), persist the resolved command and a truncated, secret-masked output snapshot (e.g. 8KB post-`maskSegmentText`) in node metadata; BlockCard renders the archived state instead of "(no command)" + empty body. Add a 1s elapsed tick while `state.kind === 'running'`; mask secrets in the card title with the same scanSecrets rules as output. Drop or render the dead `agentContext` field.
8. **Resync docs.** block-protocol.md's "legacy after 5s" paragraph and CLAUDE.md/AGENTS.md's `useBlockUpdates` hook describe code that doesn't exist; update to the shipped mechanism.

### 1.8 Agent thread reliability: native + CLI (M)

**Files:** `src/main/services/cli-thread-spawner.ts`, `src/main/ipc/cli-thread.ts`, `src/renderer/src/store/thread-store.ts`, `src/main/services/machina-native-agent.ts`, `src/renderer/src/panels/agent-shell/ThreadInputBar.tsx`.

1. **CLI threads survive restart.** `sessionByThread` is in-memory only, so every persisted CLI thread is dead after relaunch and `thread-store.appendUserMessage` ignores the `{ok:false}` from `cliThread.input` while setting inFlight — silently wedging the thread. Make `cli-thread:input` spawn-on-demand in main when no session exists (same args as createThread); in the renderer, check the result, surface a system message, and clear inFlight on failure.
2. **Pre-run vault snapshot.** Call `commitPreAgentSnapshot(vaultRoot, threadId)` (vault-git.ts, never-blocks-on-failure semantics) at the top of `CliThreadSpawner.spawn` — the rollback safety currently lives only on the dead PTY path.
3. **Native history hygiene.** Filter empty/whitespace-body messages out of `historyMessages` (thread-store.ts:304-310) — tool-only turns persist `body: ''` which the Anthropic API rejects, poisoning every later turn. (Reconstructing tool_use/tool_result context across turns is Wave 2.)
4. **Inactivity timer + cancellation.** Reset the 60s abort timer inside the stream's for-await loop (each delta proves liveness — currently any >60s response is killed mid-generation); track a `userAborted` flag set by `abortMachinaNative` so Stop renders quietly instead of `[error: SDK_TIMEOUT]`.
5. **No concurrent runs on one thread.** Guard Enter in ThreadInputBar while `inFlightByThreadId[activeId]`, and have `appendAssistantStreamChunk` drop events whose runId doesn't match `runIdByThreadId[threadId]` (runId is already on every event).

### 1.9 Dead-subsystem deletion sweep + doc resync (L)

**Files:** `src/shared/ipc-channels.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ipc/workbench.ts` (delete), `src/main/ipc/agents.ts` (trim), `src/main/ipc/actions.ts` (delete), `src/main/ipc/artifact.ts` (delete), `src/main/ipc/mcp.ts` (delete), `src/main/services/`: `project-watcher.ts`, `session-tailer.ts`, `project-session-parser.ts`, `session-milestone-grouper.ts`, `session-utils.ts`, `agent-spawner.ts`, `artifact-materializer.ts`, `default-agent-prompt.md`, `bundled-actions/` (delete), `src/main/services/file-service.ts` (remove seeding block), `scripts/agent-wrapper.sh`, `src/shared/workbench-types.ts`, `src/shared/action-types.ts`, `src/shared/agent-artifact-types.ts`, `src/shared/canvas-mutation-types.ts` + `canvas-mutation-validation.ts` (drop `materialize-artifact` op), `src/main/services/pty-service.ts` + `shell-service.ts` + `pty-write-queue.ts` (tmux-era dead members), orphaned renderer files: `src/renderer/src/design/components/SplitPane.tsx`, `src/renderer/src/panels/canvas/card-title.ts` (+ its two duplicate test files), `src/renderer/src/engine/graph-summary.ts`, `connect-manifest.ts`, `id-generator.ts`, `search-engine.ts`/`indexer.ts` re-exports if confirmed orphaned, plus their tests. `CLAUDE.md`, `AGENTS.md`.

This item exclusively owns ipc-channels.ts, preload/index.ts, and main/index.ts in Wave 1. Procedure: classify each candidate with rg (real reference vs false positive) before deleting; the typed IPC map makes orphans compile errors, so run `npm run typecheck` after each subsystem.

1. **Workbench/session-milestone pipeline (~630 lines, zero renderer callers):** delete workbench.ts, project-watcher, session-tailer, project-session-parser, session-milestone-grouper, session-utils, workbench-types, the `workbench:*`/`session:*` channels + preload namespace, and the registerProjectIpc/getProjectWatcher/getSessionTailer + quit-path wiring in main/index.ts. Keep `panels/workbench` card components — they're alive via the canvas card-registry.
2. **PTY agent path 1:** delete AgentSpawner, `agent:spawn`/`agent:kill`/`agent:list-installed`, default-agent-prompt.md, agent-wrapper.sh, and the never-passed onSpawnAgent row plumbing in CanvasContextMenu if orphaned by this. **Keep** pty-monitor + `agent:get-states`/`agent:states-changed` (live via FilesDockAdapter badging) and **keep vault-git.ts** (item 1.8 now calls it).
3. **Actions subsystem:** delete actions.ts, action-types.ts, the bundled-actions seeding in file-service.ts and the bundled-actions/*.md files, the actions preload namespace, `actions:*` and `vault:list-commands` channels.
4. **Artifact materializer:** delete artifact.ts, artifact-materializer.ts, `artifact:*` channels/preload, the `materialize-artifact` plan-op variant (validation already unconditionally rejects it), AgentArtifactDraft, and `serializeDraft` in parser.ts (materializer is its only caller).
5. **mcp:status:** delete ipc/mcp.ts and the channel (handler exists, preload exposure doesn't — nothing can call it). The `createForVault` in-process server instantiation stays for now; its connect-or-delete decision is Wave 2 item 2.3.
6. **Dead channel sweep:** remove `window:minimize/maximize/close` (macOS traffic lights), `doc:get-content`, `thread:read`, `vault:write-config`, `vault:read/create/update-system-artifact` (keep list), `fs:delete-file`, `fs:create-folder`, `fs:list-files-recursive` — verifying zero callers each. **Do NOT remove:** `claude:get-status` (item 1.10 starts calling it), `thread:list-archived` (Wave 2 archive UI), `cli-agent:*` events (Wave 2 consumer decision), `canvas:get-snapshot`/`canvas:apply-plan` (live from main-side agent/MCP flows). Trim the main-preload `api.terminal` namespace to `kill`/`getProcessName` (+exit event) — the webview bridge owns the rest.
7. **tmux-era PTY dead code:** delete `PtyService.discover`/`detachAll`/DiscoveredSession and the unused `command` PtyWrite variant; fix the `write()` doc comment; point `ShellService.sendRawKeys` at `pty.sendRawKeys` (currently routes to `write`).
8. **Orphaned renderer files:** delete the six listed files + tests (EditorBreadcrumb is handled by item 1.1).
9. **Doc resync:** update CLAUDE.md + AGENTS.md — two agent paths not three, no session-tailer/Workbench, accurate accent/settings description (accent presets + custom hex + density/radii/backgroundTint/canvasGrid are shipped), block-protocol wiring per item 1.7. Delete the stale "data only" header in accent-presets.ts.

### 1.10 First-run, boot wiring, and error surfacing (M)

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/store/claude-status-store.ts`, `src/renderer/src/utils/error-logger.ts`, `src/renderer/src/store/vault-store.ts`, new `src/renderer/src/components/Toast.tsx`, new `src/renderer/src/components/FirstRunScreen.tsx`, `src/renderer/src/panels/agent-shell/ThreadSidebar.tsx`, `src/renderer/src/panels/agent-shell/keybindings.ts`.

Uses only existing IPC channels (`claude.getStatus`, `on.claudeStatusChanged`, `agentNative.hasKey`, `app.pathExists`).

1. **Claude status boot hook.** Subscribe once at startup: seed with `window.api.claude.getStatus()` → `useClaudeStatusStore.setStatus`, subscribe `on.claudeStatusChanged(setStatus)`, and initialize `nativeKeyConfigured` from `agentNative.hasKey()` (today only Settings touches it, so the suppress-overlay gate is broken every launch). This unblocks the onboarding overlay and fixes the permanently false "CLI not found" badge on terminal cards.
2. **Real error notifier.** Build a minimal Toast component (design tokens only: glass material, `--color-accent-default`, zIndex token) and call `setErrorNotifier` in App init so the existing `notifyError` calls (canvas save, workspace persist, autosave) reach the user. Test: notifyError reaches the registered notifier.
3. **Vault load failures surface.** `loadVault`'s catch currently console.errors and proceeds with `vaultPath` set. Surface via notifyError and set a `loadError` field the shell renders (include main's "delete .machina/config.json to reset" guidance) instead of a silently empty workspace.
4. **First-run state.** When `vaultPath` is null, render a dedicated full-screen state (Open Folder CTA + vault history) instead of the normal three-pane shell — the designed welcome card is currently unreachable. Guard/disable New-thread and Cmd+N affordances (ThreadSidebar, keybindings) when no vault, with a tooltip pointing at Open Folder; today `void createThread` rejects silently with "vault not set".
5. **Missing vault isn't recreated.** Before auto-loading `lastVaultPath`, check `app.pathExists`; if gone, clear it and show first-run with "previous vault not found at <path>" instead of mkdir-ing a ghost vault.

### 1.11 Hide the multi-canvas affordance until it's real (S)

**Files:** `src/renderer/src/panels/agent-shell/palette-sources.ts`.

Named canvas tabs all render the single global canvas store (thread-store.ts:613 admits per-id files aren't implemented), so "Open canvas: <id>" palette entries show the wrong data. Filter palette canvas entries to the default canvas only, with a comment pointing at Wave 3 item 3.8 (real per-id stores). Don't ship a visible affordance that lies.

---

## Wave 2 — Coherence

### 2.1 CLI threads: session continuity and structured replies (L)

**Files:** `src/main/services/cli-thread-spawner.ts`, `src/main/services/cli-agent-thread-bridge.ts`, `src/renderer/src/panels/agent-shell/tool-renderers/CliCommandCard.tsx`, `src/renderer/src/panels/agent-shell/ThreadMessage.tsx`, `src/renderer/src/hooks/use-thread-streaming.ts`.

- Per-thread continuity in `formatCliInvocation`: `claude --print --continue` on subsequent turns (stable per-thread cwd), `codex exec resume --last`; gate per agent with a first-turn flag the spawner already knows.
- Structured output: drive claude with `--print --output-format stream-json` and `codex exec --json`; bridge extracts assistant text into `message.body` (rendered as markdown) and streams interim events; keep the raw block as a secondary expandable card. At minimum strip terminal controls from stored output. Today replies render as an empty bubble + collapsed ANSI dump with zero streaming.
- AUTH UX: special-case `code === 'AUTH'` in use-thread-streaming to render a system message with an "Add API key in Settings" action instead of the raw `[error: AUTH]` string.

### 2.2 Agent architecture convergence and native-agent quality (L)

**Files:** `src/main/services/machina-native-agent.ts`, `src/main/services/machina-native-tools.ts`, `src/shared/machina-native-tools.ts`, `src/renderer/src/store/thread-store.ts`, `src/main/services/thread-md.ts`, `src/renderer/src/panels/agent-shell/{AgentShell,ThreadSidebar,ThreadInputBar,CommandPalette}.tsx`, `src/main/services/cli-agent-session-listener.ts`, `src/renderer/src/store/canvas-store.ts`.

- Define one `AgentTransport` interface (start/sendTurn/cancel/events) implemented by the native path and the CLI path so thread-store stops branching on `agent !== 'machina-native'` in five places. Keep gemini in the CLI registry but don't grow its surface.
- Delete `asToolCall` (~115 duplicated lines): make `callTool` return `{ result, call: ToolCall | null }` from its already-validated input; consider one Zod definition per tool generating both NATIVE_TOOLS schema and the ToolCall union.
- Move the system prompt to main with the `.machina/agent-prompt.md` override mechanism; write a real prompt (vault structure, wikilink/canvas conventions, tool selection, read-before-write). Surface the silent MAX_TOOL_ITERATIONS=8 cutoff as a notice; revisit MAX_TOKENS=4096.
- Centralize `DEFAULT_NATIVE_MODEL` in shared (replaces 4 hardcoded 'claude-sonnet-4-6' literals); add a minimal model selector for native threads; store model only for native threads.
- Persist tool exchanges well enough to reconstruct tool_use/tool_result (or a textual summary) so multi-turn tool context survives (follows 1.8's empty-body filter).
- Harden thread-md round-trip: sentinel comment markers carrying role + sentAt so message bodies containing `## User` or tool-call fences don't corrupt history; property test with adversarial bodies.
- Renderer-side plan validation: re-run `validateCanvasMutationOps` against live store state in `applyAgentPlan`, keeping the main mtime check as the cross-process freshness gate.
- Decide cli-agent session-status events: wire terminal-card/dock agent badges (now functional after 1.7's command fix) or delete the listener + emissions. Recommend wiring — agent presence on terminals serves the vision.

### 2.3 Live vault index + in-process MCP decision (M)

**Files:** `src/main/services/vault-indexing.ts`, `src/main/index.ts`, `src/main/services/vault-query-facade.ts`, `src/main/services/mcp-lifecycle.ts`, `src/preload/index.ts`, `src/shared/ipc-channels.ts`, new ADR in `docs/architecture/adr/`.

- Subscribe the main-process index to VaultWatcher batches: `vaultIndex.updateFile/removeFile` + `searchEngine.upsert/remove` per changed .md; also after facade `writeFile`/`createFile` so agents see their own writes. Today MCP search/graph/ghosts are frozen at vault-open.
- Decide the in-process MCP server: either connect a stdio/HTTP transport so external Claude Code/Desktop gets the gated writes (the differentiator — recommended), re-expose `mcp:status` in preload with a Settings/Statusbar surface, and fix the stale `_toolCount = 6`; or delete `createForVault` and the ElectronHitlGate branch, keeping headless read-only mcp-cli. Record the choice as an ADR either way.

### 2.4 Vault worker scaling and indexing progress (M)

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/engine/vault-worker.ts`, `src/renderer/src/engine/vault-worker-helpers.ts`, `src/renderer/src/utils/chunk-loader.ts`, `src/renderer/src/components/Statusbar.tsx`.

Every message — including single-file updates — rebuilds the full graph and structured-clones every artifact body; a 5k vault does ~100 escalating O(n²) rebuilds on load. Add an `update-many` batch message (one rebuild per watcher batch instead of N), debounce `buildResult`/postResult to once per ~1s during chunked appends with one final post, and drive an "Indexing N/M notes" Statusbar indicator from chunk progress. Full incremental/delta posting is a follow-on if profiling still demands it.

### 2.5 Canvas persistence convergence and visible edges (M)

**Files:** `src/renderer/src/store/canvas-autosave.ts`, `src/renderer/src/panels/canvas/use-canvas-file-lifecycle.ts`, `src/renderer/src/store/canvas-store.ts`, `src/renderer/src/panels/canvas/EdgeLayer.tsx`.

- One autosaver: keep the App-level `subscribeCanvasAutosave` (it has quit-flush integration), delete the competing 500ms effect in use-canvas-file-lifecycle.
- Version-safe saves: add a monotonic `dirtyVersion`; `markSaved(version)` no-ops if the version advanced during the awaited write (today mutations landing mid-save are flipped clean and lost until the next dirty transition).
- Persist viewport: save on quit/pan-end when the in-memory viewport differs from loaded (without dirtying every pan frame).
- Edges visible by default: render user-created kinds (connection/tension/causal) at low opacity always, demand-reveal the noisy structural kinds, persist `showAllEdges`, and only mount the 12px invisible hit path when an edge is revealed (currently clickable-but-invisible edges can be selected and deleted unseen). "See connections" is pillar 1; invisible-by-default contradicts it.

### 2.6 Production hardening: crash recovery, logging, save-failure surfacing, durability (L)

**Files:** `src/main/index.ts`, `src/main/services/document-manager.ts`, `src/shared/ipc-channels.ts`, `src/preload/index.ts`, `src/renderer/src/hooks/useDocument.ts`, `src/main/services/main-logger.ts`, `src/main/utils/atomic-write.ts`.

- **doc:save-failed event** (new IpcEvents entry, now allowed post-sweep): emit from the autosave catch and saveToDisk failures; useDocument surfaces a persistent dirty/error state + toast. Today a full-disk user types all session believing work persists.
- **render-process-gone**: log reason, `webContents.reload()` (PTYs reconnect, state.json restores), dialog after two crashes in a minute.
- **will-attach-webview**: assert preload resolves to out/preload/terminal-webview.js, force contextIsolation, preventDefault anything else (~20 lines in the existing web-contents-created hook).
- **CSP**: build prod and test dropping `'unsafe-eval'` from script-src; if a dep needs it, isolate that consumer.
- **uncaughtException**: dialog offering relaunch after first occurrence; `crashReporter.start({ uploadToServer: false })` for local minidumps.
- **Logging**: forward renderer console warnings/errors to main.log via `console-message`, size-based rotation at ~5MB, buffered async appends, "Reveal logs" in Settings.
- **atomic-write**: fsync before rename (and parent dir), unlink tmp on failure — it's the single durability contract for every writer.

### 2.7 State and persistence hygiene (M)

**Files:** `src/renderer/src/store/vault-persist.ts`, `src/renderer/src/store/thread-store.ts`, `src/renderer/src/store/ui-store.ts`, `src/renderer/src/panels/agent-shell/ThreadSidebar.tsx`, `src/renderer/src/panels/agent-shell/dock-adapters/FilesDockAdapter.tsx`, `src/main/index.ts`.

- Quit flush: add `flushDockState(activeThreadId)` to the quit handler Promise.all (active thread's dock tabs are currently lost), add a `.catch` so a failed flush still sends quitReady, and raise the main-side budget from 500ms to ~2.5s.
- Thread archive becomes two-way: an "Archived" section in ThreadSidebar lazily calling `thread.listArchived` with unarchive/delete (plumbing exists end-to-end, no UI).
- VaultState: wire `fileTreeCollapseState` into FilesDockAdapter (restore on mount, update on toggle); delete the other write-only fields (panelLayout.sidebarWidth, selectedNodeId, recentFiles) unless a consumer ships with them.
- ui-store becomes the single owner: gatherVaultState reads `useUiStore.getState()` directly; delete the parallel module-level uiState/getUiState/updateUiState mirroring.

### 2.8 Design convergence: menus, overlays, focus (M)

**Files:** `src/renderer/src/components/ContextMenu.tsx`, `src/renderer/src/panels/sidebar/FileContextMenu.tsx`, `src/renderer/src/panels/editor/EditorContextMenu.tsx`, `src/renderer/src/panels/canvas/{CanvasContextMenu,CardContextMenu}.tsx`, `src/renderer/src/panels/sidebar/VaultSelector.tsx`, `src/renderer/src/components/OnboardingOverlay.tsx`, `src/renderer/src/design/tokens.ts`, `src/renderer/src/panels/canvas/ImportPalette.tsx`, `src/renderer/src/components/SettingsModal.tsx`, plus the outline-none call sites (`FrontmatterHeader.tsx`, `PropertyInputs.tsx`, `ConnectionAutocomplete.tsx`, `SaveTextCardDialog.tsx`).

- One menu primitive: extend components/ContextMenu.tsx (shortcut labels, section headers, icons) and migrate the four bespoke menus + VaultSelector's inline menu onto it — this also spreads keyboard nav beyond agent-shell.
- One scrim: emit `colors.scrim.modal` (0.55) as a CSS var; replace `--bg-overlay` 0.72 and the two inline 0.4 backdrops; delete orphaned vars.
- OnboardingOverlay onto tokens: zIndex.modal (currently 45, under dock popovers), scrim token, floatingPanel.glass.bg, CSS hover/focus-visible instead of onMouseEnter style mutation.
- Focus audit: every `outline-none`/`focus:outline-none` either drops the class (global ring acceptable) or adds an explicit :focus-visible treatment.

### 2.9 Design convergence: tokens, settings toggles, graph chrome (M)

**Files:** `src/renderer/src/design/{tokens.ts,themes.ts,Theme.tsx,apply-accent.ts}`, `src/renderer/src/panels/graph/{GraphPanel,GraphSettingsPanel,GraphDetailDrawer}.tsx`, `src/renderer/src/panels/graph/graph-label-layer.ts`, `src/renderer/src/panels/ghosts/GhostPanel.tsx`, `src/renderer/src/components/Statusbar.tsx`, `src/renderer/src/panels/sidebar/{FileTree.tsx,origin-utils.ts}`, `src/renderer/src/panels/workbench/{WorkbenchFileCard.tsx,workbench-animations.css}`, `src/renderer/src/components/SettingsModal.tsx`.

- **Density: wire or delete.** Decision: wire `var(--ui-fs)`/`--row-h`/`--pad-panel-*` into the row-like surfaces (sidebar rows, settings rows, thread list, dock tabs) in one pass; if that proves too invasive, delete the control and DENSITY_VARS instead. Half-working settings erode trust; pick one in this PR.
- **Radii:** make the tokens.ts borderRadius object emit `var(--r-*)` instead of literal 0 so all 93 inline consumers track the Soft/Square toggle; replace the 19 bare `rounded` Tailwind classes.
- **Graph chrome:** replace rounded-full pills and the five ad-hoc rgba glass fills with hairline chips + floatingPanel.glass tokens; derive the purple gradient from accent via color-mix; make the permanent "Hover to isolate" tutorial pill one-time-dismissible (ui-store flag); fix GhostPanel's #3e4550 counts (→ colors.text.muted) and graph-label-layer's hardcoded #e2e8f0 (read `--color-text-primary` once via getComputedStyle).
- **Cleanups:** delete --hue-*/ARTIFACT_HUES duplication and --neon-glow; remove Statusbar's fake "UTF-8 · LF" item and the idle 1s tick; point FileTree's agent color map at ARTIFACT_COLORS and origin-utils at SIGNAL_COLORS; rename `workbench-card-slide-in` to a `te-` keyframe in index.css.

### 2.10 Terminal webview: hook installer, theme, find (M)

**Files:** `src/renderer/terminal-webview/TerminalApp.tsx`, `src/renderer/src/panels/canvas/TerminalCard.tsx`, new IPC handler in `src/main/ipc/shell.ts` (+ channel/preload entries), `resources/shell-hooks/*`.

- **One-click shell-hook setup** (the documented palette action that never shipped — without it the block protocol is dead for every user): IPC handler copies the bundled hook to `~/.te.zsh` (etc.) and appends a guarded source line to the rc file; show a banner on the first terminal when a TE_SESSION_ID session produces no prompt-start within 5s ("Enable structured blocks").
- **Theme:** pass resolved accent/bg hexes as URL params from TerminalCard so cursor/selection match Ember coral instead of the hardcoded Catppuccin teal.
- **Find:** build a minimal find bar (input + findNext/findPrevious) for the shipped SearchAddon, or remove the addon and the Cmd+F swallow. Recommend the find bar — terminals are pillar 2.

### 2.11 Knowledge surface coherence (L)

**Files:** `src/renderer/src/panels/sidebar/{TagBrowser.tsx,WorkspaceFilter.tsx}`, `src/renderer/src/panels/agent-shell/dock-adapters/FilesDockAdapter.tsx`, `src/renderer/src/store/vault-store.ts`, `src/renderer/src/panels/editor/BacklinksPanel.tsx`, `src/renderer/src/panels/graph/{GraphPanel.tsx,graph-renderer.ts,GraphDetailDrawer.tsx}`, `src/renderer/src/panels/ghosts/GhostPanel.tsx`, `src/renderer/src/hooks/useGhostEmerge.ts`, `src/main/ipc/ghost-emerge.ts`, `src/renderer/src/store/ui-store.ts`, `src/renderer/src/panels/canvas/OntologyPreview.tsx`.

- **Tag filter works:** intersect FilesDockAdapter treeNodes with artifacts matching selectedTags under tagOperator (both store fields currently have zero consumers — the chips are pure no-ops).
- **Workspace filter works:** filter stableFiles by the active workspace's folder prefix before buildFileTree.
- **Backlinks are honest:** split getBacklinks into inbound vs outgoing; render "Linked mentions" and "Links from this note" sections.
- **Ghost→graph handoff:** GraphPanel effect subscribes selectedNodeId → `renderer.setSelectedNode(idx)` + new `centerOnNode` (pan/zoom via positionsRef). This is the core discovery handoff and currently does nothing visible.
- **Ghost emerge UX:** open the synthesized note via openArtifactInEditor on success; toast on failure and on the silent empty-body fallback; in-row spinner during the CLI call (isEmerging exists, unused). Set `artifact.origin = 'agent'` so synthesized notes carry agent provenance in the graph; delete the dead frontmatter origin plumbing.
- **Dismissal coherence:** filter dismissed ghosts from graph simNodes; add a "Dismissed (N)" section wired to the existing undismissGhost; row click opens the references popup (rows currently show pointer cursor and do nothing).
- **Open fast path:** double-click (or cmd+click) on a graph node opens the note directly; memoize buildGhostIndex in vault-store (computed once per worker result) instead of per-panel UI-thread rebuilds.
- **Honest strings:** rewrite the two "/connect-vault" instructions in GraphPanel to point at things that exist (tags/links or the agent), pending Wave 3.9's real enrichment action. Strip OntologyPreview's never-passed onRunAgent prop + dead 'loading' phase; delete graph-renderer pause/resume or call them from dock-tab visibility (delete unless trivially wired).

### 2.12 Editor UX wiring: built features become reachable (M)

**Files:** `src/renderer/src/panels/editor/{EditorPanel.tsx,EditorSplitView.tsx,OutlinePanel.tsx}`, `src/renderer/src/store/{ui-store.ts,editor-store.ts}`, `src/renderer/src/panels/agent-shell/keybindings.ts`, `src/renderer/src/panels/editor/extensions/{callout-block.ts,slash-command.tsx,slash-command-list.tsx}`.

- Outline toggle button in the editor mode bar + Cmd+Shift+O (the 161-line panel exists, flag defaults false, zero togglers).
- Back/forward: Cmd+Opt+Left/Right + small chrome wired to the existing goBack/goForward (the history stack is maintained but unreachable — wikilink rabbit-holing has no way back).
- Cmd+N creates a note (and opens it); rebind thread creation to Cmd+Shift+N; fix the empty-state text that currently lies about Cmd+N.
- Tab-bar new-file: counter-suffix on collision (pattern already in FilesDockAdapter) instead of silently opening the existing file; surface the affordance with 0-1 tabs.
- Callout round-trip: capture optional title and fold marker (`> \[!(\w+)\]([+-]?) ?(.*)`) as node attrs and re-emit; round-trip tests with real Obsidian samples (titled callouts are currently restructured on first save).
- Escape exits the slash-command suggestion properly; replace the static-property keyboard hack with a ref.

### 2.13 Distribution: sign, notarize, update (L)

**Files:** `electron-builder.yml`, `package.json`, `src/main/index.ts`.

Developer ID signing + notarization (notarize: true with APPLE_ID/TEAM_ID env credentials), add electron-updater against a real generic or GitHub provider, `autoUpdater.checkForUpdatesAndNotify()` in app.whenReady. Until creds exist, delete the placeholder `https://example.com/auto-updates` publish block so builds don't embed a dead URL.

### 2.14 Local-first fonts (M)

**Files:** `src/renderer/src/components/{GoogleFontLoader.tsx,FontPicker.tsx}`, `src/renderer/src/design/google-fonts.ts`, `src/renderer/index.html`, `src/main/index.ts` (CSP).

Bundle the default display/body/mono fonts as local woff2 (OFL-licensed) via @font-face; keep the Google Fonts path only for user-chosen non-defaults with explicit load-failure detection ("offline — preview unavailable" in FontPicker); tighten font-src/style-src CSP once defaults are local. A local-first app's typography should not silently break offline.

---

## Wave 3 — Vision

### 3.1 Full-text search for humans (M)

**Files:** `src/renderer/src/engine/vault-worker.ts`, `vault-worker-helpers.ts`, `src/renderer/src/panels/sidebar/SearchBar.tsx`, `src/renderer/src/panels/agent-shell/{palette-sources.ts,CommandPalette.tsx}`, `src/renderer/src/panels/agent-shell/dock-adapters/FilesDockAdapter.tsx`, `src/shared/engine/search-engine.ts`.

The MiniSearch engine (title x10/tags x5/body x1) serves only MCP agents; humans get filename substring matching. Host a SearchEngine instance inside vault-worker (it already holds every parsed body), add a search request/response worker message, surface body-snippet results in the command palette and sidebar SearchBar (filename filter remains for the tree). The single largest Obsidian-parity gap — do this first in Wave 3.

### 3.2 Wikilink autocomplete while typing (M)

**Files:** `src/renderer/src/panels/editor/extensions/wikilink-node.ts`, new suggestion extension alongside `slash-command.tsx`, reuse scoring from `ConnectionAutocomplete.tsx`.

Add a second @tiptap/suggestion plugin triggered by `[[` that queries vault-store artifacts with the existing autocomplete scoring and inserts via the existing (currently caller-less) `insertWikilink` command. Highest-leverage single feature for pillar 3.

### 3.3 Find-in-note for rich mode (M)

**Files:** `src/renderer/src/panels/editor/EditorPanel.tsx`, new find-bar component/extension.

Cmd+F find bar with match count and next/prev for the Tiptap editor (ProseMirror search plugin or a small decoration-based implementation). Source mode already has CodeMirror search; rich mode — the default — has nothing.

### 3.4 Images, embeds, and first-class PDFs (L)

**Files:** `src/renderer/src/panels/editor/EditorPanel.tsx` (+ new image extension), `src/renderer/src/panels/editor/extensions/wikilink-node.ts`, `src/renderer/src/panels/canvas/PdfCard.tsx`, `package.json` (@tiptap/extension-image), tests.

- Tiptap image node with markdown round-trip, resolving vault-relative paths through existing file IPC; round-trip test that `![alt](src)` survives edit-save.
- Parse `![[file]]` embeds (the tokenizer currently leaves a stray `!`).
- PdfCard: pdfjs text layer for selection/copy, continuous scroll within the card, and a "quote to note" action creating a linked text card — turning PDFs from page-flip thumbnails into graph citizens (pillar 5).

### 3.5 Onboarding journey to first insight (M)

**Files:** `src/renderer/src/components/OnboardingOverlay.tsx`, `src/renderer/src/components/SettingsModal.tsx`, `src/renderer/src/store/claude-status-store.ts`, `src/renderer/src/panels/canvas/{CanvasView.tsx,CanvasEmptyStates.tsx}`, `src/renderer/src/panels/agent-shell/{SurfaceDock.tsx,palette-sources.ts}`, `src/renderer/src/panels/sidebar/DailyNoteSection.tsx`, `src/renderer/src/panels/agent-shell/dock-adapters/FilesDockAdapter.tsx`, `src/main/ipc/thread-ipc.ts`.

- Overlay (live after 1.10) gets an API-key-first step (password input reusing SettingsModal save/clear) with CLI install as the alternative — the API key is the default agent path but never offered during onboarding.
- Wire `openOnboarding` into the command palette and Settings ("Run setup") so the walkthrough is re-launchable.
- Empty-vault canvas state (vaultPath set, zero artifacts): create-note / drag-files / ⌘G import CTAs; dismissible shortcut overlay on `?`; new threads auto-open the canvas dock tab; rewrite the dock empty state to name the ribbon.
- Daily notes: pass `onOpenDailyNote` from FilesDockAdapter (create/open `<dailyNoteFolder>/<date>.md`) — or delete the 318-line calendar and its settings knob. Recommend wiring: a daily ritual is core to replacing Obsidian.

### 3.6 Unlinked mentions (M)

**Files:** `src/renderer/src/panels/editor/BacklinksPanel.tsx`, `src/renderer/src/store/vault-store.ts`.

Scan artifact bodies (already in vault-store) for the current note's title/id; render an "Unlinked mentions" section with one-click linkification wrapping the mention in `[[...]]` via document IPC. Obsidian's primary connection-emergence loop, absent entirely.

### 3.7 Canvas spatial parity (L)

**Files:** `src/renderer/src/panels/canvas/{use-canvas-keyboard-shortcuts.ts,use-canvas-drag.ts,CardLodPreview.tsx}`, `src/renderer/src/store/canvas-store.ts`.

⌘D duplicate (offset clone of selection), ⌘A select-all, ⌘C/⌘V copy/paste, arrow-key nudge (1px / Shift 24px), drag-time alignment guides against neighboring card edges/centers, and `useNodeDrag` on CardLodPreview so coarse rearrangement works below 0.3 zoom. All routed through the CommandStack built in 1.4. The four interactions Figma/tldraw users reach for first.

### 3.8 Real multi-canvas (L)

**Files:** `src/renderer/src/store/canvas-store.ts` (factory refactor), `src/renderer/src/panels/canvas/use-canvas-file-lifecycle.ts`, `src/renderer/src/store/{thread-store.ts,canvas-autosave.ts}`, `src/renderer/src/panels/agent-shell/palette-sources.ts`.

Factory-created Zustand store instances keyed by canvasId with per-filePath load/save lifecycle, then restore the palette entries hidden in 1.11. Design the autosave/quit-flush story per instance (extends 2.5's single-autosaver model).

### 3.9 In-app vault enrichment (replaces /connect-vault) (M)

**Files:** `src/renderer/src/panels/graph/GraphPanel.tsx`, native-agent action plumbing (`src/main/services/machina-native-agent.ts` or CLI thread lane), optionally resurrect `connect-manifest.ts` from git history for incremental runs.

A first-class "Enrich vault" button on the graph enrichment pill that runs an agent pass over unconnected files (add tags/links/frontmatter connections), replacing the dead-end instruction to run a command that ships nowhere. Decide native-agent vs CLI-thread lane based on 2.1/2.2 outcomes.

### 3.10a PDF text extraction + lexical search (M) — extends 3.4

**Files:** new `src/shared/engine/pdf-extractor.ts` (pure; pdfjs types only at the boundary), `src/shared/engine/search-engine.ts`, `src/renderer/src/engine/vault-worker.ts`, `src/renderer/src/panels/canvas/PdfCard.tsx`, `src/shared/canvas-types.ts`, IPC channel `vault:index-pdf-content`, tests.

Backfilled audit (the pdf-embedding auditor died mid-run; re-run 2026-06-09): PdfCard renders pages via pdfjs 5.5 but never calls `getTextContent`; PDF text is invisible to search and the graph. Phase 1, decoupled from embeddings: extract per-page text on PDF load (worker, non-blocking), upsert into the existing MiniSearch index with a `pdfPath` tag and page-number hints in hits, and feed 3.4's quote-to-note action (quote + `[[pdf]]` link + page). No new deps — pdfjs is already in the tree. Test: 3-page fixture PDF, search finds a page-2 phrase with page hint.

### 3.11 Local embeddings + semantic search (L)

**Files:** new `src/shared/engine/embeddings.ts` (interface only; pure), main-process embedder service, `src/shared/engine/search-engine.ts` (semanticSearch + merge), `.machina/embeddings/` storage, `settings-store.ts` + `SettingsModal.tsx` (opt-in toggle), search UI merge points from 3.1, `package.json` (@huggingface/transformers), tests.

Zero embedding machinery exists today (verified: no ML deps, no vector storage anywhere). Recommended: transformers.js ONNX sentence-transformer running in the main process, lazy model download on first enable, vectors as flat `.f32` files + manifest under `.machina/embeddings/` (atomic writes per 2.6; corrupt store falls back to lexical-only). Incremental: re-embed only changed docs (hash in indexing-state), debounced ~1s. Query path: embed query → cosine top-K → merge with MiniSearch results in the palette/SearchBar. Covers markdown and PDF text (via 3.10a) with no distinction at the engine layer. Local Ollama-over-Tailscale was considered and rejected: adds a network dependency to a local-first app. Strictly opt-in — the toggle names the one-time model download size.

### 3.12 Agent presence on terminals (S)

**Files:** `src/renderer/src/panels/canvas/TerminalCard.tsx`, `src/renderer/src/panels/agent-shell/SurfaceDock.tsx`, new small hook consuming `on.cliAgentSessionStatus` / `on.cliAgentContextUpdated`.

If 2.2 chose to keep CliAgentSessionListener: render agent badges (claude/codex/gemini active) on terminal cards and dock pills from the session-status events, which become functional once 1.7 populates Block.command. Skip if 2.2 deleted the listener.

> Numbering note: 3.10a/3.11 were added 2026-06-09 from the backfilled PDF/embedding audit; the original 3.10 (agent presence) is now 3.12. References elsewhere in this doc to "3.10" mean agent presence.

---

## Deferred / rejected findings

| Finding | Disposition |
|---|---|
| cli-gemini thread identity removal | Deferred — keep registry entry, don't grow its surface (2.2); cut only if unused after CLI convergence ships. |
| Duplicate-id suffixing load-order instability | Deferred — changing id assignment breaks persisted edges/cards; revisit alongside 3.8 multi-canvas with a migration. |
| Icon standardization (lucide `<Icon>` wrapper, 29 hand-rolled SVG sets) | Deferred — high churn, low user-visible value relative to Wave 2 design items; queue behind 2.8/2.9. |
| E2E expansion (type→disk, conflict UI, quit-flush Playwright scenarios) | Deferred to verification protocol — repo policy: no disruptive E2E without asking; unit/integration tests specified per item instead. |
| External crash telemetry / remote error reporting | Rejected — local-first product; local minidumps + log forwarding (2.6) suffice for bug reports. |
| Block protocol "legacy mode" 5s timer as documented | Rejected as spec'd — docs resynced in 1.7; the useful half (no-prompt-start nudge) ships as the hook-installer banner in 2.10. |
| `agentContext` rendering on pinned blocks | Resolved by deletion in 1.7 (drop the field) unless an agent flow consumes it. |
| `vault.write_file` MCP behavior changes beyond index updates | Out of scope — safety subsystem behavior preserved; only index freshness (2.3) changes. |
| Pixi migration for canvas / continuous PDF outside cards | Rejected — CSS-transform canvas is sound; PDF work scoped to in-card (3.4). |
| Keeping `connect-manifest.ts`/`graph-summary.ts` "just in case" | Rejected — deleted in 1.9; git history preserves them, 3.9 may resurrect connect-manifest deliberately. |

## Verification protocol

Every wave item lands with evidence, per repo standards:

1. **Quality gate per item:** `npm run check` (lint + typecheck + test) must pass clean before merge. For Wave 1 parallel agents: each agent runs `npm run typecheck` continuously (the typed IPC map turns deletion mistakes into compile errors).
2. **Targeted tests (new, per item):**
   - 1.1: conflict-resolve-disk preserves disk content; rename re-keys open doc; out-of-vault trash path throws; source↔rich mode-switch round-trip.
   - 1.2: YAML round-trip with nested maps, block scalars, comments.
   - 1.3: parser→graph→ghost end-to-end: title-based frontmatter connection resolves to real note; `[[Richard Hamming]]` produces a ghost; fenced `[[fake]]` produces nothing.
   - 1.4: undo/redo for remove/move/resize/edge/convert/clear; convert preserves content.
   - 1.5: corrupt canvas.json → .bak created, error surfaced, no silent empty save.
   - 1.7: block:update → store integration test; replayed hook fixture populates command; fish ts numeric; output cap + throttle unit tests.
   - 1.8: dead-session input respawns; empty-body messages filtered from history; runId mismatch dropped.
   - 1.10: notifyError reaches registered notifier; missing vault path → first-run, no mkdir.
3. **Manual screenshot points** (dev app via `npm run dev`, screenshots attached to PR):
   - First run with no vault (FirstRunScreen), with vault + empty canvas, onboarding overlay with API-key step (Wave 3.5).
   - Canvas: Clear confirm state, undo after delete/move, visible-by-default user edges (2.5).
   - Terminal: pinned block card after app restart (command + output present), busy/idle status dots, agent badge (3.10).
   - Editor: conflict banner both resolutions, external agent edit appearing in open note, wikilink autocomplete popup (3.2).
   - Toast on forced canvas-save failure; graph centerOnNode from ghost panel.
   - Design: settings Density/Corners toggles producing visible change (or controls removed), one screenshot per converged context menu.
4. **Live smoke:** `npm run test:live` (CDP health checks) after Waves 1 and 2 integration merges.
5. **E2E (opt-in, ask first):** the three data-loss Playwright scenarios (type→disk persistence, external-change conflict UI, quit flush) from the production audit — run before any distribution milestone (2.13).
6. **Adversarial review:** per repo policy, each L-effort item gets a fresh-subagent review against this plan plus a Codex cold read before merge.

## Dependency notes

- 1.9 (deletion sweep) should merge **first or early** within Wave 1 — other items' typechecks then run against the slimmed surface; remaining Wave 1 items are mutually disjoint and parallel-safe.
- 1.7 (Block.command) unblocks 2.2's session-listener decision and 3.10.
- 1.10 (status pipeline) unblocks 3.5 (onboarding overlay content).
- 1.4 (CommandStack coverage) is the substrate for 3.7 (spatial parity).
- 2.5 (single autosaver) precedes 3.8 (multi-canvas).
