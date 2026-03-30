# Terminal Webview Isolation: Design Spec

## Problem

Terminal cards on the canvas exhibit display corruption when zooming because xterm.js lives inside the CSS `transform: scale(zoom)` hierarchy. The counter-scale wrapper creates a 150ms+ desync between font metrics and container dimensions during zoom changes, causing rendering artifacts, broken scrolling, and line-wrapping corruption, all amplified by high-throughput terminal output (Claude Code running).

Seven root causes were identified (session 2026-03-29). All stem from one architectural flaw: xterm.js does not belong inside a CSS transform hierarchy.

## Approach

Migrate canvas terminal cards from shared-DOM React components to isolated Electron `<webview>` elements. Each terminal gets its own renderer process where xterm.js renders at native resolution, completely unaware of canvas zoom. The canvas positions the webview container inside the existing transform layer (Option A); the browser compositor handles visual scaling, just like scaling an image. No counter-scale needed.

Reference implementation: Collaborator (`src/windows/terminal-tile/`). Proven in production, same Electron + xterm.js + tmux stack.

## Scope

**In scope:** Canvas terminal cards only. 5 new files, 6 modified files.

**Out of scope:**
- Panel terminal (`src/renderer/src/panels/terminal/`) -- unchanged
- Theme sync to webview -- no theme propagation
- All backend services (ShellService, TmuxService, tmux-paths, context-serializer)
- Canvas persistence format
- Option B positioning (screen coordinates outside transform layer)

## Architecture

```
BEFORE:
  Main Process                    Renderer (single BrowserWindow)
  +--------------+               +------------------------------+
  | ShellService |<----IPC------>| TerminalCard                 |
  | (node-pty)   |  terminal:*  |  +-- xterm.js (in CSS scale)  |
  +--------------+               +------------------------------+

AFTER:
  Main Process                    Renderer              Webview (per terminal)
  +--------------+               +--------------+      +-------------------+
  | ShellService |<----IPC------>| TerminalCard  |      | TerminalApp       |
  | (node-pty)   |  terminal:*  |  +-- <webview> |<--->|  +-- xterm.js      |
  |              |  (routed to  +--------------+      |  (native res)     |
  | SessionRouter|   webContents)                     +-------------------+
  +--------------+
```

`terminal:data` and `terminal:exit` events currently broadcast to `mainWindow`. After migration, the SessionRouter maps each sessionId to the specific webContents that owns it, routing events directly to the correct webview process.

Existing `IpcChannels` and `IpcEvents` types are unchanged. The webview preload exposes the same operations through `contextBridge` with a different API surface name (`window.terminalApi` instead of `window.api.terminal`).

## What's Preserved (Unchanged)

| File | Lines | Why it's good |
|------|-------|---------------|
| `ShellService` | 171 | Dual-path facade (tmux/ephemeral), clean API |
| `TmuxService` | 345 | Tmux session lifecycle, reconnect, discover, metadata persistence |
| `tmux-paths.ts` | 119 | Isolated socket, session naming, metadata storage |
| `shell.ts` IPC handler | 70 | SessionId validation, typed handlers (routing change only) |
| `ipc-channels.ts` | 173 | Fully typed terminal channels |
| Canvas node format | -- | `{ type: 'terminal', content: sessionId, metadata: { initialCwd, initialCommand } }` persists identically |
| `context-serializer.ts` | -- | Pure logic, called from host TerminalCard (not webview guest, see note below) |

## New Files (5)

### 1. `src/webview/terminal/index.html` (~15 lines)

Minimal webview entry shell. Dark background (`#1e1e2e`) to prevent white flash on load. Loads `main.tsx`.

### 2. `src/webview/terminal/main.tsx` (~10 lines)

React 18 `createRoot`, renders `<TerminalApp>`.

### 3. `src/webview/terminal/TerminalApp.tsx` (~300 lines)

Session lifecycle controller. Reads identity from URL params.

**Session creation flow:**

```
URL params: ?sessionId=X&cwd=Y&initialCommand=Z&systemPrompt=...

sessionId present  -->  reconnect(sessionId, cols, rows) to recover scrollback
no sessionId       -->  create({ cwd }), sendToHost('session-created', id)
initialCommand     -->  write to PTY after session connects (500ms delay for Claude)
systemPrompt       -->  URL-encoded system prompt string, passed by host
```

Note: The `restored` flag from the original spec is unnecessary. If `sessionId` is present, the webview always attempts reconnect. If the tmux session is gone, reconnect returns null and the webview falls back to create. This simplifies to two branches, not three.

**xterm.js setup:**
- Terminal with WebGL addon (canvas fallback on failure)
- FitAddon for container-responsive sizing
- WebLinksAddon for clickable URLs
- SearchAddon with Cmd+F binding (new capability)
- 5ms data coalescing buffer (identical to current pattern)
- ResizeObserver -> rAF -> fit() -> ptyResize (no debounce timer, rAF is sufficient)
- Hardcoded dark theme (same Catppuccin Mocha values as current TerminalCard). No dynamic theme switching.

