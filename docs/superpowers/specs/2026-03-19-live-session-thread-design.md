# Live Session Thread — Design Specification

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Project Canvas Phase 2

## Overview

A real-time, floating overlay panel on the Project Canvas that streams Claude's active session activity as grouped milestones. Users see what Claude is doing as it happens, presented as a scannable changelog rather than a raw log.

### Job-to-be-done

When Claude is working across files in a project, the builder needs to know: what just changed, is the session healthy, and should I intervene? The terminal gives raw text output. The Project Canvas gives spatial file orientation. The Live Session Thread bridges these with temporal, semantic awareness of Claude's tool-by-tool execution.

### What this is NOT

- Not a retrospective co-editing graph (rejected by council deliberation)
- Not a replacement for the terminal (complementary, not competitive)
- Not a persistent history (live view, resets on tab switch)

## Architecture

### Data flow

```
~/.claude/projects/{dirKey}/*.jsonl
        │
        ▼
SessionTailer (main process)
  - fs.watch on most recent .jsonl
  - Reads new bytes from last offset
  - Parses tool_use blocks
  - Groups into milestones
        │
        ▼
IPC event: session:milestone
        │
        ▼
useSessionThread hook (renderer)
  - Maintains milestone array (cap: 50)
  - Tracks expanded/collapsed state
  - Tracks live/idle status
        │
        ▼
SessionThreadPanel (floating overlay)
  - Scrollable milestone list
  - Expandable progressive disclosure
  - Click-to-open-file navigation
```

### Independence from existing systems

The session thread and the existing file watcher glow are independent systems:

- **File watcher (existing):** Chokidar watches the project directory. When a file changes on disk, the corresponding canvas card glows for 4 seconds. Data source: filesystem events.
- **Session thread (new):** SessionTailer watches Claude's JSONL log. When a tool_use event is written, a milestone appears in the overlay panel. Data source: session log.

They use different data sources, different rendering paths, and different lifecycles. They complement each other visually (the card glows while the thread shows why) without coupling.

## Components

### 1. SessionTailer (main process service)

**File:** `src/main/services/session-tailer.ts`

**Responsibility:** Watch a Claude session JSONL file and emit grouped milestone events.

**Behavior:**

1. Receives a project path, computes the Claude directory key
2. Scans `~/.claude/projects/{dirKey}/` for the most recently modified `.jsonl` file
3. Opens the file, seeks to the end (skip historical events)
4. Watches for appended bytes via `fs.watch`
5. On change: reads new bytes from last offset, splits into lines, parses JSON
6. Buffers incomplete lines until a newline arrives (handles partial writes)
7. Filters to assistant messages containing `tool_use` blocks
8. Passes raw tool events to the grouping function
9. Emits grouped milestones to the renderer via IPC
10. Every 5 seconds, checks if a newer `.jsonl` file has appeared. If so, switches to tailing the new file and emits a `session-switched` milestone.

**Session detection:**

The Claude directory key is derived from the project path with slashes replaced by dashes (matching `ProjectSessionParser.toDirKey()`). The tailer watches the directory, not a specific file, so it can detect new sessions.

### 2. Milestone grouping (pure function)

**File:** `src/main/services/session-milestone-grouper.ts`

**Responsibility:** Transform a sequence of raw `SessionToolEvent` objects into grouped `SessionMilestone` objects.

**Grouping rules:**

| Pattern | Milestone type | Summary |
|---------|---------------|---------|
| Consecutive Read/Grep events | `research` | "Researching — {n} operations" |
| Single Write event | `create` | "Created {filename}" |
| Single or consecutive Edit events on same file | `edit` | "Edited {filename} — {n} edits" |
| Edit events across different files | Separate `edit` milestones | One per file |
| Bash command | `command` | "{command preview} — {pass/fail/running}" |
| Bash command with non-zero exit | `error` | "Command failed — {command preview}" |

