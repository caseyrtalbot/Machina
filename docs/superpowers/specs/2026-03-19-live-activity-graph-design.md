# Live Activity Graph — Design Specification

Real-time ontological visualization of Claude's ecosystem in action. A dedicated canvas view that shows which skills, agents, subagents, MCP servers, and commands Claude is using as it works, with a session hub at center and radial slot layout.

## Problem

When Claude is working on a project, the user has no visibility into what's happening inside the session. They can see terminal output, but not which skills are invoked, which agents are spawned (or fan out into subagent teams), which MCP servers are called, or how those ecosystem elements relate to each other. The user is blind to the orchestration layer.

## Solution

A new canvas view (Cmd+Shift+L) that visualizes Claude's ecosystem activity in real-time. A session hub sits at center. When Claude invokes a skill, spawns an agent, calls an MCP server, or triggers a command, a node appears on the graph in a radial slot around the hub. Subagents appear with parent-child edges showing spawn relationships. Nodes transition through active/recent/historical states as the session progresses. A rich activity feed provides context alongside the visual graph.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Ecosystem elements only (skills, agents, subagents, MCP servers, commands) | Individual file reads and tool calls are noise for an ontological view |
| View type | New dedicated canvas view, not overlay on Config Canvas | Config Canvas is a static reference for "what do I have." Activity Graph is a live instrument for "what is happening." Mixing them degrades both (council unanimous). |
| Data strategy | Live-first with incremental JSONL tail parser | Honest data from day one. No fake real-time indicators. Tail parser is foundational infrastructure that benefits all future features. |
| Layout | Radial slots (deterministic placement) | Session hub at center. Inner ring for active elements, outer ring for recent/historical. No physics simulation, no jitter, drag-friendly. Pure function: (nodes, states) -> positions. |
| Node lifecycle | Persist for session with state transitions | Active (glowing, inner ring) -> recent (dimmed, outer ring) -> historical (faint, outer ring). Nodes never disappear during a session. Clear on new session. |
| Empty state | Invitation with mid-session backfill | Clean slate when no session is running. When joining an active session, backfill existing JSONL content before switching to live tailing. |
| Activity feed | Rich feed with context | Ecosystem events plus description, trigger source, tool name. 2-3 lines per event. |
| Session boundary | New JSONL file = new session | Clear graph when new session file appears. Backfill when detecting existing active file. |
| Node rendering | Own component tree, not CanvasNode/CardShell | Activity nodes use a lightweight ActivityNode type with state-dependent sizing. Rendered directly by ActivityGraphPanel, not through the generic card registry. This avoids polluting canvas-types.ts with activity-specific concerns and allows state-driven size transitions. |
| Persistence | Ephemeral (in-memory only) | Activity graph is rebuilt from JSONL on each mount. The activity-graph-store caches current state for fast store-swap restoration but writes nothing to disk. No .json canvas file. |

## Architecture

### Process Boundaries

```
File System                    Main Process                 Preload              Renderer
────────────                   ────────────                 ───────              ────────
~/.claude/projects/            SessionTailParser            activity             ActivityGraphPanel
  {key}/*.jsonl                  - watches for new files    namespace              - own render tree
                                 - tails active file          - startWatch         - no CardShell/LazyCards
                                 - parses tool_use blocks     - stopWatch        useActivityStream
                                 - matches ecosystem names    - on.activityEvent activity-graph-store
                               ActivityEventEmitter                              radial-layout.ts
                                 - typed event dispatch                          ActivityNodeCard
                                 - backfill + live modes                         ActivityFeed
```

### New Files

**Main process:**
- `src/main/services/session-tail-parser.ts` — Incremental JSONL parser. Watches project session directory, detects new/active files, reads new bytes from tracked offset, buffers partial lines, parses complete JSON for tool_use blocks matching ecosystem patterns. Manages byte offset and line buffer lifecycle.
- `src/main/ipc/activity.ts` — IPC handler registration. Channels: `activity:watch-start`, `activity:watch-stop`. Event: `activity:event`.

**Shared:**
- `src/shared/activity-types.ts` — Type definitions for ActivityEvent (discriminated union), ActivityNodeType, ActivityNodeState, ActivityNode.

