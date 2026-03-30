# Terminal Webview Isolation: Implementation Plan

**Spec**: `docs/forge/specs/2026-03-29-terminal-webview-design.md`
**Total tasks**: 10
**Max parallelism**: 6 tasks in first wave
**TDD discipline**: prove-first for all testable modules (Tasks 2, 3, 6)

## Dependency Graph

```
Wave 1 (parallel):
  Task 1  typedHandleWithEvent ──────────────────────┐
  Task 2  SessionRouter + tests ─────────────────────┼─── Task 7  shell.ts routing ──┐
  Task 3  Webview preload + tests ───┐               │                               │
  Task 4  Webview HTML + React mount ┼─── Task 6  TerminalApp ──────────────────────┼─── Task 9  TerminalCard rewrite
  Task 5  electron.vite.config ──────┘               │                               │         │
  Task 8  webviewTag: true ──────────────────────────┘                               │    Task 10  Quality gate
                                                                                     │
```

## Tasks

### Task 1: Add `typedHandleWithEvent` to typed-ipc.ts

**Description**: Add a new function to `src/main/typed-ipc.ts` that passes `IpcMainInvokeEvent` as a second argument to the handler. This enables `terminal:create` and `terminal:reconnect` handlers to access `event.sender.id` for SessionRouter registration. Existing `typedHandle` and `typedSend` unchanged.

```typescript
import { IpcMainInvokeEvent } from 'electron'

export function typedHandleWithEvent<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>, event: IpcMainInvokeEvent) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(channel, (event, args) => handler(args, event))
}
```

**Files**: `src/main/typed-ipc.ts` (modify)
**Depends on**: none
**Verification**: `npx tsc --noEmit -p tsconfig.node.json`

---

### Task 2: Create SessionRouter service (test first)

**Description**: Write failing tests, then implement the session-to-webContents routing registry.

**Test file**: `src/main/services/__tests__/session-router.test.ts`
- Use `// @vitest-environment node` at top
- Mock `electron` module: `webContents.fromId` returns mock objects with `{ id, send: vi.fn(), isDestroyed: vi.fn() }`
- Test cases:
  - `register` then `getWebContents` returns the correct webContents
  - `unregister` then `getWebContents` returns null
  - `getWebContents` for unknown sessionId returns null
  - `getWebContents` returns null when webContents `isDestroyed()` returns true (auto-cleans entry)
  - `clear` removes all entries

**Implementation**: `src/main/services/session-router.ts` (~50 lines)
- `sessionOwners = new Map<string, number>()` (sessionId -> webContentsId)
- `register(sessionId, webContentsId)`, `unregister(sessionId)`, `getWebContents(sessionId)`, `clear()`
- `getWebContents` uses `webContents.fromId()`, guards with `isDestroyed()`, auto-cleans if destroyed

**Files**:
- `src/main/services/__tests__/session-router.test.ts` (create)
- `src/main/services/session-router.ts` (create)

**Depends on**: none
**Verification**: `npx vitest run src/main/services/__tests__/session-router.test.ts`

---

### Task 3: Create terminal webview preload (test first)

**Description**: Write failing tests, then implement the stripped-down preload for terminal webviews. Includes focus/blur channel listeners and preload path exposure.

**Test file**: `src/preload/__tests__/terminal-webview.test.ts`
- Use `// @vitest-environment node`
- Mock `electron`: `ipcRenderer` with `invoke`, `on`, `removeListener`; `contextBridge` with `exposeInMainWorld`
- Test cases:
  - Listener-set: `onData(cb1)` + `onData(cb2)` both receive dispatched events
  - `offData(cb1)` removes only cb1; cb2 still receives
  - `onExit`/`offExit` same pattern
  - Only one `ipcRenderer.on` per channel at load time (no duplicates)
  - `sendToHost` delegates to `ipcRenderer.sendToHost`
  - `onFocus`/`onBlur` register listeners for `focus`/`blur` channels