**Consecutive** means events with no intervening event of a different category. A Read followed by an Edit breaks the Read group.

**Summary extraction (truncation owner):** The grouper owns all truncation. For Edit events, it extracts a brief description from the tool input (first 200 chars of the description or diff). For Bash commands, it extracts the command text (first 100 chars). The tailer passes raw events; the grouper produces bounded summaries.

### 3. Types

**File:** `src/shared/project-canvas-types.ts` (additions)

```typescript
interface SessionMilestone {
  readonly id: string
  readonly type: 'edit' | 'create' | 'command' | 'research' | 'error' | 'session-switched'
  readonly timestamp: number
  readonly summary: string
  readonly files: readonly string[]
  readonly events: readonly SessionToolEvent[]
}

interface SessionToolEvent {
  readonly tool: 'Read' | 'Write' | 'Edit' | 'Bash' | 'Grep'
  readonly timestamp: number
  readonly filePath?: string
  readonly detail?: string
}
```

### 4. IPC channels

**File:** `src/shared/ipc-channels.ts` (additions)

New handle/invoke channels (added to `IpcChannels`):
```typescript
'session:tail-start': { request: { projectPath: string }; response: void }
'session:tail-stop': { request: void; response: void }
```

New push event (added to `IpcEvents`):
```typescript
'session:milestone': SessionMilestone
```

**Preload addition** (`src/preload/index.ts`):
```typescript
// Added to window.api.on:
sessionMilestone: (callback: (data: SessionMilestone) => void) =>
  typedOn('session:milestone', callback)
```

**BrowserWindow access:** `SessionTailer` receives `BrowserWindow` at construction time, matching the pattern used by `registerProjectIpc`. The IPC handler in `project.ts` passes the window when creating the tailer instance.

### 5. useSessionThread hook

**File:** `src/renderer/src/hooks/useSessionThread.ts`

**Responsibility:** Subscribe to `session:milestone` IPC events and maintain thread state.

**Interface:**

```typescript
interface SessionThreadState {
  readonly milestones: readonly SessionMilestone[]
  readonly expandedIds: ReadonlySet<string>
  readonly isLive: boolean
  readonly toggle: (id: string) => void
  readonly clear: () => void
}

function useSessionThread(projectPath: string | null, enabled: boolean): SessionThreadState
```

**Behavior:**

- Accepts an `enabled` flag that controls tailing independently of mount/unmount. This is necessary because `ProjectCanvasPanel` uses a keep-alive pattern (stays mounted across tab switches, does not unmount).
- When `enabled` transitions to `true`: calls `session:tail-start` via `window.api.session.tailStart(projectPath)`, subscribes to `window.api.on.sessionMilestone` events
- When `enabled` transitions to `false`: calls `session:tail-stop`, removes IPC listener, clears milestones
- `enabled` is driven by the thread panel toggle AND the active tab state. If the user toggles the thread on but switches to another tab, `enabled` becomes false. When they return, `enabled` becomes true again.
- Maintains milestones array, most recent first, capped at 50
- Tracks `isLive`: true when events received in last 10 seconds, false otherwise
- `toggle(id)`: adds/removes milestone ID from `expandedIds` set
- `clear()`: empties the milestones array
- On unmount (component actually removed from DOM): calls `session:tail-stop` as a safety net
- Batches incoming events with `requestAnimationFrame` to avoid jank from rapid arrivals

**Why a hook, not a store:** The session thread is local to the Project Canvas panel. It doesn't need to survive tab switches. A hook scoped to `ProjectCanvasPanel` keeps the lifecycle tight and avoids polluting global state.

### 6. SessionThreadPanel component

**File:** `src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx`

**Responsibility:** Floating overlay panel rendering the milestone stream.

**Layout:**

- Anchored to the right edge of the Project Canvas container
- Width: 280px fixed
- Max height: 70% of canvas container
- Scrollable milestone list