**Renderer:**
- `src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx` — Top-level panel. Manages its own node/edge state (not canvas-store). Toolbar with live indicator, fit-all, clear. Empty state invitation. Calls `activity:watch-stop` on unmount.
- `src/renderer/src/panels/activity-graph/ActivityNodeCard.tsx` — Lightweight card component for ecosystem nodes. Renders name, type badge, state indicator, invocation count, timing. Color-coded by type. Size determined by node state, not a fixed CanvasNode.size field.
- `src/renderer/src/panels/activity-graph/ActivityFeed.tsx` — Scrolling event feed. Rich entries with event type, element name, context line, timestamp.
- `src/renderer/src/panels/activity-graph/radial-layout.ts` — Pure function layout engine. Assigns nodes to radial slots based on state (active = inner ring, recent/historical = outer ring). Deterministic: same input always produces same positions.
- `src/renderer/src/store/activity-graph-store.ts` — Zustand store for in-memory activity state cache. Stores current ActivityNode array, session state, and feed entries. Used for fast restore when toggling views. No disk persistence.
- `src/renderer/src/hooks/useActivityStream.ts` — Hook that subscribes to activity IPC events, manages node state transitions (active -> recent -> historical based on time thresholds), and drives graph updates.

**Modified files:**
- `src/shared/ipc-channels.ts` — Add activity channels and event type to IpcChannels and IpcEvents.
- `src/preload/index.ts` — Add `activity` namespace with watchStart, watchStop methods and on.activityEvent subscription.
- `src/renderer/src/store/view-store.ts` — Add `activity-graph` to ContentView union. Add `toggleActivityGraph()` method.
- `src/renderer/src/App.tsx` — Render ActivityGraphPanel when contentView is `activity-graph`.

**Not modified** (unlike earlier draft):
- `src/shared/canvas-types.ts` — No changes. Activity nodes use their own type system.
- `src/renderer/src/panels/canvas/card-registry.ts` — No changes. Activity nodes render through their own components.

### Reused Infrastructure

- `CanvasSurface` — Pan, zoom, background grid (ActivityGraphPanel wraps this for viewport behavior)
- `EdgeLayer` — Connection rendering between nodes (edges from activity nodes to hub and between parent/child)
- `useViewportCulling` — AABB visibility filtering (if node count grows large)

### Not Reused

- `CardShell` — Activity nodes render their own drag/resize behavior (simpler, state-driven sizing)
- `TerminalCard` — The session hub is a visual-only indicator, not an interactive terminal
- `canvas-store` — Activity graph manages its own state in activity-graph-store
- `LazyCards` / card registry — Activity cards rendered directly, not through the registry

### Relationship to Existing Activity System

The existing `claude-activity-store.ts` and `useClaudeActivity` hook handle a different concern: making Config Canvas cards glow when their backing files change. That system watches `~/.claude/` file modifications and matches by filename. It remains independent and unchanged. The new ActivityEvent pipeline watches session JSONL files and matches by tool_use content. These are parallel systems with no overlap.

## IPC Channel Definitions

```typescript
// Added to IpcChannels:
'activity:watch-start': { request: { projectPath: string }; response: void }
'activity:watch-stop': { request: void; response: void }

// Added to IpcEvents:
'activity:event': ActivityEvent
```

## Data Flow

### 1. Session Detection

SessionTailParser watches `~/.claude/projects/{encoded-project-path}/` using chokidar. The project path is derived from the current vault path using the same encoding as Claude Code (path separators replaced with hyphens, leading separator becomes leading hyphen).