**Implementation**: `src/preload/terminal-webview.ts` (~80 lines)
- `contextBridge.exposeInMainWorld('terminalApi', { ... })` with:
  - `create`, `write`, `resize`, `kill`, `reconnect` (all `ipcRenderer.invoke`, matching existing `IpcChannels` signatures exactly)
  - `onData`, `offData`, `onExit`, `offExit` (listener-set pattern)
  - `onFocus(cb)`, `onBlur(cb)` (direct `ipcRenderer.on` for host-to-guest focus protocol)
  - `sendToHost(channel, ...args)` (`ipcRenderer.sendToHost`)

**Also**: Add `getTerminalPreloadPath` to main preload (`src/preload/index.ts`):
```typescript
getTerminalPreloadPath: () => join(__dirname, 'terminal-webview.js'),
```
This gives the renderer the absolute file path for the `<webview preload="...">` attribute. Import `join` from `path`.

**Files**:
- `src/preload/__tests__/terminal-webview.test.ts` (create)
- `src/preload/terminal-webview.ts` (create)
- `src/preload/index.ts` (modify: add `getTerminalPreloadPath`)

**Depends on**: none
**Verification**: `npx vitest run src/preload/__tests__/terminal-webview.test.ts`

---

### Task 4: Create webview HTML entry and React mount

**Description**: Create the minimal webview shell files.

**`src/webview/terminal/index.html`** (~15 lines):
- HTML5 with `<meta charset="UTF-8">`
- Inline style: `html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1e2e; overflow: hidden; }`
- `<div id="root">` + `<script type="module" src="./main.tsx">`