**Header:**

- Title: "Live Thread"
- Connection status dot: green (live), gray (idle/no events for 10+ seconds), red (no session found)

**Milestone rendering:**

Collapsed (default, one line per milestone):
- Type icon: `✎` edit, `▶` command, `◉` research, `✚` create, `✕` error, `↻` session-switched
- `session-switched` renders as a horizontal separator with "New session detected" text, not expandable
- Summary text
- Relative timestamp ("3s ago", "1m ago")

Expanded (on click):
- Individual `SessionToolEvent` details within the group
- For edits: file path + truncated change preview
- For bash: command text + output summary
- File paths are clickable, opening the file in the editor tab

**Empty state:** "No active Claude session detected. Start one in the terminal." with a muted icon.

**Auto-scroll:** Panel stays scrolled to top (newest first) unless the user has manually scrolled down. Tracks `isAtTop` via scroll position. Resets when user scrolls back to top.

**Styling:**
- Background: `colors.bg.elevated` with `backdrop-filter: blur(8px)`
- Border: `1px solid colors.border.default`
- Border radius: 8px
- Font: `typography.fontFamily.mono` for file paths, system font for summaries
- Relative timestamps update every 5 seconds via `setInterval`

**Toggle button:** Lightning bolt icon (`⚡`) added to the Project Canvas toolbar, after the existing Refresh/Fit All/+ Terminal buttons. When the thread is live, the icon pulses subtly via CSS animation.

### 7. Integration with ProjectCanvasPanel

**Changes to `ProjectCanvasPanel.tsx`:**

1. Import and call `useSessionThread(projectPath, enabled)` where `enabled = threadToggle && isActiveTab`
2. Add toggle state and `⚡` button to toolbar
3. Conditionally render `SessionThreadPanel` when toggled on
4. Pass milestone click handler for file navigation (reuses `useEditorStore.getState().setActiveNote()` + `useTabStore.getState().activateTab('editor')`)

**Lifecycle:**

Note: `ProjectCanvasPanel` uses keep-alive (stays mounted across tab switches). The hook's `enabled` flag, not mount/unmount, controls tailing.

- User opens Project Canvas -> thread toggle visible (off by default)
- User clicks `⚡` -> toggle state = true, `enabled` = true (active tab + toggle on), tailing begins
- User switches to another tab -> panel stays mounted, but `enabled` becomes false (inactive tab), tailing stops, milestones cleared
- User returns to Project Canvas -> `enabled` becomes true again, tailing resumes from current file position with fresh milestones
- User clicks `⚡` again -> toggle state = false, `enabled` = false, tailing stops

**What is NOT changed:**
- `CanvasSurface` — no modifications
- `canvas-store` — no modifications
- `ProjectFileCard` — no modifications
- `useProjectActivity` — independent system, continues working
- App shell layout — overlay is inside the canvas container

## Resilience

| Risk | Impact | Mitigation |
|------|--------|------------|
| JSONL file locked by Claude while writing | Read fails or reads partial line | Buffer incomplete lines until newline. Only parse complete lines. |
| No active session (no recent JSONL files) | Thread shows nothing | Empty state with clear messaging. |
| Session directory doesn't exist | Crash on startup | Guard with `fs.existsSync`. Show empty state. |
| Milestones arrive faster than React renders | UI jank | Batch with `requestAnimationFrame`. One state update per frame. |
| Hook unmounts during active tailing | Leaked IPC listener | Cleanup calls `session:tail-stop` and removes listener. |
| Summary extraction from huge tool content | Memory/display issues | Truncate detail to 200 chars. Full content on expand only. |
| Auto-scroll fights manual scroll | User reading history, panel yanks to top | Track `isAtTop`. Only auto-scroll when user is at top. |
| Relative timestamps go stale | "3s ago" never updates | `setInterval` every 5 seconds recalculates visible timestamps. |
| Panel covers canvas cards on narrow screens | Blocked interaction | Dismissible via toggle button. 280px is narrow enough for most screens. |
| New session starts mid-tailing | Events from old session, then silence | Check for newer JSONL every 5 seconds. Auto-switch and emit `session-switched` milestone. |
| JSONL file replaced instead of appended | `fs.watch` handle goes stale | The 5-second session-switch check also validates the watched file still exists. If gone, re-scan for the current file. |