- **New .jsonl file appears**: New session detected. Emit `session-start` event. Clear previous graph state. Begin tailing the new file.
- **Existing .jsonl file modified**: Active session detected. Backfill existing content, then switch to tail mode.
- **No .jsonl activity for 60 seconds after last event**: Emit `session-idle` event. (Session may have ended; Claude doesn't write an explicit end marker.)

### 2. Backfill (joining mid-session)

When detecting an active session file that already has content:

1. Read entire file content up to current byte offset
2. Split by newlines, parse each complete JSON line
3. Extract tool_use blocks from assistant messages
4. Match against ecosystem patterns (see Matching section)
5. Emit events with `backfill: true` flag (so renderer can batch-render without animations)
6. Record final byte offset
7. Switch to tail mode from that offset

### 3. Tail Mode

On each chokidar `change` event for the active session file:

1. Read file from last recorded byte offset to end
2. Append new bytes to line buffer
3. Extract complete lines (ending with newline)
4. Clear extracted lines from buffer (keep any incomplete trailing content)
5. Parse each complete line as JSON
6. If line contains assistant message with tool_use content blocks, extract and match
7. Emit events with `backfill: false`
8. Update byte offset

### 4. Ecosystem Pattern Matching

Extract `tool_use` blocks from assistant message content arrays. Match by tool name:

| Pattern | Node Type | Extracted Data |
|---------|-----------|---------------|
| `name === "Skill"` | `skill` | `input.skill` (skill name), `input.args` |
| `name === "Agent"` | `agent` or `subagent` | `input.description`, `input.subagent_type`, `input.model`, `input.prompt` (first 200 chars) |
| `name.startsWith("mcp__")` | `mcp` | Server name (second segment of `mcp__server__tool`), tool name (third segment) |

**Command detection**: In Claude Code, slash commands are implemented as `Skill` tool invocations where `input.skill` contains the command name (e.g., `input.skill === "commit"` for `/commit`). Commands are not a separate tool_use pattern. They appear as skill invocations and are displayed as skill nodes. If future distinction is needed, the skill node can show a "/" prefix badge when the invocation originated from a slash command context.

**Subagent detection**: When an `Agent` tool_use is found, emit as `subagent` type with a `parentId` referencing the current session. If the Agent tool's `input.name` field is set, use it as the display name.

**Subagent tracking scope**: For the initial implementation, subagent visualization is limited to the spawn event. The graph shows that an agent was dispatched (name, description, model) but does not tail the subagent's own JSONL file. The "tool calls" count shown on agent nodes reflects the number of times that agent type was dispatched, not the internal tool calls within the subagent session. Multi-file tailing is deferred to future extensions.

**Subagent fan-out (teams/council)**: When multiple Agent tool_use blocks appear in the same assistant message (parallel dispatch), group them with a shared `teamId`. The activity feed shows "5 agents dispatched" and the graph renders all subagent nodes simultaneously with edges from the hub. They cluster in adjacent radial slots.

### 5. Event Types

```typescript
// Discriminated union: element events vs session events

type ActivityEvent = ActivityElementEvent | ActivitySessionEvent

interface ActivityElementEvent {
  readonly id: string
  readonly kind: 'skill-invoked' | 'agent-spawned' | 'subagent-spawned' | 'mcp-called'
  readonly timestamp: number
  readonly backfill: boolean
  readonly name: string
  readonly elementType: ActivityNodeType
  readonly detail: string
  readonly parentId: string | null
  readonly teamId: string | null
}

interface ActivitySessionEvent {
  readonly id: string
  readonly kind: 'session-start' | 'session-idle'
  readonly timestamp: number
  readonly backfill: boolean
}

type ActivityNodeType = 'skill' | 'agent' | 'subagent' | 'mcp'

type ActivityNodeState = 'active' | 'recent' | 'historical'
```

### 6. Activity Node (renderer-only type)

```typescript
interface ActivityNode {
  readonly id: string
  readonly elementType: ActivityNodeType
  readonly name: string
  readonly detail: string
  readonly state: ActivityNodeState
  readonly invocationCount: number
  readonly lastEventTimestamp: number
  readonly parentId: string | null
  readonly teamId: string | null
  readonly position: { x: number; y: number }  // set by radial-layout
}
```

This is not a `CanvasNode`. It is a lightweight, activity-specific type. Size is derived from `state` at render time, not stored as a field.

## Session Hub

The session hub is the visual center of the radial layout. It is **not an interactive terminal**. It is a visual-only indicator showing session status.

### Hub Specification

- **Size**: 160x90px, fixed, centered in viewport
- **Appearance**: Dark background (#0c0c0c), green border (#34d399) when live, gray border (#475569) when idle
- **Content**: Session identifier (truncated JSONL filename), session duration, live/idle indicator with pulsing dot
- **Behavior**: Always present when a session is active. Disappears in empty state. All radial layout positions are computed relative to the hub center.
- **Not interactive**: No terminal input/output. The hub is a status indicator, not an xterm.js instance. Users who want a terminal can use the existing terminal cards in other canvas views.

## Node Types and Visual Treatment

### Agent Node
- **Color**: Purple (`#a78bfa`)
- **Display**: Name, model badge (if available), dispatch count, status indicator
- **Active state**: Purple glow, inner ring
- **Example**: "Explore" agent with "sonnet, dispatched 2x"

### Subagent Node
- **Color**: Purple (`#c084fc`, lighter variant to distinguish from primary agents)
- **Display**: Name or description snippet, parent indicator, status
- **Edge**: Dashed line back to hub (or parent agent if nested)
- **Team behavior**: When multiple subagents share a teamId, they cluster in adjacent radial slots. A subtle arc or bracket groups them visually.
- **Example**: Council spawns 5 subagents: "The Architect", "The Pragmatist", etc. All appear simultaneously in adjacent slots with edges fanning from the hub.

### Skill Node
- **Color**: Cyan (`#22d3ee`)
- **Display**: Name, source (superpowers/user/plugin), trigger context, invocation count
- **Active state**: Cyan glow, inner ring
- **Example**: "brainstorming" skill, "via /brainstorm", invoked 1 time

### MCP Server Node
- **Color**: Amber (`#f59e0b`)
- **Display**: Server name, last tool called, total call count
- **Active state**: Amber glow, inner ring
- **Example**: "notion" MCP, "notion-search", 3 calls

## Radial Layout Algorithm

Pure function: `layoutActivityNodes(nodes, hubCenter, containerSize) -> ActivityNode[]` (with positions set)

### Slot Assignment

1. Partition nodes by state: active, recent, historical
2. **Inner ring** (radius = 150px from hub center): active nodes, evenly distributed around 360 degrees
3. **Outer ring** (radius = 260px from hub center): recent and historical nodes
4. Within each ring, nodes are placed at evenly-spaced angular positions starting from 12 o'clock (top), proceeding clockwise
5. When a node transitions from active to recent, it animates from its inner ring slot to the next available outer ring slot
6. **Subagent clustering**: Nodes sharing a teamId are assigned to adjacent angular slots. The team occupies a contiguous arc.

### Slot Sizing (derived from state at render time)

- Active nodes: 130x55px
- Recent nodes: 120x50px
- Historical nodes: 110x45px

These sizes are used by ActivityNodeCard at render time based on `node.state`. They are not stored on the node.

### Edge Rendering

- All edges connect from node to session hub (or to parent agent for subagents)
- Active edges: dashed, animated stroke-dashoffset (flowing toward hub)
- Recent edges: solid, reduced opacity
- Historical edges: solid, very low opacity
- Subagent edges: dashed, lighter purple, flow from hub (or parent node if nested)

## State Transitions

### Node States

| State | Trigger | Visual | Ring |
|-------|---------|--------|------|
| Active | Event received for this element | Glowing border, full opacity, type color | Inner |
| Recent | No event for 30 seconds | Dimmed, border becomes gray, type color on left border only | Outer |
| Historical | No event for 2 minutes | Faint, gray borders, reduced size | Outer |

### Session States

| State | Trigger | Graph Behavior |
|-------|---------|---------------|
| No session | No active JSONL file | Empty state: invitation message at center |
| Backfilling | Active file detected, reading existing content | Nodes appear without animation, batch render |
| Live | Tailing active file | Nodes animate in, edges pulse, feed scrolls |
| Idle | No events for 60 seconds | Live indicator dims, "Session may have ended" label |

## Activity Feed

Scrolling panel (180px wide, right side of canvas). Shows events in reverse chronological order (newest at top).

### Feed Entry Format

```
● [element name] [action verb]              <- colored by type
  [context line: description/trigger/tool]   <- gray, 1 line
  [relative timestamp]                       <- faint
```

### Examples

```
● Explore spawned                            <- purple
  Deep codebase analysis agent               <- gray
  12s ago                                    <- faint

● 5 agents dispatched                        <- purple
  The Architect, Pragmatist, User Advocate...
  18s ago

● brainstorming invoked                      <- cyan
  via /brainstorm command                    <- gray
  45s ago                                    <- faint

● notion connected                           <- amber
  mcp: notion-search, 3 calls               <- gray
  1m ago                                     <- faint
```

### Feed Behavior

- Maximum 50 visible entries (older entries scroll off)
- New entries slide in from top with subtle animation
- Backfill entries appear without animation
- Clicking a feed entry highlights the corresponding node on the graph

## Empty State

When no Claude session is detected:

```
┌─────────────────────────────────────────────┐
│                                             │
│                                             │
│            ◎ Activity Graph                 │
│                                             │
│     Start a Claude session in this          │
│     project to see your ecosystem           │
│     in action.                              │
│                                             │
│     Skills, agents, MCP servers, and        │
│     commands will appear here as            │
│     Claude invokes them.                    │
│                                             │
│            [ Cmd+Shift+L ]                  │
│                                             │
└─────────────────────────────────────────────┘
```

Centered vertically, subtle text, matching the app's design language. No hub visible until a session is detected.

## Resource Management

### File Watcher Lifecycle

- `activity:watch-start` creates a chokidar watcher on the project session directory. Only one watcher can be active at a time. Starting a new watch implicitly stops the previous one.
- `activity:watch-stop` disposes the chokidar watcher, clears the line buffer, resets the byte offset, and releases the file handle.
- `ActivityGraphPanel` calls `activity:watch-stop` in its unmount cleanup (same pattern as ProjectCanvasPanel calling `project:watch-stop`).

### Memory Bounds

- The line buffer holds only the incomplete trailing content from the last read (typically 0 to a few KB). It is flushed after each successful parse cycle.
- Byte offset tracking means only new bytes are read on each change event. The parser never re-reads the full file after backfill.
- The activity-graph-store holds ActivityNode objects in memory. At the scope of ecosystem-only events (skills, agents, MCPs), a typical session produces 10-50 nodes. No memory pressure concern.
- Feed entries are capped at 50. Older entries are dropped.

### Error Handling

- Malformed JSONL lines are skipped (same pattern as ProjectSessionParser).
- If the watched file is deleted mid-session, the parser emits `session-idle` and waits for the next file.
- If the project session directory doesn't exist, `watch-start` creates the watcher anyway (chokidar handles missing directories gracefully). The watcher fires when the directory is created.

## Keyboard Shortcut

- `Cmd+Shift+L` toggles the Activity Graph view (L for Live)
- Follows the same pattern as Cmd+Shift+C (Config Canvas) and Cmd+Shift+P (Project Canvas)

## Testing Strategy

### Unit Tests
- SessionTailParser: backfill parsing, incremental tailing, partial line buffering, ecosystem pattern matching, session boundary detection, subagent team grouping, malformed line handling
- radial-layout.ts: slot assignment, state-based ring placement, subagent clustering, edge position computation, empty/single/many node edge cases
- ActivityEvent extraction: skill/agent/subagent/mcp discrimination from tool_use blocks, parallel dispatch team detection

### Integration Tests
- IPC round-trip: activity:watch-start -> file modification -> activity:event received in renderer
- Store restore: activity graph state survives view toggle (activity -> vault -> activity)
- Backfill + live transition: join mid-session, verify historical nodes appear then live events flow

### Visual Verification
- Run the app, start a Claude session, and visually confirm nodes appear, glow, transition states, and edges render correctly. Screenshot key states (empty, backfill, live, idle). Per project convention: always run and verify visually, don't rely on code-only gates.

## Future Extensions (not in scope)

- Multi-terminal: multiple session hubs on the same canvas, each with its own activity subgraph
- Drag-and-drop orchestration: user drags a skill onto a terminal to invoke it
- Historical session browser: pick a past session to replay its activity graph
- Config Canvas cross-reference: click an activity node to jump to its Config Canvas card
- Subagent deep tracking: tail subagent JSONL files to show their internal tool_use activity
- Agent tree view: hierarchical visualization of agent -> subagent -> sub-subagent spawn chains