**`src/webview/terminal/main.tsx`** (~10 lines):
- React 18 `createRoot`, renders `<TerminalApp>`
- Import from `./TerminalApp` (created in Task 6; this file won't build until then)

**Files**:
- `src/webview/terminal/index.html` (create)
- `src/webview/terminal/main.tsx` (create)

**Depends on**: none
**Verification**: Files exist and are syntactically valid HTML/TSX.

---

### Task 5: Add webview build entries to electron.vite.config.ts

**Description**: Add terminal-webview as new entry points for both preload and renderer builds.

**Preload section**: Add `rollupOptions.input` with both `index` and `terminal-webview` entries.

**Renderer section**: Add `rollupOptions.input` with both `index` and `terminal-webview` entries.

Read the current config carefully before editing. The preload section may not have explicit `rollupOptions.input` yet (uses default single entry). The renderer section similarly.

**Files**: `electron.vite.config.ts` (modify)
**Depends on**: none
**Verification**: `npx tsc --noEmit -p tsconfig.node.json`

---

### Task 6: Create TerminalApp webview guest component

**Description**: The core xterm.js session lifecycle controller that runs inside each terminal webview. This is the largest new file (~300 lines).

**`src/webview/terminal/TerminalApp.tsx`**:

Session lifecycle (from URL params via `URLSearchParams`):
- If `sessionId` present: call `window.terminalApi.reconnect({ sessionId, cols, rows })`. If result is null (session gone), fall through to create.
- If no sessionId (or reconnect failed): call `window.terminalApi.create({ cwd })`, then `window.terminalApi.sendToHost('session-created', sessionId)`.
- If `initialCommand` present: write to PTY after connect (500ms delay for Claude). If `systemPrompt` URL param exists, construct `claude --append-system-prompt $'<escaped>'`.

xterm.js setup:
- Terminal with Catppuccin Mocha theme (hardcoded, same values as current TerminalCard)
- Font: same family/size as current (size 13, no zoom-based sizing)
- WebGL addon with canvas fallback (try/catch pattern)
- FitAddon, WebLinksAddon, SearchAddon (Cmd+F via `attachCustomKeyEventHandler`)
- 5ms data coalescing buffer (identical pattern to current TerminalCard lines 280-317)
- ResizeObserver -> rAF -> fit() -> resize IPC (guard: no resize IPC until sessionId established)
- Scrollback: 10000

Focus protocol (guest side):
- `window.terminalApi.onFocus(() => term.focus())`
- `window.terminalApi.onBlur(() => term.blur())`

**Type declaration**: `src/webview/terminal/terminal-api.d.ts` declaring `window.terminalApi` on the global Window interface.

Cleanup on unmount: dispose terminal, WebGL addon, clear buffer, unregister listeners.

**Files**:
- `src/webview/terminal/TerminalApp.tsx` (create)
- `src/webview/terminal/terminal-api.d.ts` (create)

**Depends on**: Task 3 (preload API shape), Task 4 (mount point)
**Verification**: `npx tsc --noEmit -p tsconfig.web.json` (or renderer tsconfig)

---

### Task 7: Modify shell.ts IPC to use SessionRouter

**Description**: Replace `typedSend(mainWindow, ...)` broadcasts with SessionRouter-targeted delivery. Also update the call site in `src/main/index.ts`.

Changes to `src/main/ipc/shell.ts`:
1. Import `sessionRouter` from `../services/session-router` and `typedHandleWithEvent` from `../typed-ipc`
2. Replace data/exit callbacks:
   ```typescript
   shellService.setCallbacks(
     (sessionId, data) => {
       const wc = sessionRouter.getWebContents(sessionId)
       if (wc) wc.send('terminal:data', { sessionId, data })
     },
     (sessionId, code) => {
       const wc = sessionRouter.getWebContents(sessionId)
       if (wc) wc.send('terminal:exit', { sessionId, code })
       sessionRouter.unregister(sessionId)  // AFTER sending exit
     },
   )
   ```
3. Change `terminal:create` to `typedHandleWithEvent`, register `event.sender.id`
4. Change `terminal:reconnect` to `typedHandleWithEvent`, register on success
5. Remove `mainWindow: BrowserWindow` parameter from `registerShellIpc`
6. All other handlers unchanged

Changes to `src/main/index.ts`:
- Update `registerShellIpc(mainWindow)` call to `registerShellIpc()` (no arg)

**Files**:
- `src/main/ipc/shell.ts` (modify)
- `src/main/index.ts` (modify)

**Depends on**: Task 1 (typedHandleWithEvent), Task 2 (SessionRouter)
**Verification**: `npx tsc --noEmit -p tsconfig.node.json`

---

### Task 8: Enable webviewTag in BrowserWindow

**Description**: Add `webviewTag: true` to `webPreferences` in `src/main/index.ts` `createWindow()` function (line ~76-80). Without this, Electron silently ignores `<webview>` elements.

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  nodeIntegrationInWorker: true,
  webviewTag: true
}
```

**Files**: `src/main/index.ts` (modify)
**Depends on**: none
**Verification**: `grep -n 'webviewTag' src/main/index.ts` shows the line

---

### Task 9: Rewrite TerminalCard.tsx as webview host

**Description**: Major rewrite from 501 lines to ~200 lines. Becomes a thin webview host.

**Remove**:
- All `@xterm/xterm` imports (Terminal, FitAddon, WebLinksAddon, WebglAddon, xterm.css)
- `termContainerRef`, `termRef`, `fitRef`, `webglRef` refs
- Counter-scale wrapper div
- All terminal data/exit/resize useEffects
- `connectSession` function
- `BASE_FONT_SIZE`, font-size zoom sync

**Keep**:
- `CardShell` wrapper, title display logic (`displayTitle` memo)
- `useClaudeContext` hook
- `sessionIdRef`, `sessionDead` state
- `handleClose` (kill session + remove node)

**Add**:
- `webviewRef = useRef<Electron.WebviewTag>(null)`
- `webviewSrc` memo: construct URL with params (`sessionId`, `cwd`, `initialCommand`, `systemPrompt`). For Claude cards, call `buildCanvasContext` from host-side canvas store and URL-encode the result.
- Render `<webview src={webviewSrc} preload={preloadPath}>` with `style={{ width: '100%', height: '100%' }}`
- Preload path: `'file://' + window.api.getTerminalPreloadPath()`
- `useEffect` for webview event listeners: `ipc-message` (session-created), `crashed`, `did-fail-load`
- Focus protocol: locked -> `webview.send('focus')`, blur -> `webview.send('blur')`
- `handleRestart`: kill session, force remount via key state
- Boolean ref guard for close/restart
- Crash overlay: "Terminal crashed, click to restart"

**Pointer-events validation**: The `<webview>` element may not respect the CardShell pointer-events overlay. Apply `style={{ pointerEvents: isLocked ? 'auto' : 'none' }}` to the webview element directly as a defensive measure. This ensures the focus/lock gating works regardless of how Electron routes input to webview elements.

**Dev vs prod webview URL**: In dev, electron-vite serves renderers via `process.env.ELECTRON_RENDERER_URL`. The webview `src` needs the dev server URL in dev mode and a `file://` path in prod. Check how the main renderer URL is constructed in `src/main/index.ts` and follow the same pattern.