## Testing

### Unit tested

**SessionTailer** (`tests/services/session-tailer.test.ts`):
- Reads new lines appended after seek-to-end
- Parses tool_use blocks from assistant messages
- Skips malformed/incomplete lines
- Handles missing directory gracefully
- Detects session switch to newer file
- Truncates detail to 200 chars

**Milestone grouping** (`tests/services/session-milestone-grouper.test.ts`):
- Consecutive Reads -> one research milestone with file count
- Single Edit -> one edit milestone with summary
- Multiple Edits on same file -> one milestone with edit count
- Edits across different files -> separate milestones
- Bash command -> command milestone with status
- Bash with non-zero exit -> error milestone
- Empty input -> empty output
- Single event -> single milestone

### Not unit tested

- `useSessionThread` hook (thin IPC subscriber, low logic density)
- `SessionThreadPanel` component (visual, verified by running the app)

## File inventory

| File | Layer | New/Modified |
|------|-------|-------------|
| `src/main/services/session-tailer.ts` | Main process | New |
| `src/main/services/session-milestone-grouper.ts` | Main process | New |
| `src/main/ipc/project.ts` | Main process | Modified (register new IPC) |
| `src/main/index.ts` | Main process | Modified (cleanup on quit) |
| `src/shared/project-canvas-types.ts` | Shared | Modified (new types) |
| `src/shared/ipc-channels.ts` | Shared | Modified (new channels/event) |
| `src/preload/index.ts` | Preload | Modified (expose new IPC) |
| `src/renderer/src/hooks/useSessionThread.ts` | Renderer | New |
| `src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx` | Renderer | New |
| `src/renderer/src/panels/project-canvas/ProjectCanvasPanel.tsx` | Renderer | Modified (toolbar + mount) |
| `tests/services/session-tailer.test.ts` | Tests | New |
| `tests/services/session-milestone-grouper.test.ts` | Tests | New |

## Decision log

| Decision | Choice | Alternatives considered |
|----------|--------|------------------------|
| Data source | JSONL tailing | File watcher events, hybrid (both) |
| Canvas integration | Sidebar thread overlay | Animate existing cards, canvas nodes as timeline |
| Event detail | Expandable progressive disclosure | Minimal (one-line), contextual (two-line) |
| Session selection | Most recently modified, auto-switch | All active sessions, user dropdown |
| Filtering | Smart grouping into milestones | Action-only (writes only), milestone filtering |
| UI placement | Floating overlay (GraphSettingsPanel pattern) | Right split panel, bottom drawer |
| Architecture | Main process tailer + IPC stream | Renderer-side polling via existing parser |
| State management | Local hook, not global store | Zustand store, context provider |

## Council context

This design was informed by a 5-member council deliberation that unanimously rejected the original Phase 2 plan (co-editing relationship edges). The council converged on three points:

1. Co-editing edges measure Claude's workflow, not code structure (noisy signal)
2. The Project Canvas is unvalidated as an attention-earning surface
3. The real value is live and forward-looking, matching Casey's "AI as scheduled capacity" mental model

The Live Session Thread directly addresses all three: it provides semantic signal (not co-occurrence noise), it creates pull to the canvas (live content that demands attention), and it serves the moment of work (forward-looking, not retrospective).

The Pragmatist's dissent remains valid: this is still a bet on the canvas. If the thread doesn't earn return visits, the canvas should be cut or repositioned. The thread is both a feature and a validation experiment.
