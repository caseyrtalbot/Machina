## Chunk 2: Phase 1C (Custom Titlebar) + Phase 1D (Layout) + Phase 1E (Bug Fixes)

### Task 7: Register window and config IPC handlers in main process

**Files:** Modify `src/main/index.ts` | Create `src/main/ipc/config.ts`

- [ ] **Step 1: Create config IPC handler**

```typescript
import { ipcMain } from 'electron'
import Store from 'electron-store'

const appStore = new Store({ name: 'thought-engine-settings' })

export function registerConfigIpc(): void {
  ipcMain.handle('config:read', async (_e, args: { scope: string; key: string }) => {
    if (args.scope === 'app') return appStore.get(args.key, null)
    return null
  })
  ipcMain.handle(
    'config:write',
    async (_e, args: { scope: string; key: string; value: unknown }) => {
      if (args.scope === 'app') appStore.set(args.key, args.value)
    }
  )
}
```

- [ ] **Step 2: Update main/index.ts** (diff)

Add import:
```typescript
import { registerConfigIpc } from './ipc/config'
```

Hoist `mainWindow` to module scope, add titlebar options:
```diff
+let mainWindow: BrowserWindow | null = null
+
 function createWindow(): BrowserWindow {
-  const mainWindow = new BrowserWindow({
+  mainWindow = new BrowserWindow({
     ...
     autoHideMenuBar: true,
+    titleBarStyle: 'hidden',
+    trafficLightPosition: { x: 12, y: 12 },
     ...(process.platform === 'linux' ? { icon } : {}),
```

Add after `createWindow`:
```typescript
function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}
```

In `app.whenReady()`, remove `ipcMain.on('ping', ...)`, add registrations:
```diff
   registerFilesystemIpc()
+  registerConfigIpc()
+  registerWindowIpc()
-  const mainWindow = createWindow()
-  registerWatcherIpc(mainWindow)
-  registerShellIpc(mainWindow)
+  const window = createWindow()
+  registerWatcherIpc(window)
+  registerShellIpc(window)
```

Remove all boilerplate comments.

- [ ] **Step 3: Typecheck** `npm run typecheck:node`
- [ ] **Step 4: V&C** `git add src/main/index.ts src/main/ipc/config.ts` | `feat: register window and config IPC handlers, enable custom titlebar`

---

### Task 8: Create PanelErrorBoundary component

**Files:** Create `src/renderer/src/components/PanelErrorBoundary.tsx` | Create `tests/components/PanelErrorBoundary.test.tsx`

- [ ] **Step 1: Write the test**

Test file: `tests/components/PanelErrorBoundary.test.tsx`

Helper: `ThrowingChild({ shouldThrow })` throws or renders `<div>Child content</div>`.

Three tests:
- `renders children when no error` -- render with `shouldThrow={false}`, assert `'Child content'` present
- `shows fallback on error` -- wrap `shouldThrow={true}` in `<PanelErrorBoundary name="Graph">`, assert `'Something went wrong'` and `/Graph/`. Suppress console.error.
- `retries on button click` -- `Toggler` initially throws. Assert fallback. Set flag false, click `'Retry'`, rerender, assert `'Recovered'` visible, fallback gone.

- [ ] **Step 2: Verify test fails** (module not found)
- [ ] **Step 3: Implement PanelErrorBoundary**

Class component. Props: `name: string`, `children: ReactNode`. State: `hasError`, `error`, `showDetails`.