**Focus protocol (guest side):**
- Host sends `focus` message -> `term.focus()`
- Host sends `blur` message -> `term.blur()`

**Claude context injection:** `context-serializer.ts` requires access to the canvas store (`CanvasNode[]`), which lives in the host renderer process. The webview has no access to Zustand stores. Therefore, `buildCanvasContext` is called in the host TerminalCard, and the resulting system prompt string is passed to the webview via the `systemPrompt` URL param (URL-encoded). The webview guest uses this string directly when constructing the initial command, without needing to import context-serializer or access the canvas store.

**What moves here from TerminalCard:**
- All xterm.js instantiation and lifecycle
- Data coalescing buffer
- WebGL with fallback
- ResizeObserver + fitAddon
- Session reconnect with scrollback replay

**What's new:**
- SearchAddon (Cmd+F)
- `sendToHost` for session-created notification
- No counter-scale, no zoom awareness

### 4. `src/preload/terminal-webview.ts` (~80 lines)

Stripped-down preload for terminal webviews. Uses the listener-set pattern: one `ipcRenderer.on` registered at load time, dispatches to a `Set<callback>`. Prevents listener leaks.

```typescript
contextBridge.exposeInMainWorld('terminalApi', {
  // Request/response — matches existing IpcChannels signatures exactly
  create:    (args: { cwd: string, shell?: string, label?: string, vaultPath?: string })
                -> ipcRenderer.invoke('terminal:create', args)
  write:     (args: { sessionId: string, data: string })
                -> ipcRenderer.invoke('terminal:write', args)
  resize:    (args: { sessionId: string, cols: number, rows: number })
                -> ipcRenderer.invoke('terminal:resize', args)
  kill:      (args: { sessionId: string })
                -> ipcRenderer.invoke('terminal:kill', args)
  reconnect: (args: { sessionId: string, cols: number, rows: number })
                -> ipcRenderer.invoke('terminal:reconnect', args)

  // Event listeners (listener-set pattern)
  onData:  (cb) -> add to dataListeners set
  offData: (cb) -> remove from dataListeners set
  onExit:  (cb) -> add to exitListeners set
  offExit: (cb) -> remove from exitListeners set

  // Webview -> host communication
  sendToHost: (channel, ...args) -> ipcRenderer.sendToHost(channel, ...args)
})
```

The preload API passes the same argument shapes as the existing `IpcChannels` contract. No IPC channel changes required.

**Excluded** (compared to main preload): No `fs`, `vault`, `config`, `document`, `window`, `workbench`, `agent` namespaces. No `terminal:discover`, `terminal:tmux-available`, `terminal:process-name` (panel terminal concerns). Minimal attack surface.

### 5. `src/main/services/session-router.ts` (~50 lines)

Session-to-webContents routing registry.

```typescript
const sessionOwners = new Map<string, number>()  // sessionId -> webContentsId

register(sessionId, webContentsId)         // on terminal:create and terminal:reconnect
unregister(sessionId)                      // on terminal:kill and terminal:exit
getWebContents(sessionId) -> WebContents | null  // lookup + isDestroyed() guard
```

Both canvas webview terminals and panel terminals register through the same mechanism. Panel terminal calls come from the main BrowserWindow's webContents; canvas terminals come from their individual webview webContents. The router handles both transparently.

## Modified Files (6)

### 1. `src/renderer/src/panels/canvas/TerminalCard.tsx` (501 -> ~200 lines)

Major rewrite: becomes a thin webview host.

**Responsibilities:**
- Create `<webview src="terminal-webview.html?..." preload="...">` element
- Listen for `ipc-message` from webview: `session-created` (store sessionId in node content), `focus-request` (engage card lock)
- Forward focus/blur to webview via `webview.send()`
- Handle close (kill session + remove node) and restart (kill + new webview)
- Render inside `CardShell` (title bar, resize handles stay in host DOM)
- Title: `~`-abbreviated `initialCwd`, "Claude Live" for Claude cards, "Terminal" fallback (from node metadata, not webview)

**Removed:**
- All `@xterm/xterm` imports and lifecycle
- Counter-scale wrapper (`scale(1/zoom)`, `width: zoom*100%`)
- FitAddon, WebglAddon, WebLinksAddon
- ResizeObserver + fit debounce
- 5ms data coalescing buffer (moved to webview guest)
- `useEffect` for `terminalData`/`terminalExit` listeners (moved to webview guest)
- Font-size zoom tracking

### 2. `src/renderer/src/panels/canvas/CardShell.tsx` (minor, validate assumption)

The existing pointer-events overlay (`absolute inset-0 z-[1]`) should sit on top of the `<webview>` element in the host DOM. **Assumption to validate during implementation:** Electron `<webview>` elements have their own renderer process and input routing. If the DOM overlay does not reliably intercept pointer events over a `<webview>`, CardShell will need a webview-specific gating mechanism (e.g., toggling `pointer-events: none` on the webview element itself when unfocused). Validate this early in implementation.

### 3. `src/main/ipc/shell.ts`

Replace `typedSend(mainWindow, ...)` broadcasts with SessionRouter-targeted delivery:

