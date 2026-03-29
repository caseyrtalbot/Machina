# Terminal Webview Isolation: Design Spec

## Problem

Terminal cards on the canvas exhibit display corruption when zooming because xterm.js lives inside the CSS `transform: scale(zoom)` hierarchy. The counter-scale wrapper creates a 150ms+ desync between font metrics and container dimensions during zoom changes, causing rendering artifacts, broken scrolling, and line-wrapping corruption — all amplified by high-throughput terminal output (Claude Code running).

Seven root causes were identified (session 2026-03-29). All stem from one architectural flaw: xterm.js does not belong inside a CSS transform hierarchy.

## Approach

Migrate terminal cards from shared-DOM React components to isolated Electron `<webview>` elements. Each terminal gets its own renderer process where xterm.js renders at native resolution, completely unaware of canvas zoom. The canvas positions and visually scales the webview container. This eliminates every root cause simultaneously.

Reference implementation: Collaborator (`src/windows/terminal-tile/`). Proven in production, same Electron + xterm.js + tmux stack.

## What's Good (Preserve)

These are production-quality and webview-agnostic. No changes needed:

| File | Lines | Why it's good |
|------|-------|---------------|
| `ShellService` | 171 | Dual-path facade (tmux/ephemeral), clean API |
| `TmuxService` | 345 | Tmux session lifecycle, reconnect, discover, metadata persistence |
| `tmux-paths.ts` | 119 | Isolated socket, session naming, metadata storage |
| `shell.ts` IPC handler | 70 | SessionId validation, typed handlers (needs routing change, see below) |
| `ipc-channels.ts` | 173 | Fully typed terminal channels |
| Canvas node format | — | `{ type: 'terminal', content: sessionId, metadata: { initialCwd, initialCommand } }` persists identically |
| Data coalescing buffer | — | 5ms flush pattern (reuse in webview guest) |
| Double-rAF layout sequencing | — | Reuse in webview guest |
| WebGL with fallback | — | Reuse in webview guest |
| Claude context injection | — | `context-serializer.ts` is pure logic, reuse as-is |

## What Changes

### TerminalCard.tsx (501 lines → ~200 lines)

Currently: mounts xterm.js directly, manages PTY session, counter-scale wrapper, font-size tracking.

Becomes: a **thin webview host** that creates a `<webview>` element, passes session identity via URL params, handles focus coordination, and relays close/restart actions. No xterm imports, no fitAddon, no counter-scale, no font-size effects.

**Host responsibilities:**
- Create `<webview src="terminal-webview.html?sessionId=X&cwd=Y&command=Z">`
- Set `preload` to the terminal-webview preload script
- Listen for `ipc-message` from webview (session-id notification, focus requests)
- Forward focus/blur to webview via `webview.send()`
- Handle close (kill session + remove node) and restart (kill + new webview)
- Render inside `CardShell` as before (title bar, resize handles stay in host)

**Removed:**
- All xterm.js imports and lifecycle
- Counter-scale wrapper
- Font-size zoom tracking
- ResizeObserver + fitAddon
- Data coalescing buffer (moves to webview guest)
- PTY data listener (moves to webview guest)

### New: Terminal Webview Guest

A standalone entry point (`src/webview/terminal/`) that runs inside the `<webview>`:

**`index.html`** — minimal shell with `<div id="root">`, dark background

**`main.tsx`** — React 18 entry, renders `<TerminalApp>`

**`TerminalApp.tsx`** — session lifecycle controller:
- Reads session identity from URL params (`sessionId`, `cwd`, `initialCommand`, `restored`)
- If `restored` + `sessionId`: reconnect via `window.terminalApi.reconnect(sessionId, cols, rows)`
- If `sessionId` only: attach to existing session
- If no `sessionId`: create via `window.terminalApi.create(cwd, cols, rows)`, notify host via `sendToHost('session-created', sessionId)`
- If `initialCommand`: send after session connects (with 500ms delay for Claude)
- Mounts xterm.js with WebGL, FitAddon, WebLinksAddon, SearchAddon
- Data coalescing buffer (5ms, identical to current pattern)
- ResizeObserver → rAF → fit() → ptyResize (no debounce timer needed, rAF is sufficient)
- Theme from CSS `prefers-color-scheme` media query (inherits from host window)

### New: Terminal Webview Preload

`src/preload/terminal-webview.ts` — stripped-down preload exposing only terminal APIs:

```typescript
contextBridge.exposeInMainWorld('terminalApi', {
  create: (cwd, cols, rows) => ipcRenderer.invoke('terminal:create', { cwd, cols, rows }),
  write: (sessionId, data) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
  resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
  kill: (sessionId) => ipcRenderer.invoke('terminal:kill', { sessionId }),
  reconnect: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:reconnect', { sessionId, cols, rows }),
  onData: (cb) => { /* listener set pattern */ },
  offData: (cb) => { /* remove from set */ },
  onExit: (cb) => { /* listener set pattern */ },
  offExit: (cb) => { /* remove from set */ },
  sendToHost: (channel, ...args) => ipcRenderer.sendToHost(channel, ...args),
})
```

Uses the listener-set pattern (one `ipcRenderer.on` at load time, dispatches to `Set<callback>`). Prevents listener leaks.

### shell.ts IPC Handler — Session-to-Webview Routing

Currently: `typedSend(mainWindow, 'terminal:data', ...)` broadcasts to the single BrowserWindow.