**Files**: `src/renderer/src/panels/canvas/TerminalCard.tsx` (modify)
**Depends on**: Task 6 (TerminalApp), Task 7 (shell.ts routing), Task 3 (preload path)
**Verification**: `npx tsc --noEmit -p tsconfig.web.json`

---

### Task 10: Full build and quality gate

**Description**: Run the complete quality gate to verify all pieces integrate.

```bash
npm run typecheck    # both configs clean
npm run lint         # zero errors
npm test             # all existing + new tests pass
npm run build        # verify both entry points bundle
```

Verify build output contains both entry points:
- `out/preload/terminal-webview.js` exists
- Terminal webview renderer entry exists in build output

Fix any errors found.

**Files**: Various (fix-only)
**Depends on**: All previous tasks
**Verification**: `npm run check` exits 0 AND `npm run build` exits 0

---

## Parallel Execution Strategy

**Wave 1** (6 tasks, all independent):
- Task 1: typedHandleWithEvent
- Task 2: SessionRouter + tests
- Task 3: Webview preload + tests
- Task 4: Webview HTML + React mount
- Task 5: electron.vite.config
- Task 8: webviewTag

**Wave 2** (2 tasks):
- Task 6: TerminalApp (needs 3, 4)
- Task 7: shell.ts routing (needs 1, 2)

**Wave 3** (1 task):
- Task 9: TerminalCard rewrite (needs 6, 7, 3)

**Wave 4** (1 task):
- Task 10: Quality gate (needs all)

## Spec Coverage

| Spec Requirement | Task |
|---|---|
| `typedHandleWithEvent` variant | 1 |
| SessionRouter (register/unregister/route/isDestroyed) | 2 |
| Terminal webview preload (listener-set, minimal surface) | 3 |
| Focus/blur protocol in preload | 3 |
| Preload path exposure for webview element | 3 |
| Webview HTML entry (dark background) | 4 |
| React 18 mount for webview | 4 |
| Build config for both entry points | 5 |
| TerminalApp session lifecycle (create/reconnect) | 6 |
| SearchAddon with Cmd+F | 6 |
| 5ms data coalescing buffer | 6 |
| ResizeObserver + rAF fit | 6 |
| Hardcoded Catppuccin Mocha theme | 6 |
| WebGL with canvas fallback | 6 |
| Resize buffering before session exists | 6 |
| Shell.ts routing via SessionRouter | 7 |
| Remove `mainWindow` from `registerShellIpc` | 7 |
| `webviewTag: true` in BrowserWindow | 8 |
| TerminalCard rewrite (thin host, ~200 lines) | 9 |
| Remove counter-scale wrapper | 9 |
| Claude context via systemPrompt URL param | 9 |
| Webview crash/restart handling | 9 |
| Close/restart guard | 9 |
| Pointer-events validation | 9 |
| `npm run check` clean | 10 |
| Build produces both entry points | 10 |