```typescript
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { colors } from '../design/tokens'

interface Props { name: string; children: ReactNode }
interface State { hasError: boolean; error: Error | null; showDetails: boolean }

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] Panel error:`, error, info.componentStack)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center p-6"
          style={{ backgroundColor: colors.bg.surface }}>
          <div className="text-center max-w-sm">
            <p style={{ color: colors.text.primary }} className="text-sm font-medium mb-1">
              Something went wrong
            </p>
            <p style={{ color: colors.text.muted }} className="text-xs mb-4">
              The {this.props.name} panel encountered an error.
            </p>
            <button onClick={this.handleRetry}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: colors.accent.muted,
                color: colors.accent.default,
                border: `1px solid ${colors.border.default}`,
              }}>
              Retry
            </button>
            {this.state.error && (
              <button
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="ml-2 text-xs px-3 py-1.5 rounded-md"
                style={{ color: colors.text.muted }}>
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
            {this.state.showDetails && this.state.error && (
              <pre className="mt-3 text-left text-[11px] p-3 rounded overflow-auto max-h-40"
                style={{
                  backgroundColor: colors.bg.base,
                  color: colors.text.secondary,
                  fontFamily: '"JetBrains Mono", monospace',
                }}>
                {this.state.error.message}{'\n'}{this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Verify test passes, then full suite** `npm test`
- [ ] **Step 5: V&C** `git add src/renderer/src/components/PanelErrorBoundary.tsx tests/components/PanelErrorBoundary.test.tsx` | `feat: add PanelErrorBoundary with retry and error details`

---

### Task 9: Create Titlebar component

**Files:** Create `src/renderer/src/components/Titlebar.tsx`

- [ ] **Step 1: Implement Titlebar**

```typescript
import { colors } from '../design/tokens'

interface TitlebarProps { vaultName: string; onOpenSettings: () => void }

export function Titlebar({ vaultName, onOpenSettings }: TitlebarProps) {
  return (
    <div className="h-[38px] flex items-center px-3 select-none flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
      {/* Traffic light spacer (macOS native) */}
      <div className="w-[70px] flex-shrink-0" />
      {/* Vault tab */}
      <div className="flex items-center gap-2 px-3 py-1 rounded-md text-sm"
        style={{
          backgroundColor: colors.bg.elevated, color: colors.text.primary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}>
        <span className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.accent.default }} />
        <span className="truncate max-w-[200px]">{vaultName}</span>
      </div>
      <div className="flex-1" />
      {/* Settings gear */}
      <button onClick={onOpenSettings}
        className="p-1.5 rounded-md transition-colors hover:bg-[#1A1A1D]"
        style={{ color: colors.text.secondary, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Settings">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: V&C** `git add src/renderer/src/components/Titlebar.tsx` | `feat: add custom Titlebar with vault tab and settings gear`

---

### Task 10: Create SettingsModal stub

**Files:** Create `src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: Implement stub**

```typescript
import { colors } from '../design/tokens'

interface SettingsModalProps { isOpen: boolean; onClose: () => void }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }} onClick={onClose}>
      <div className="w-full max-w-2xl h-[500px] rounded-xl border overflow-hidden"
        style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
        onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b"
          style={{ borderColor: colors.border.default }}>
          <span className="text-sm font-medium" style={{ color: colors.text.primary }}>
            Settings
          </span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded"
            style={{ color: colors.text.muted }}>Close</button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm" style={{ color: colors.text.muted }}>
            Settings will be implemented in Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: V&C** `git add src/renderer/src/components/SettingsModal.tsx` | `feat: add SettingsModal stub for Phase 2 implementation`

---

### Task 11: Update App.tsx with titlebar, error boundaries, and new layout

**Files:** Modify `src/renderer/src/App.tsx`

- [ ] **Step 1: Restructure App.tsx** (all changes are diffs from current file)

**(a) Add imports** after existing imports:
```typescript
import { Titlebar } from './components/Titlebar'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
```

**(b) StatusBar** -- narrow selectors, token-based styles, typed IPC:
```diff
-  const { vaultPath, files } = useVaultStore()
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const fileCount = useVaultStore((s) => s.files.length)
```
```diff
-    window.electron.ipcRenderer.invoke('vault:git-branch', { vaultPath })
+    window.api.vault.gitBranch(vaultPath)
```
```diff
-      className="h-6 flex items-center px-3 text-[11px] text-[#5A5A5E] border-t border-[#2A2A2E]"
-      style={{ backgroundColor: colors.bg.surface }}
+      className="h-6 flex items-center px-3 text-[11px] border-t flex-shrink-0"
+      style={{ backgroundColor: colors.bg.surface, color: colors.text.muted, borderColor: colors.border.default }}
```
```diff
-      <span>{files.length} notes</span>
+      <span>{fileCount} notes</span>
```

**(c) ContentArea** -- narrow selectors:
```diff
-  const { contentView } = useGraphStore()
-  const { setActiveNote } = useEditorStore()
-  const { setContentView } = useGraphStore()
+  const contentView = useGraphStore((s) => s.contentView)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const setContentView = useGraphStore((s) => s.setContentView)
```

**(d) ConnectedSidebar** -- narrow selectors:
```diff
-  const { files, config, activeWorkspace, setActiveWorkspace } = useVaultStore()
-  const { setActiveNote, activeNotePath } = useEditorStore()
+  const files = useVaultStore((s) => s.files)
+  const config = useVaultStore((s) => s.config)
+  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
+  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const activeNotePath = useEditorStore((s) => s.activeNotePath)
```

**(e) WorkspaceShell** -- narrow selectors, settings state, Titlebar, error boundaries, widths:
```diff
   const [paletteOpen, setPaletteOpen] = useState(false)
-  const { files } = useVaultStore()
-  const { setActiveNote } = useEditorStore()
-  const { contentView, setContentView } = useGraphStore()
-  const { mode, setMode } = useEditorStore()
+  const [settingsOpen, setSettingsOpen] = useState(false)
+  const files = useVaultStore((s) => s.files)
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const contentView = useGraphStore((s) => s.contentView)
+  const setContentView = useGraphStore((s) => s.setContentView)
+  const mode = useEditorStore((s) => s.mode)
+  const setMode = useEditorStore((s) => s.setMode)
+  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'
```

JSX:
```diff
     >
+      <Titlebar vaultName={vaultName} onOpenSettings={() => setSettingsOpen(true)} />
       <div className="flex-1 overflow-hidden">
         <SplitPane
-          left={<ConnectedSidebar />}
+          left={<PanelErrorBoundary name="Sidebar"><ConnectedSidebar /></PanelErrorBoundary>}
           right={
             <SplitPane
-              left={<ContentArea />}
-              right={<TerminalPanel />}
+              left={<PanelErrorBoundary name="Content"><ContentArea /></PanelErrorBoundary>}
+              right={<PanelErrorBoundary name="Terminal"><TerminalPanel /></PanelErrorBoundary>}
               initialLeftWidth={580}
               minLeftWidth={300}
-              minRightWidth={320}
+              minRightWidth={400}
             />
           }
-          initialLeftWidth={260}
+          initialLeftWidth={240}
```
After `<CommandPalette ... />`:
```diff
+      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

**(f) App()** -- narrow selectors:
```diff
-  const { vaultPath, loadVault } = useVaultStore()
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const loadVault = useVaultStore((s) => s.loadVault)
```

- [ ] **Step 2: Typecheck** `npm run typecheck`
- [ ] **Step 3: Tests** `npm test`
- [ ] **Step 4: V&C** `git add src/renderer/src/App.tsx` | `feat: integrate titlebar, error boundaries, and new layout skeleton`

---

### Task 12: Fix RichEditor markdown serialization (Bug #1)

**Files:** Modify `src/renderer/src/panels/editor/RichEditor.tsx`

- [ ] **Step 1: Install @tiptap/markdown**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm install --cache /tmp/npm-cache-te @tiptap/markdown`

- [ ] **Step 2: Fix the serialization** (diff)

```diff
 import StarterKit from '@tiptap/starter-kit'
+import { Markdown } from '@tiptap/markdown'
 import { colors } from '../../design/tokens'
```
```diff
-    extensions: [StarterKit],
+    extensions: [
+      StarterKit,
+      Markdown.configure({ html: false, transformCopiedText: true, transformPastedText: true }),
+    ],
     content,
     onUpdate: ({ editor }) => {
-      onChange(editor.getText())
+      onChange(editor.getMarkdown())
     },
```
```diff
-    if (editor && content !== editor.getText()) {
+    if (editor && content !== editor.getMarkdown()) {
```

The bug: `editor.getText()` strips all formatting. `@tiptap/markdown` adds `editor.getMarkdown()` for proper serialization.

- [ ] **Step 3: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 4: V&C** `git add src/renderer/src/panels/editor/RichEditor.tsx package.json package-lock.json` | `fix: use @tiptap/markdown serializer instead of getText() in RichEditor`

---

### Task 13: Fix SourceEditor stale closure (Bug #2)

**Files:** Modify `src/renderer/src/panels/editor/SourceEditor.tsx`

- [ ] **Step 1: Fix the stale closure** (diff)

The bug: `useEffect([], ...)` captures initial `onChange` in a closure. If identity changes, editor calls stale version.

```diff
   const viewRef = useRef<EditorView | null>(null)
+  const onChangeRef = useRef(onChange)
+
+  useEffect(() => { onChangeRef.current = onChange }, [onChange])
```
```diff
           if (update.docChanged) {
-            onChange(update.state.doc.toString())
+            onChangeRef.current(update.state.doc.toString())
           }
```

No other changes.

- [ ] **Step 2: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/panels/editor/SourceEditor.tsx` | `fix: use ref for onChange in SourceEditor to prevent stale closure`

---

### Task 14: Fix SplitPane handler leak (Bug #3)

**Files:** Modify `src/renderer/src/design/components/SplitPane.tsx`

- [ ] **Step 1: Fix the mouse handler leak** (diff)

The bug: `mousemove`/`mouseup` listeners leak if component unmounts mid-drag.

```diff
   const dragging = useRef(false)
+  const handlersRef = useRef<{
+    move: ((e: MouseEvent) => void) | null
+    up: (() => void) | null
+  }>({ move: null, up: null })
```

After the clamp `useEffect`, add cleanup:
```typescript
  useEffect(() => {
    return () => {
      if (handlersRef.current.move)
        document.removeEventListener('mousemove', handlersRef.current.move)
      if (handlersRef.current.up)
        document.removeEventListener('mouseup', handlersRef.current.up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])
```

Inside `handleMouseDown`, at end of `handleMouseUp`:
```diff
       document.removeEventListener('mouseup', handleMouseUp)
+      handlersRef.current = { move: null, up: null }
     }
+    handlersRef.current = { move: handleMouseMove, up: handleMouseUp }
     document.addEventListener('mousemove', handleMouseMove)
```

- [ ] **Step 2: Tests** `npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/design/components/SplitPane.tsx` | `fix: clean up SplitPane mouse handlers on unmount to prevent leak`

---

### Task 15: Fix terminal tab close PTY kill (Bug #4)

**Files:** Modify `src/renderer/src/panels/terminal/TerminalPanel.tsx` | Modify `src/renderer/src/panels/terminal/TerminalTabs.tsx`

- [ ] **Step 1: Add PTY kill and xterm dispose on tab close**

TerminalTabs ALREADY has a close button, but it calls `removeSession(session.id)` directly, skipping PTY kill and xterm dispose. Wire through `onCloseTab` prop instead.

Add to `TerminalPanel`:
```typescript
  const handleCloseTab = useCallback(
    (sessionId: string) => {
      if (sessions.length <= 1) return
      window.api.terminal.kill(sessionId)
      const instance = instancesRef.current.get(sessionId)
      if (instance) {
        instance.terminal.dispose()
        instancesRef.current.delete(sessionId)
      }
      removeSession(sessionId)
    },
    [sessions.length, removeSession]
  )
```

```diff
-<TerminalTabs onNewTab={handleNewTab} />
+<TerminalTabs onNewTab={handleNewTab} onCloseTab={handleCloseTab} />
```

Update `TerminalTabs`:
```diff
-interface TerminalTabsProps { onNewTab: () => void }
-export function TerminalTabs({ onNewTab }: TerminalTabsProps) {
-  const { sessions, activeSessionId, setActiveSession, removeSession } = useTerminalStore()
+interface TerminalTabsProps { onNewTab: () => void; onCloseTab: (sessionId: string) => void }
+export function TerminalTabs({ onNewTab, onCloseTab }: TerminalTabsProps) {
+  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
```
```diff
-              removeSession(session.id)
+              onCloseTab(session.id)
```

- [ ] **Step 2: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/panels/terminal/TerminalPanel.tsx src/renderer/src/panels/terminal/TerminalTabs.tsx` | `fix: kill PTY and dispose xterm on terminal tab close`

---