Change: route `terminal:data` and `terminal:exit` events to the **specific webContents** that owns the session.

```typescript
// New: session-to-webContents registry
const sessionOwners = new Map<string, number>() // sessionId -> webContentsId

// On terminal:create, register the sender
typedHandle('terminal:create', async (args, event) => {
  const id = shellService.create(args.cwd, args.shell, args.label, args.vaultPath)
  sessionOwners.set(id, event.sender.id)
  return id
})

// Data callback targets the specific webContents
shellService.setCallbacks(
  (sessionId, data) => {
    const wcId = sessionOwners.get(sessionId)
    if (wcId) {
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) {
        wc.send('terminal:data', { sessionId, data })
      }
    }
  },
  // ... same for exit
)
```

This is the Collaborator pattern: `webContents.fromId(senderWebContentsId).send(...)`.

### electron-vite Config

Add `terminal-webview` as a new renderer entry point and `terminal-webview` as a new preload entry:

```typescript
// In electron.vite.config.ts
renderer: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        'terminal-webview': resolve(__dirname, 'src/webview/terminal/index.html'),
      }
    }
  }
},
preload: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/preload/index.ts'),
        'terminal-webview': resolve(__dirname, 'src/preload/terminal-webview.ts'),
      }
    }
  }
}
```

### CardShell.tsx — Minor Changes

The pointer-events overlay currently blocks events to shared-DOM children. For webviews, toggle `pointer-events: none` on the `<webview>` element directly when unfocused. The title bar, resize handles, and connection dots remain in the host DOM (not inside the webview).

### CanvasSurface.tsx — Webview Positioning

Two options:

**Option A (simpler):** Keep terminal webview cards inside the transform layer. The CSS `scale(zoom)` on the parent will visually scale the webview element. Since xterm.js inside the webview renders at native resolution, the browser compositor handles the scaling. The webview doesn't know or care.

**Option B:** Position webview cards at screen coordinates outside the transform layer, computing position manually from canvas coordinates + viewport. More complex, no clear benefit.

**Recommendation: Option A.** The whole point of webview isolation is that the guest doesn't care about the host's transforms. CSS scale on a webview element is handled by the compositor, just like scaling an image. No counter-scale needed.

## Focus Protocol

1. **Click on card** → CardShell focuses the card (existing behavior)
2. **Lock engaged** → host calls `webview.focus()`, webview's `window.focus` listener calls `term.focus()`
3. **Lock disengaged** → host calls `webview.send('blur')`, webview blurs xterm
4. **Another card focused** → host calls `webview.send('blur')` on the previously focused terminal

## Theme Sync

The webview inherits `prefers-color-scheme` from the host OS. For the custom Thought Engine themes (6 themes, 8 accents):

- Host sends `webview.send('theme-update', themeData)` when theme changes
- Webview listens and updates `term.options.theme`
- Alternative: inject CSS variables via `webview.insertCSS()`

## Improvements Over Collaborator

| Aspect | Collaborator | Thought Engine (proposed) |
|--------|-------------|--------------------------|
| IPC typing | Loose strings | Fully typed channels via `IpcChannels` generic |
| State management | Mutable JS arrays | Zustand with immutable patterns |
| Theme system | Hardcoded dark/light | 6 themes, 8 accents, design token propagation |
| Terminal search | Not available in tiles | SearchAddon included in webview guest |
| Agent context | Not available | Claude system prompt with spatial canvas context |
| MCP integration | None | Ghost layer, vault queries, HITL-gated writes |
| Session validation | None | SessionId regex validation at IPC boundary |

## Files Inventory

### New Files (5)

| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/webview/terminal/index.html` | Webview entry HTML | ~15 |
| `src/webview/terminal/main.tsx` | React entry | ~10 |
| `src/webview/terminal/TerminalApp.tsx` | Session lifecycle + xterm.js | ~300 |
| `src/preload/terminal-webview.ts` | Typed preload for terminal webviews | ~80 |
| `src/main/services/session-router.ts` | Session-to-webContents routing registry | ~50 |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/renderer/src/panels/canvas/TerminalCard.tsx` | Major rewrite: webview host instead of xterm mount |
| `src/renderer/src/panels/canvas/CardShell.tsx` | Pointer-events for webview elements |
| `src/main/ipc/shell.ts` | Use session-router for data/exit event routing |
| `src/preload/index.ts` | No terminal namespace needed for canvas (panel still uses it) |
| `electron.vite.config.ts` | Add terminal-webview entry points |

### Unchanged Files (14)

All backend services, panel terminal, canvas persistence, stores — unchanged.

## Testing Strategy

### Unit Tests
- Session router: register/unregister/route
- Terminal webview preload: listener set add/remove/dispatch
- TerminalApp: session lifecycle (create/reconnect/restore)

### Component Tests
- TerminalCard (host): webview creation, focus protocol, close/restart
- CardShell: pointer-events toggling for webview children

### Integration
- `npm run check` clean
- Manual: create terminal on canvas, verify zoom doesn't corrupt display
- Manual: restart app, verify terminal reconnects with scrollback
- Manual: run Claude Code in terminal, zoom in/out during active output

## Verification

```bash
npm run typecheck    # both configs clean
npm run lint         # zero errors
npm test             # all existing + new tests pass
npm run build        # verify both entry points bundle
npm run dev          # manual terminal zoom test
```