```typescript
// Before
shellService.setCallbacks(
  (sessionId, data) => typedSend(mainWindow, 'terminal:data', { sessionId, data }),
  (sessionId, code) => typedSend(mainWindow, 'terminal:exit', { sessionId, code }),
)

// After
shellService.setCallbacks(
  (sessionId, data) => {
    const wc = sessionRouter.getWebContents(sessionId)
    if (wc) wc.send('terminal:data', { sessionId, data })
  },
  (sessionId, code) => {
    const wc = sessionRouter.getWebContents(sessionId)
    if (wc) wc.send('terminal:exit', { sessionId, code })
    sessionRouter.unregister(sessionId)  // unregister AFTER sending the exit event
  },
)
```

**`typedHandle` does not expose `event.sender`**: The current `typedHandle` abstraction at `src/main/typed-ipc.ts` discards the IPC event: `ipcMain.handle(channel, (_event, args) => handler(args))`. SessionRouter registration needs `event.sender.id` to know which webContents owns the session.

**Solution:** Add a `typedHandleWithEvent` variant that passes the `IpcMainInvokeEvent` as a second argument to the handler. Only `terminal:create` and `terminal:reconnect` use this variant. All other handlers continue using `typedHandle` unchanged.

```typescript
// New in typed-ipc.ts
export function typedHandleWithEvent<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>, event: IpcMainInvokeEvent) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(channel, (event, args) => handler(args, event))
}
```

### 4. `src/main/typed-ipc.ts`

Add the `typedHandleWithEvent` function described above. ~5 lines. Existing `typedHandle` and `typedSend` unchanged.

### 5. `src/preload/index.ts` (no change)

The terminal namespace stays for the panel terminal. No modification needed.

### 6. `src/main/index.ts` (minor)

Enable the `<webview>` tag in the BrowserWindow's webPreferences:

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  nodeIntegrationInWorker: true,
  webviewTag: true  // Required for <webview> elements in the renderer
}
```

Without this flag, Electron silently ignores `<webview>` elements and they will not render.

### 7. `electron.vite.config.ts`

Add terminal-webview as new entry points:

```typescript
preload: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/preload/index.ts'),
        'terminal-webview': resolve(__dirname, 'src/preload/terminal-webview.ts'),
      }
    }
  }
},
renderer: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        'terminal-webview': resolve(__dirname, 'src/webview/terminal/index.html'),
      }
    }
  }
}
```

## Edge Cases & Error Handling

**Webview crash/unresponsive:**
Electron emits `crashed` and `did-fail-load` on the webview element. Host TerminalCard listens for these, shows "Terminal crashed, click to restart" state. Restart creates a fresh webview with the same params; tmux reconnect recovers the session.

**Session created but webview destroyed before registration:**
SessionRouter's `getWebContents` guards with `isDestroyed()` check. Orphaned PTY sessions cleaned up by `ShellService.shutdown()` on app quit. Tmux sessions survive for reconnect on next mount.

**Multiple rapid close/restart:**
Boolean ref guard in TerminalCard. Ignore close/restart if one is already in flight.

**Webview fails to load (`did-fail-load`):**
Log the error, show fallback message in card. This is a build-time bug caught by `npm run build` verification, not a runtime edge case.

**Focus race between two terminals:**
CardShell's focus/lock protocol already serializes this. Only one card is locked at a time. Blur and focus messages happen in sequence through the existing canvas focus system.

**Resize during session create:**
ResizeObserver may fire in the webview before the session exists. TerminalApp buffers resize: only call `terminal:resize` after sessionId is established. `FitAddon.fit()` is safe to call anytime (it just measures); the IPC resize is what needs guarding.

**App quit with open webview terminals:**
Existing two-phase coordinated quit handles this. Webview terminals persist as tmux sessions. SessionRouter clears its map on shutdown.

## Testing Strategy

### Unit Tests
- **Session router**: register/unregister/route, isDestroyed guard, unknown sessionId returns null
- **Terminal webview preload**: listener set add/remove/dispatch, no listener leaks
- **TerminalApp**: session lifecycle (create/reconnect/restore), resize buffering before session exists

### Component Tests
- **TerminalCard (host)**: webview creation with correct URL params, focus protocol forwarding, close/restart guards
- **CardShell**: pointer-events overlay works with webview children (existing tests should pass unchanged)

### Integration
- `npm run check` clean (lint + typecheck + test)
- `npm run build` produces both entry points
- Manual: create terminal on canvas, verify zoom doesn't corrupt display
- Manual: restart app, verify terminal reconnects with scrollback
- Manual: run Claude Code in terminal, zoom in/out during active output
- Manual: Cmd+F search in terminal scrollback

## Verification

```bash
npm run typecheck    # both configs clean
npm run lint         # zero errors
npm test             # all existing + new tests pass
npm run build        # verify both entry points bundle
npm run dev          # manual terminal zoom test
```

## Success Criteria

- Terminal cards render without corruption at any zoom level
- Session create, reconnect, and restore work as before
- Claude card context injection works as before
- SearchAddon (Cmd+F) works in canvas terminals
- `npm run check` passes clean
- Build produces both entry points
