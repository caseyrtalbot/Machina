# Live Activity Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time canvas view that visualizes which skills, agents, subagents, and MCP servers Claude is using during a session, powered by an incremental JSONL tail parser.

**Architecture:** Two-layer system. Main process: `SessionTailParser` watches JSONL session files, detects ecosystem tool_use blocks (Skill, Agent, mcp__*), and emits typed events via IPC. Renderer: `ActivityGraphPanel` renders nodes in a radial slot layout around a session hub, with state transitions (active/recent/historical) and a rich activity feed. Activity nodes use their own lightweight type system, not CanvasNode.

**Tech Stack:** TypeScript, Electron (main + renderer), chokidar (file watching), Zustand (state), React 18, Tailwind v4, CSS animations.

**Spec:** `docs/superpowers/specs/2026-03-19-live-activity-graph-design.md`

---

## File Map

### New Files (14)

| File | Responsibility |
|------|---------------|
| `src/shared/activity-types.ts` | Discriminated union event types, ActivityNode, ActivityNodeType, ActivityNodeState |
| `src/main/services/session-tail-parser.ts` | Chokidar watcher + incremental JSONL parser + ecosystem pattern matching |
| `src/main/ipc/activity.ts` | IPC handler registration: watch-start, watch-stop, event emission |
| `tests/services/session-tail-parser.test.ts` | Unit tests for tail parser: backfill, tailing, matching, boundaries |
| `tests/renderer/radial-layout.test.ts` | Unit tests for layout: slots, rings, clustering, overflow |
| `tests/renderer/activity-event-matching.test.ts` | Unit tests for ecosystem pattern extraction from tool_use blocks |
| `src/renderer/src/store/activity-graph-store.ts` | Zustand store: ActivityNode array, session state, feed entries (ephemeral) |
| `src/renderer/src/panels/activity-graph/radial-layout.ts` | Pure function: dynamic ring assignment, slot positions, subagent clustering |
| `src/renderer/src/hooks/useActivityStream.ts` | IPC subscription hook: events -> store updates, state transitions |
| `src/renderer/src/panels/activity-graph/ActivityNodeCard.tsx` | Lightweight card: name, type badge, state glow, invocation count |
| `src/renderer/src/panels/activity-graph/SessionHub.tsx` | Visual center: session id, duration, live/idle indicator |
| `src/renderer/src/panels/activity-graph/ActivityFeed.tsx` | Scrolling feed panel: rich entries, truncation, highlight on click |
| `src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx` | Top-level panel: toolbar, empty state, hub + nodes + edges + feed |
| `src/renderer/src/panels/activity-graph/activity-graph.css` | Glow animations, state transitions, feed slide-in |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/shared/ipc-channels.ts` | Add activity channels to IpcChannels + IpcEvents |
| `src/preload/index.ts` | Add `activity` namespace + `on.activityEvent` |
| `src/renderer/src/store/view-store.ts` | Add `activity-graph` to ContentView, add `toggleActivityGraph()` |
| `src/renderer/src/App.tsx` | Render ActivityGraphPanel + Cmd+Shift+L shortcut |
| `src/main/index.ts` | Register activity IPC, add lifecycle cleanup |

---

## Task 1: Shared Types

**Files:**
- Create: `src/shared/activity-types.ts`

- [ ] **Step 1: Create activity-types.ts with all type definitions**

```typescript
// src/shared/activity-types.ts

// Note: All Agent tool_use blocks emit as 'subagent'. No separate 'agent' type needed for MVP.
export type ActivityNodeType = 'skill' | 'subagent' | 'mcp'

export type ActivityNodeState = 'active' | 'recent' | 'historical'

export type ActivityEventKind =
  | 'skill-invoked'
  | 'agent-spawned'
  | 'subagent-spawned'
  | 'mcp-called'
  | 'session-start'
  | 'session-idle'

export type ActivityEvent = ActivityElementEvent | ActivitySessionEvent

export interface ActivityElementEvent {
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

export interface ActivitySessionEvent {
  readonly id: string
  readonly kind: 'session-start' | 'session-idle'
  readonly timestamp: number
  readonly backfill: boolean
  readonly sessionFile: string | null  // JSONL filename for hub display
}

export interface ActivityNode {
  readonly id: string
  readonly elementType: ActivityNodeType
  readonly name: string
  readonly detail: string
  readonly state: ActivityNodeState
  readonly invocationCount: number
  readonly lastEventTimestamp: number
  readonly parentId: string | null
  readonly teamId: string | null
  readonly position: { readonly x: number; readonly y: number }
  readonly backfill: boolean  // true = appeared via backfill, skip entry animations
}

export type SessionState = 'none' | 'backfilling' | 'live' | 'idle'

export interface ActivityFeedEntry {
  readonly id: string
  readonly kind: ActivityEventKind
  readonly name: string
  readonly detail: string
  readonly elementType: ActivityNodeType | null
  readonly timestamp: number
  readonly teamSize: number | null
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/activity-types.ts
git commit -m "feat: add shared type definitions for Live Activity Graph"
```

---

## Task 2: IPC Channel Definitions

**Files:**
- Modify: `src/shared/ipc-channels.ts` (add after project channels ~line 53, and to IpcEvents ~line 84)
- Modify: `src/preload/index.ts` (add activity namespace after claude ~line 58, add to on namespace ~line 85)

- [ ] **Step 1: Add ActivityEvent import and activity channels to ipc-channels.ts**

Add import at the top of ipc-channels.ts:
```typescript
import type { ActivityEvent } from './activity-types'
```

Add to IpcChannels interface (after the project channels):
```typescript
  // Activity Graph
  'activity:watch-start': { request: { projectPath: string }; response: void }
  'activity:watch-stop': { request: void; response: void }
```

Add to IpcEvents interface:
```typescript
  'activity:event': ActivityEvent
```

- [ ] **Step 2: Add activity namespace to preload/index.ts**

Add after the `claude` namespace (~line 58):
```typescript
  activity: {
    watchStart: (projectPath: string) =>
      typedInvoke('activity:watch-start', { projectPath }),
    watchStop: () => typedInvoke('activity:watch-stop'),
  },
```

Add to the `on` namespace (~line 85):
```typescript
    activityEvent: (callback: (event: ActivityEvent) => void) =>
      typedOn('activity:event', callback),
```

Add the import for ActivityEvent at the top:
```typescript
import type { ActivityEvent } from '@shared/activity-types'
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/preload/index.ts
git commit -m "feat: add activity IPC channels and preload bridge"
```

---

## Task 3: Ecosystem Pattern Matching (TDD)

This is the core extraction logic. Build and test it as a pure function before wiring into the parser.

**Files:**
- Create: `tests/renderer/activity-event-matching.test.ts`
- Add matching logic inside: `src/main/services/session-tail-parser.ts` (exported for testing)

- [ ] **Step 1: Write failing tests for ecosystem pattern extraction**

```typescript
// tests/renderer/activity-event-matching.test.ts
import { describe, it, expect } from 'vitest'
import { extractEcosystemEvents } from '../../src/main/services/session-tail-parser'

describe('extractEcosystemEvents', () => {
  it('extracts skill invocation from Skill tool_use', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'tool_1',
      name: 'Skill',
      input: { skill: 'brainstorming', args: '--quick' },
    }
    const events = extractEcosystemEvents([toolUse], Date.now(), false)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('skill-invoked')
    expect(events[0].name).toBe('brainstorming')
    expect(events[0].elementType).toBe('skill')
  })

  it('extracts agent spawn from Agent tool_use', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'tool_2',
      name: 'Agent',
      input: {
        description: 'Explore codebase',
        subagent_type: 'Explore',
        model: 'sonnet',
        prompt: 'Analyze the canvas infrastructure...',
      },
    }
    const events = extractEcosystemEvents([toolUse], Date.now(), false)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('subagent-spawned')
    expect(events[0].elementType).toBe('subagent')
    expect(events[0].name).toBe('Explore')
  })

  it('extracts MCP call from mcp__ prefixed tool_use', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'tool_3',
      name: 'mcp__claude_ai_Notion__notion-search',
      input: { query: 'test' },
    }
    const events = extractEcosystemEvents([toolUse], Date.now(), false)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('mcp-called')
    expect(events[0].elementType).toBe('mcp')
    expect(events[0].name).toBe('claude_ai_Notion')
    expect(events[0].detail).toContain('notion-search')
  })

  it('ignores non-ecosystem tools (Read, Write, Edit, Bash, etc.)', () => {
    const toolUses = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/foo' } },
      { type: 'tool_use', id: 't2', name: 'Write', input: {} },
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 't4', name: 'Grep', input: {} },
    ]
    const events = extractEcosystemEvents(toolUses, Date.now(), false)
    expect(events).toHaveLength(0)
  })

  it('groups parallel Agent dispatches with shared teamId', () => {
    const toolUses = [
      { type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Architect', subagent_type: 'general-purpose' } },
      { type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'Pragmatist', subagent_type: 'general-purpose' } },
      { type: 'tool_use', id: 't3', name: 'Agent', input: { description: 'Skeptic', subagent_type: 'general-purpose' } },
    ]
    const events = extractEcosystemEvents(toolUses, Date.now(), false)
    expect(events).toHaveLength(3)
    const teamId = events[0].teamId
    expect(teamId).toBeTruthy()
    expect(events.every((e) => e.teamId === teamId)).toBe(true)
  })

  it('uses input.name as display name when available', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'tool_1',
      name: 'Agent',
      input: { description: 'Deep analysis', name: 'analyzer-1', subagent_type: 'Explore' },
    }
    const events = extractEcosystemEvents([toolUse], Date.now(), false)
    expect(events[0].name).toBe('analyzer-1')
  })

  it('sets backfill flag from parameter', () => {
    const toolUse = { type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'commit' } }
    const events = extractEcosystemEvents([toolUse], Date.now(), true)
    expect(events[0].backfill).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/activity-event-matching.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement extractEcosystemEvents**

Create `src/main/services/session-tail-parser.ts` with the exported extraction function first (parser class comes in Task 4):

```typescript
// src/main/services/session-tail-parser.ts
import { randomUUID } from 'node:crypto'
import type { ActivityElementEvent, ActivityNodeType } from '../../shared/activity-types'

interface ToolUseBlock {
  type: string
  id: string
  name: string
  input: Record<string, unknown>
}

export function extractEcosystemEvents(
  toolUses: ToolUseBlock[],
  timestamp: number,
  backfill: boolean,
): ActivityElementEvent[] {
  const events: ActivityElementEvent[] = []

  // Detect parallel agent dispatches for team grouping
  const agentBlocks = toolUses.filter((t) => t.name === 'Agent')
  const teamId = agentBlocks.length > 1 ? randomUUID() : null

  for (const block of toolUses) {
    if (block.name === 'Skill') {
      const skillName = String(block.input.skill ?? '')
      if (!skillName) continue
      events.push({
        id: randomUUID(),
        kind: 'skill-invoked',
        timestamp,
        backfill,
        name: skillName,
        elementType: 'skill',
        detail: block.input.args ? `args: ${String(block.input.args).slice(0, 100)}` : '',
        parentId: null,
        teamId: null,
      })
    } else if (block.name === 'Agent') {
      const inputName = block.input.name ? String(block.input.name) : null
      const subagentType = block.input.subagent_type ? String(block.input.subagent_type) : null
      const description = block.input.description ? String(block.input.description).slice(0, 200) : ''
      const displayName = inputName ?? subagentType ?? description.slice(0, 30) || 'unnamed agent'

      events.push({
        id: randomUUID(),
        kind: 'subagent-spawned',
        timestamp,
        backfill,
        name: displayName,
        elementType: 'subagent',
        detail: description,
        parentId: null,
        teamId,
      })
    } else if (block.name.startsWith('mcp__')) {
      const segments = block.name.split('__')
      const serverName = segments[1] ?? 'unknown'
      const toolName = segments.slice(2).join('__')

      events.push({
        id: randomUUID(),
        kind: 'mcp-called',
        timestamp,
        backfill,
        name: serverName,
        elementType: 'mcp',
        detail: toolName,
        parentId: null,
        teamId: null,
      })
    }
    // All other tools (Read, Write, Edit, Bash, Grep, Glob, etc.) are ignored
  }

  return events
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/activity-event-matching.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/session-tail-parser.ts tests/renderer/activity-event-matching.test.ts
git commit -m "feat: add ecosystem pattern matching with tests"
```

---

## Task 4: Session Tail Parser (TDD)

**Files:**
- Modify: `src/main/services/session-tail-parser.ts` (add SessionTailParser class)
- Create: `tests/services/session-tail-parser.test.ts`

- [ ] **Step 1: Write failing tests for SessionTailParser**

```typescript
// tests/services/session-tail-parser.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, appendFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionTailParser } from '../../src/main/services/session-tail-parser'
import type { ActivityEvent } from '../../src/shared/activity-types'

describe('SessionTailParser', () => {
  let tempDir: string
  let parser: SessionTailParser
  let receivedEvents: ActivityEvent[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tail-parser-'))
    parser = new SessionTailParser()
    receivedEvents = []
  })

  afterEach(async () => {
    await parser.stop()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits session-start when new JSONL file appears', async () => {
    await parser.start(tempDir, (event) => receivedEvents.push(event))

    // Create a new session file
    const sessionFile = join(tempDir, 'test-session.jsonl')
    await writeFile(sessionFile, '')

    // Wait for chokidar to detect
    await sleep(500)
    expect(receivedEvents.some((e) => e.kind === 'session-start')).toBe(true)
  })

  it('backfills existing content from active session file', async () => {
    const sessionFile = join(tempDir, 'existing-session.jsonl')
    const jsonlLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'brainstorming' } },
        ],
      },
      timestamp: new Date().toISOString(),
    })
    await writeFile(sessionFile, jsonlLine + '\n')

    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await sleep(500)

    const skillEvents = receivedEvents.filter((e) => e.kind === 'skill-invoked')
    expect(skillEvents.length).toBeGreaterThanOrEqual(1)
    expect(skillEvents[0].backfill).toBe(true)
  })

  it('tails new lines appended to active session file', async () => {
    const sessionFile = join(tempDir, 'live-session.jsonl')
    await writeFile(sessionFile, '')
    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await sleep(500)

    // Clear session-start events
    receivedEvents = []

    // Append a new line with a skill invocation
    const newLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'writing-plans' } },
        ],
      },
      timestamp: new Date().toISOString(),
    })
    await appendFile(sessionFile, newLine + '\n')
    await sleep(600)

    const skillEvents = receivedEvents.filter((e) => e.kind === 'skill-invoked')
    expect(skillEvents.length).toBeGreaterThanOrEqual(1)
    expect(skillEvents[0].backfill).toBe(false)
    expect(skillEvents[0].name).toBe('writing-plans')
  })

  it('skips malformed JSONL lines gracefully', async () => {
    const sessionFile = join(tempDir, 'bad-session.jsonl')
    await writeFile(sessionFile, 'not valid json\n{"also": "incomplete\n')
    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await sleep(500)

    // Should not crash, may emit session-start but no element events
    const elementEvents = receivedEvents.filter(
      (e) => e.kind !== 'session-start' && e.kind !== 'session-idle',
    )
    expect(elementEvents).toHaveLength(0)
  })

  it('handles partial lines in buffer correctly', async () => {
    const sessionFile = join(tempDir, 'partial-session.jsonl')
    await writeFile(sessionFile, '')
    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await sleep(500)
    receivedEvents = []

    // Write a partial line (no newline)
    const partialLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't3', name: 'mcp__notion__search', input: {} },
        ],
      },
      timestamp: new Date().toISOString(),
    })
    await appendFile(sessionFile, partialLine)
    await sleep(600)

    // No event yet (line incomplete)
    expect(receivedEvents.filter((e) => e.kind === 'mcp-called')).toHaveLength(0)

    // Complete the line
    await appendFile(sessionFile, '\n')
    await sleep(600)

    // Now the event should fire
    expect(receivedEvents.filter((e) => e.kind === 'mcp-called')).toHaveLength(1)
  })

  it('clears state on stop()', async () => {
    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await parser.stop()

    // Parser should be safe to start again
    await parser.start(tempDir, (event) => receivedEvents.push(event))
    await parser.stop()
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/services/session-tail-parser.test.ts`
Expected: FAIL (SessionTailParser not found or methods missing)

- [ ] **Step 3: Implement SessionTailParser class**

Add to `src/main/services/session-tail-parser.ts`. **Merge all imports at the top of the file** (Task 3 created the file with `randomUUID` and activity type imports). The complete import block after this task:

```typescript
// src/main/services/session-tail-parser.ts — COMPLETE IMPORTS (merged from Task 3 + 4)
import { randomUUID } from 'node:crypto'
import { readFile, stat, open, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { watch, type FSWatcher } from 'chokidar'
import type { ActivityEvent, ActivityElementEvent, ActivitySessionEvent } from '../../shared/activity-types'
```

Then add the class below `extractEcosystemEvents`:

```typescript
const IDLE_CHECK_INTERVAL_MS = 30_000
const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes of no file writes

type ActivityCallback = (event: ActivityEvent) => void

export class SessionTailParser {
  private watcher: FSWatcher | null = null
  private activeFile: string | null = null
  private byteOffset = 0
  private lineBuffer = ''
  private callback: ActivityCallback | null = null
  private lastFileModTime = 0
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private isIdle = false

  async start(projectPath: string, onEvent: ActivityCallback): Promise<void> {
    await this.stop()
    this.callback = onEvent

    // Derive Claude session directory from project path
    // Same encoding as ProjectSessionParser.toDirKey()
    const dirKey = projectPath.replace(/\//g, '-')
    const dirPath = join(homedir(), '.claude', 'projects', dirKey)

    this.watcher = watch(dirPath, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    })

    this.watcher
      .on('add', (filePath: string) => {
        if (!filePath.endsWith('.jsonl')) return
        this.handleNewFile(filePath)
      })
      .on('change', (filePath: string) => {
        if (!filePath.endsWith('.jsonl')) return
        this.lastFileModTime = Date.now()
        if (this.isIdle) {
          this.isIdle = false
          // Session resumed — no need to re-emit session-start
        }
        if (filePath === this.activeFile) {
          this.tailFile(filePath)
        } else if (!this.activeFile) {
          this.handleNewFile(filePath)
        }
      })
      .on('error', (err: Error) => console.error('Activity watcher error:', err))

    // Idle detection: check file modification time periodically
    this.idleTimer = setInterval(() => {
      if (!this.activeFile || this.isIdle) return
      if (this.lastFileModTime > 0 && Date.now() - this.lastFileModTime > IDLE_THRESHOLD_MS) {
        this.isIdle = true
        this.emit({
          id: randomUUID(),
          kind: 'session-idle',
          timestamp: Date.now(),
          backfill: false,
          sessionFile: this.activeFile ? basename(this.activeFile) : null,
        })
      }
    }, IDLE_CHECK_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    this.activeFile = null
    this.byteOffset = 0
    this.lineBuffer = ''
    this.callback = null
    this.lastFileModTime = 0
    this.isIdle = false
  }

  private async handleNewFile(filePath: string): Promise<void> {
    this.activeFile = filePath
    this.byteOffset = 0
    this.lineBuffer = ''
    this.lastFileModTime = Date.now()
    this.isIdle = false

    this.emit({
      id: randomUUID(),
      kind: 'session-start',
      timestamp: Date.now(),
      backfill: false,
      sessionFile: basename(filePath),
    })

    await this.backfill(filePath)
  }

  private async backfill(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath)
      if (fileStat.size === 0) return

      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      for (const line of lines) {
        if (!line.trim()) continue
        this.processLine(line, true)
      }

      this.byteOffset = Buffer.byteLength(content, 'utf-8')
    } catch {
      // File may not exist yet or be empty
    }
  }

  private async tailFile(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath)
      if (fileStat.size <= this.byteOffset) return

      const fh: FileHandle = await open(filePath, 'r')
      try {
        const buf = Buffer.alloc(fileStat.size - this.byteOffset)
        await fh.read(buf, 0, buf.length, this.byteOffset)
        this.byteOffset = fileStat.size

        const newContent = buf.toString('utf-8')
        this.lineBuffer += newContent

        const lines = this.lineBuffer.split('\n')
        this.lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          this.processLine(line, false)
        }
      } finally {
        await fh.close()
      }
    } catch {
      // File read error during tail
    }
  }

  private processLine(line: string, backfill: boolean): void {
    try {
      const entry = JSON.parse(line)
      const message = entry.message ?? entry
      if (message.role !== 'assistant') return

      const content = message.content
      if (!Array.isArray(content)) return

      const toolUses = content.filter(
        (block: { type?: string }) => block.type === 'tool_use',
      )
      if (toolUses.length === 0) return

      const timestamp = entry.timestamp
        ? new Date(entry.timestamp).getTime()
        : Date.now()

      const events = extractEcosystemEvents(toolUses, timestamp, backfill)
      for (const event of events) {
        this.emit(event)
      }
    } catch {
      // Malformed JSON line — skip
    }
  }

  private emit(event: ActivityEvent): void {
    this.callback?.(event)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/services/session-tail-parser.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/session-tail-parser.ts tests/services/session-tail-parser.test.ts
git commit -m "feat: add SessionTailParser with incremental JSONL tailing"
```

---

## Task 5: IPC Handlers + Main Process Registration

**Files:**
- Create: `src/main/ipc/activity.ts`
- Modify: `src/main/index.ts` (add import, registration, lifecycle cleanup)

- [ ] **Step 1: Create activity IPC handler**

```typescript
// src/main/ipc/activity.ts
import type { BrowserWindow } from 'electron'
import { SessionTailParser } from '../services/session-tail-parser'
import { typedHandle } from '../typed-ipc'
import { typedSend } from '../typed-ipc'

const parser = new SessionTailParser()

export function registerActivityIpc(mainWindow: BrowserWindow): void {
  typedHandle('activity:watch-start', async (args) => {
    await parser.start(args.projectPath, (event) => {
      typedSend(mainWindow, 'activity:event', event)
    })
  })

  typedHandle('activity:watch-stop', async () => {
    await parser.stop()
  })
}

export function getActivityParser(): SessionTailParser {
  return parser
}
```

- [ ] **Step 2: Register in main/index.ts**

Add import (after existing IPC imports ~line 11):
```typescript
import { registerActivityIpc, getActivityParser } from './ipc/activity'
```

Add registration (after `registerProjectIpc(window)` ~line 110):
```typescript
registerActivityIpc(window)
```

Add lifecycle cleanup (in `before-quit` handler ~line 119):
```typescript
getActivityParser().stop()
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/activity.ts src/main/index.ts
git commit -m "feat: wire activity IPC handlers and lifecycle cleanup"
```

---

## Task 6: Radial Layout Algorithm (TDD)

**Files:**
- Create: `tests/renderer/radial-layout.test.ts`
- Create: `src/renderer/src/panels/activity-graph/radial-layout.ts`

- [ ] **Step 1: Write failing tests for radial layout**

```typescript
// tests/renderer/radial-layout.test.ts
import { describe, it, expect } from 'vitest'
import {
  layoutActivityNodes,
  type LayoutInput,
} from '../../src/renderer/src/panels/activity-graph/radial-layout'

function makeNode(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    id: overrides.id ?? 'node-1',
    state: overrides.state ?? 'active',
    teamId: overrides.teamId ?? null,
    ...overrides,
  }
}

describe('layoutActivityNodes', () => {
  const hubCenter = { x: 400, y: 300 }
  const availableSize = { width: 800, height: 600 }

  it('returns empty array for no nodes', () => {
    const result = layoutActivityNodes([], hubCenter, availableSize)
    expect(result).toHaveLength(0)
  })

  it('places a single active node at 12 o\'clock (top)', () => {
    const nodes = [makeNode({ id: 'a', state: 'active' })]
    const result = layoutActivityNodes(nodes, hubCenter, availableSize)
    expect(result).toHaveLength(1)
    expect(result[0].x).toBeCloseTo(hubCenter.x, -1)
    expect(result[0].y).toBeLessThan(hubCenter.y) // above center
  })

  it('distributes multiple active nodes evenly around the ring', () => {
    const nodes = [
      makeNode({ id: 'a', state: 'active' }),
      makeNode({ id: 'b', state: 'active' }),
      makeNode({ id: 'c', state: 'active' }),
      makeNode({ id: 'd', state: 'active' }),
    ]
    const result = layoutActivityNodes(nodes, hubCenter, availableSize)
    expect(result).toHaveLength(4)

    // All should be roughly equidistant from center
    const distances = result.map((r) =>
      Math.sqrt((r.x - hubCenter.x) ** 2 + (r.y - hubCenter.y) ** 2),
    )
    const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length
    for (const d of distances) {
      expect(d).toBeCloseTo(avgDist, -1)
    }
  })

  it('places recent/historical nodes in outer ring when node count > 8', () => {
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => makeNode({ id: `a${i}`, state: 'active' })),
      ...Array.from({ length: 5 }, (_, i) => makeNode({ id: `r${i}`, state: 'recent' })),
    ]
    const result = layoutActivityNodes(nodes, hubCenter, availableSize)

    const activePositions = result.filter((_, i) => nodes[i].state === 'active')
    const recentPositions = result.filter((_, i) => nodes[i].state === 'recent')

    const avgActiveDist = avg(activePositions.map((p) => dist(p, hubCenter)))
    const avgRecentDist = avg(recentPositions.map((p) => dist(p, hubCenter)))

    expect(avgRecentDist).toBeGreaterThan(avgActiveDist)
  })

  it('clusters nodes with same teamId in adjacent slots', () => {
    const nodes = [
      makeNode({ id: 'team-a', state: 'active', teamId: 'council-1' }),
      makeNode({ id: 'team-b', state: 'active', teamId: 'council-1' }),
      makeNode({ id: 'team-c', state: 'active', teamId: 'council-1' }),
      makeNode({ id: 'solo', state: 'active', teamId: null }),
    ]
    const result = layoutActivityNodes(nodes, hubCenter, availableSize)

    // Team members should have similar angular positions (adjacent)
    const teamAngles = result
      .filter((_, i) => nodes[i].teamId === 'council-1')
      .map((p) => Math.atan2(p.y - hubCenter.y, p.x - hubCenter.x))

    // All team angles should be within 90 degrees of each other
    const spread = Math.max(...teamAngles) - Math.min(...teamAngles)
    expect(spread).toBeLessThan(Math.PI / 2)
  })

  it('scales radii proportionally to available size', () => {
    const smallSize = { width: 400, height: 300 }
    const largeSize = { width: 1200, height: 900 }
    const nodes = [makeNode({ id: 'a', state: 'active' })]

    const smallResult = layoutActivityNodes(nodes, hubCenter, smallSize)
    const largeResult = layoutActivityNodes(nodes, hubCenter, largeSize)

    const smallDist = dist(smallResult[0], hubCenter)
    const largeDist = dist(largeResult[0], hubCenter)

    expect(largeDist).toBeGreaterThan(smallDist)
  })
})

function dist(p: { x: number; y: number }, c: { x: number; y: number }): number {
  return Math.sqrt((p.x - c.x) ** 2 + (p.y - c.y) ** 2)
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/radial-layout.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement radial layout**

```typescript
// src/renderer/src/panels/activity-graph/radial-layout.ts

export interface LayoutInput {
  readonly id: string
  readonly state: 'active' | 'recent' | 'historical'
  readonly teamId: string | null
}

interface Position {
  readonly x: number
  readonly y: number
}

interface Size {
  readonly width: number
  readonly height: number
}

const MIN_ANGULAR_GAP_DEG = 25
const RADIUS_FACTOR = 0.42

export function layoutActivityNodes(
  nodes: readonly LayoutInput[],
  hubCenter: Position,
  availableSize: Size,
): Position[] {
  if (nodes.length === 0) return []

  const minDim = Math.min(availableSize.width, availableSize.height)
  const usableRadius = minDim * RADIUS_FACTOR

  // Determine ring count based on total nodes
  const ringCount = nodes.length <= 8 ? 1 : nodes.length <= 20 ? 2 : 3
  const ringGap = usableRadius / ringCount

  // Assign nodes to rings
  const rings: LayoutInput[][] = Array.from({ length: ringCount }, () => [])

  if (ringCount === 1) {
    rings[0] = [...nodes]
  } else {
    // Sort: teams first (clustered), then by state
    const sorted = sortForLayout(nodes)
    for (const node of sorted) {
      const targetRing = getRingForState(node.state, ringCount)
      const maxPerRing = Math.floor(360 / MIN_ANGULAR_GAP_DEG)
      if (rings[targetRing].length < maxPerRing) {
        rings[targetRing].push(node)
      } else {
        // Overflow to next ring outward
        const overflow = Math.min(targetRing + 1, ringCount - 1)
        rings[overflow].push(node)
      }
    }
  }

  // Compute positions
  const positions = new Map<string, Position>()

  for (let ringIdx = 0; ringIdx < ringCount; ringIdx++) {
    const ringNodes = rings[ringIdx]
    if (ringNodes.length === 0) continue

    const radius = (ringIdx + 1) * ringGap
    const angleStep = (2 * Math.PI) / Math.max(ringNodes.length, 1)

    for (let i = 0; i < ringNodes.length; i++) {
      // Start from top (- PI/2), proceed clockwise
      const angle = -Math.PI / 2 + i * angleStep
      positions.set(ringNodes[i].id, {
        x: hubCenter.x + radius * Math.cos(angle),
        y: hubCenter.y + radius * Math.sin(angle),
      })
    }
  }

  // Return in original order
  return nodes.map((n) => positions.get(n.id) ?? hubCenter)
}

function getRingForState(state: string, ringCount: number): number {
  if (ringCount === 1) return 0
  if (ringCount === 2) return state === 'active' ? 0 : 1
  // 3 rings
  if (state === 'active') return 0
  if (state === 'recent') return 1
  return 2
}

function sortForLayout(nodes: readonly LayoutInput[]): LayoutInput[] {
  const sorted = [...nodes]
  sorted.sort((a, b) => {
    // Team members adjacent
    if (a.teamId && b.teamId && a.teamId === b.teamId) return 0
    if (a.teamId && !b.teamId) return -1
    if (!a.teamId && b.teamId) return 1
    // Then by state priority
    const statePriority = { active: 0, recent: 1, historical: 2 }
    return (statePriority[a.state] ?? 2) - (statePriority[b.state] ?? 2)
  })
  return sorted
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/radial-layout.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/activity-graph/radial-layout.ts tests/renderer/radial-layout.test.ts
git commit -m "feat: add radial slot layout algorithm with tests"
```

---

## Task 7: Activity Graph Store (TDD)

**Files:**
- Create: `src/renderer/src/store/activity-graph-store.ts`
- Create: `tests/renderer/activity-graph-store.test.ts`

- [ ] **Step 1: Write failing tests for the store**

```typescript
// tests/renderer/activity-graph-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useActivityGraphStore } from '../../src/renderer/src/store/activity-graph-store'
import type { ActivityNode, ActivityFeedEntry } from '../../src/shared/activity-types'

function makeNode(overrides: Partial<ActivityNode> = {}): ActivityNode {
  return {
    id: 'n1', elementType: 'skill', name: 'brainstorming', detail: '',
    state: 'active', invocationCount: 1, lastEventTimestamp: Date.now(),
    parentId: null, teamId: null, position: { x: 0, y: 0 }, backfill: false,
    ...overrides,
  }
}

function makeFeedEntry(overrides: Partial<ActivityFeedEntry> = {}): ActivityFeedEntry {
  return {
    id: 'f1', kind: 'skill-invoked', name: 'test', detail: '',
    elementType: 'skill', timestamp: Date.now(), teamSize: null,
    ...overrides,
  }
}

describe('useActivityGraphStore', () => {
  beforeEach(() => useActivityGraphStore.getState().clearSession())

  it('upsertNode adds new node', () => {
    useActivityGraphStore.getState().upsertNode(makeNode())
    expect(useActivityGraphStore.getState().nodes).toHaveLength(1)
  })

  it('upsertNode deduplicates by elementType + name', () => {
    useActivityGraphStore.getState().upsertNode(makeNode({ id: 'a' }))
    useActivityGraphStore.getState().upsertNode(makeNode({ id: 'b' }))
    const nodes = useActivityGraphStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].invocationCount).toBe(2)
  })

  it('addFeedEntry caps at 50', () => {
    for (let i = 0; i < 60; i++) {
      useActivityGraphStore.getState().addFeedEntry(makeFeedEntry({ id: `f${i}` }))
    }
    expect(useActivityGraphStore.getState().feedEntries).toHaveLength(50)
  })

  it('clearSession resets all state', () => {
    useActivityGraphStore.getState().upsertNode(makeNode())
    useActivityGraphStore.getState().setSessionState('live')
    useActivityGraphStore.getState().clearSession()
    const s = useActivityGraphStore.getState()
    expect(s.nodes).toHaveLength(0)
    expect(s.feedEntries).toHaveLength(0)
    expect(s.sessionState).toBe('none')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/activity-graph-store.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create the Zustand store**

```typescript
// src/renderer/src/store/activity-graph-store.ts
import { create } from 'zustand'
import type {
  ActivityNode,
  ActivityFeedEntry,
  SessionState,
} from '@shared/activity-types'

const MAX_FEED_ENTRIES = 50

interface ActivityGraphStore {
  readonly nodes: readonly ActivityNode[]
  readonly feedEntries: readonly ActivityFeedEntry[]
  readonly sessionState: SessionState
  readonly sessionStartTime: number | null
  readonly sessionFile: string | null

  setSessionState: (state: SessionState) => void
  setSessionStartTime: (time: number | null) => void
  setSessionFile: (file: string | null) => void
  upsertNode: (node: ActivityNode) => void
  updateNodeState: (id: string, state: ActivityNode['state']) => void
  addFeedEntry: (entry: ActivityFeedEntry) => void
  clearSession: () => void
}

export const useActivityGraphStore = create<ActivityGraphStore>((set, get) => ({
  nodes: [],
  feedEntries: [],
  sessionState: 'none',
  sessionStartTime: null,
  sessionFile: null,

  setSessionState: (sessionState) => set({ sessionState }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  setSessionFile: (sessionFile) => set({ sessionFile }),

  upsertNode: (node) => {
    const existing = get().nodes
    const idx = existing.findIndex(
      (n) => n.elementType === node.elementType && n.name === node.name,
    )
    if (idx >= 0) {
      const updated = [...existing]
      updated[idx] = {
        ...updated[idx],
        state: 'active',
        invocationCount: updated[idx].invocationCount + 1,
        lastEventTimestamp: node.lastEventTimestamp,
        detail: node.detail || updated[idx].detail,
      }
      set({ nodes: updated })
    } else {
      set({ nodes: [...existing, node] })
    }
  },

  updateNodeState: (id, state) => {
    const nodes = get().nodes.map((n) =>
      n.id === id ? { ...n, state } : n,
    )
    set({ nodes })
  },

  addFeedEntry: (entry) => {
    const entries = [entry, ...get().feedEntries].slice(0, MAX_FEED_ENTRIES)
    set({ feedEntries: entries })
  },

  clearSession: () =>
    set({
      nodes: [],
      feedEntries: [],
      sessionState: 'none',
      sessionStartTime: null,
      sessionFile: null,
    }),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/activity-graph-store.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/activity-graph-store.ts tests/renderer/activity-graph-store.test.ts
git commit -m "feat: add ephemeral activity graph Zustand store with tests"
```

---

## Task 8: View Routing

**Files:**
- Modify: `src/renderer/src/store/view-store.ts` (add activity-graph to ContentView, add toggle)
- Modify: `src/renderer/src/App.tsx` (add conditional render + keyboard shortcut)

- [ ] **Step 1: Update view-store.ts**

Add `'activity-graph'` to the ContentView union:
```typescript
export type ContentView = 'editor' | 'canvas' | 'skills' | 'claude-config' | 'project-canvas' | 'activity-graph'
```

Add `toggleActivityGraph` to the interface and implementation (same pattern as toggleProjectCanvas):
```typescript
toggleActivityGraph: () => void
```

Implementation:
```typescript
toggleActivityGraph: () => {
  const current = get().contentView
  if (current === 'activity-graph') {
    const prev = get().previousView ?? 'editor'
    set({ contentView: prev, previousView: 'activity-graph' })
  } else {
    set({ contentView: 'activity-graph', previousView: current })
  }
},
```

- [ ] **Step 2: Update App.tsx**

Add import at the top:
```typescript
import { ActivityGraphPanel } from './panels/activity-graph/ActivityGraphPanel'
```

Add to ContentArea render (after project-canvas conditional):
```typescript
{contentView === 'activity-graph' && <ActivityGraphPanel />}
```

Add keyboard shortcut (in the keydown handler alongside C and P):
```typescript
if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'l') {
  e.preventDefault()
  toggleActivityGraph()
}
```

Add `toggleActivityGraph` to the destructured hooks.

**Note**: ActivityGraphPanel doesn't exist yet. Create a placeholder:

```typescript
// src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx
export function ActivityGraphPanel() {
  return <div className="h-full flex items-center justify-center text-te-text-secondary">Activity Graph (coming soon)</div>
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/view-store.ts src/renderer/src/App.tsx src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx
git commit -m "feat: add activity-graph view routing and Cmd+Shift+L shortcut"
```

---

## Task 9: useActivityStream Hook

**Files:**
- Create: `src/renderer/src/hooks/useActivityStream.ts`

- [ ] **Step 1: Implement the hook**

Note: The renderer passes `vaultPath` (not a computed Claude dir) to `activity:watch-start`. The main process `SessionTailParser` derives the Claude projects directory from the project path, matching the existing pattern in `ProjectSessionParser.parse()`.

```typescript
// src/renderer/src/hooks/useActivityStream.ts
import { useEffect, useRef } from 'react'
import { useActivityGraphStore } from '../store/activity-graph-store'
import type {
  ActivityEvent,
  ActivityElementEvent,
  ActivitySessionEvent,
  ActivityNode,
  ActivityFeedEntry,
  ActivityNodeState,
} from '@shared/activity-types'

const ACTIVE_TO_RECENT_MS = 45_000
const RECENT_TO_HISTORICAL_MS = 180_000
const TRANSITION_INTERVAL_MS = 5_000

export function useActivityStream(
  enabled: boolean,
  vaultPath: string | null,
): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled || !vaultPath) return

    const store = useActivityGraphStore.getState()
    store.clearSession()

    // Pass vaultPath directly — main process derives the Claude session dir
    window.api.activity.watchStart(vaultPath).catch(console.error)

    // Subscribe to events
    const unsub = window.api.on.activityEvent((event: ActivityEvent) => {
      if (event.kind === 'session-start') {
        const sessionEvt = event as ActivitySessionEvent
        useActivityGraphStore.getState().clearSession()
        useActivityGraphStore.getState().setSessionState('live')
        useActivityGraphStore.getState().setSessionStartTime(event.timestamp)
        useActivityGraphStore.getState().setSessionFile(sessionEvt.sessionFile)
        return
      }

      if (event.kind === 'session-idle') {
        useActivityGraphStore.getState().setSessionState('idle')
        return
      }

      // Element event
      const elemEvent = event as ActivityElementEvent
      const node: ActivityNode = {
        id: elemEvent.id,
        elementType: elemEvent.elementType,
        name: elemEvent.name,
        detail: elemEvent.detail,
        state: 'active',
        invocationCount: 1,
        lastEventTimestamp: elemEvent.timestamp,
        parentId: elemEvent.parentId,
        teamId: elemEvent.teamId,
        position: { x: 0, y: 0 },
        backfill: elemEvent.backfill,
      }
      useActivityGraphStore.getState().upsertNode(node)

      // If we were idle, go back to live
      if (useActivityGraphStore.getState().sessionState === 'idle') {
        useActivityGraphStore.getState().setSessionState('live')
      }

      // Add feed entry — aggregate team dispatches
      if (elemEvent.teamId) {
        const { feedEntries } = useActivityGraphStore.getState()
        const topEntry = feedEntries[0]
        // If the most recent feed entry is from the same team dispatch, update count
        if (topEntry?.kind === 'subagent-spawned' && topEntry.teamSize !== null) {
          const newCount = (topEntry.teamSize ?? 1) + 1
          const updatedEntry: ActivityFeedEntry = {
            ...topEntry,
            teamSize: newCount,
            name: `${newCount} agents dispatched`,
            detail: `${topEntry.detail}, ${elemEvent.name}`.slice(0, 80),
          }
          // Replace top entry with updated team entry
          const updatedEntries = [updatedEntry, ...feedEntries.slice(1)]
          // Use store setState directly for feed-only update
          useActivityGraphStore.setState({ feedEntries: updatedEntries.slice(0, 50) })
        } else {
          // First agent in a new team dispatch
          const feedEntry: ActivityFeedEntry = {
            id: elemEvent.id,
            kind: elemEvent.kind,
            name: elemEvent.name,
            detail: elemEvent.detail,
            elementType: elemEvent.elementType,
            timestamp: elemEvent.timestamp,
            teamSize: 1,
          }
          useActivityGraphStore.getState().addFeedEntry(feedEntry)
        }
      } else {
        const feedEntry: ActivityFeedEntry = {
          id: elemEvent.id,
          kind: elemEvent.kind,
          name: elemEvent.name,
          detail: elemEvent.detail,
          elementType: elemEvent.elementType,
          timestamp: elemEvent.timestamp,
          teamSize: null,
        }
        useActivityGraphStore.getState().addFeedEntry(feedEntry)
      }
    })

    // State transition timer (relative staleness)
    timerRef.current = setInterval(() => {
      const { nodes } = useActivityGraphStore.getState()
      const now = Date.now()
      const sessionIsQuiet = nodes.every(
        (n) => now - n.lastEventTimestamp > 10_000,
      )

      for (const node of nodes) {
        if (sessionIsQuiet) continue // hold state during thinking pauses

        const elapsed = now - node.lastEventTimestamp
        let newState: ActivityNodeState = node.state

        if (elapsed > RECENT_TO_HISTORICAL_MS && node.state !== 'historical') {
          newState = 'historical'
        } else if (elapsed > ACTIVE_TO_RECENT_MS && node.state === 'active') {
          newState = 'recent'
        }

        if (newState !== node.state) {
          useActivityGraphStore.getState().updateNodeState(node.id, newState)
        }
      }
    }, TRANSITION_INTERVAL_MS)

    return () => {
      unsub()
      window.api.activity.watchStop().catch(() => {})
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled, vaultPath])
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useActivityStream.ts
git commit -m "feat: add useActivityStream hook for IPC subscription and state transitions"
```

---

## Task 10: UI Components

**Files:**
- Create: `src/renderer/src/panels/activity-graph/SessionHub.tsx`
- Create: `src/renderer/src/panels/activity-graph/ActivityNodeCard.tsx`
- Create: `src/renderer/src/panels/activity-graph/ActivityFeed.tsx`
- Create: `src/renderer/src/panels/activity-graph/activity-graph.css`

- [ ] **Step 1: Create activity-graph.css with glow and transition animations**

```css
/* src/renderer/src/panels/activity-graph/activity-graph.css */

@keyframes activity-glow-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

@keyframes activity-node-enter {
  from { opacity: 0; transform: scale(0.8) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes activity-feed-slide {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes live-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.activity-node-enter {
  animation: activity-node-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.activity-feed-enter {
  animation: activity-feed-slide 0.3s ease-out;
}

.activity-live-dot {
  animation: live-dot-pulse 2s infinite;
}
```

- [ ] **Step 2: Create SessionHub component**

```typescript
// src/renderer/src/panels/activity-graph/SessionHub.tsx
import { useEffect, useState } from 'react'
import type { SessionState } from '@shared/activity-types'

interface SessionHubProps {
  readonly sessionState: SessionState
  readonly sessionStartTime: number | null
  readonly sessionFile: string | null
}

const BORDER_COLORS: Record<SessionState, string> = {
  none: '#475569',
  backfilling: '#f59e0b',
  live: '#34d399',
  idle: '#475569',
}

export function SessionHub({ sessionState, sessionStartTime, sessionFile }: SessionHubProps) {
  // Re-render every second to keep duration display live
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!sessionStartTime) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [sessionStartTime])

  const elapsed = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const duration = `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const truncatedFile = sessionFile
    ? (sessionFile.length > 16 ? sessionFile.slice(0, 14) + '...' : sessionFile)
    : null

  return (
    <div
      className="absolute flex flex-col items-center justify-center rounded-xl px-4 py-3"
      style={{
        width: 160,
        height: 90,
        background: '#0c0c0c',
        border: `2px solid ${BORDER_COLORS[sessionState]}`,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
      }}
    >
      <div className="flex items-center gap-2">
        {sessionState === 'live' && (
          <div
            className="activity-live-dot rounded-full"
            style={{ width: 7, height: 7, background: '#34d399' }}
          />
        )}
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: BORDER_COLORS[sessionState] }}
        >
          {sessionState === 'live' ? 'Live' : sessionState === 'idle' ? 'Idle' : sessionState}
        </span>
      </div>
      {sessionStartTime && (
        <span className="mt-1 text-xs" style={{ color: '#64748b' }}>
          {duration}
        </span>
      )}
      {truncatedFile && (
        <span className="mt-0.5 text-xs truncate" style={{ color: '#475569', fontSize: 9, maxWidth: 140 }} title={sessionFile ?? ''}>
          {truncatedFile}
        </span>
      )}
      {sessionState === 'idle' && (
        <span className="mt-1 text-xs" style={{ color: '#475569', fontSize: 10 }}>
          Session may have ended
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create ActivityNodeCard component**

```typescript
// src/renderer/src/panels/activity-graph/ActivityNodeCard.tsx
import type { ActivityNode } from '@shared/activity-types'

interface ActivityNodeCardProps {
  readonly node: ActivityNode
  readonly highlighted: boolean
}

const TYPE_COLORS: Record<string, string> = {
  subagent: '#a78bfa',
  skill: '#22d3ee',
  mcp: '#f59e0b',
}

const STATE_SIZES = {
  active: { width: 130, height: 55 },
  recent: { width: 120, height: 50 },
  historical: { width: 110, height: 45 },
}

export function ActivityNodeCard({ node, highlighted }: ActivityNodeCardProps) {
  const color = TYPE_COLORS[node.elementType] ?? '#94a3b8'
  const size = STATE_SIZES[node.state]
  const isActive = node.state === 'active'

  const truncatedName = node.name.length > 20 ? node.name.slice(0, 18) + '...' : node.name

  return (
    <div
      className={`absolute rounded-lg transition-all duration-300 ease-out ${!node.backfill ? 'activity-node-enter' : ''}`}
      style={{
        left: node.position.x - size.width / 2,
        top: node.position.y - size.height / 2,
        width: size.width,
        height: size.height,
        background: '#1e293b',
        border: `1px solid ${isActive ? color : '#334155'}`,
        borderLeft: `3px solid ${color}`,
        opacity: node.state === 'historical' ? 0.35 : node.state === 'recent' ? 0.7 : 1,
        boxShadow: isActive ? `0 0 20px ${color}40` : 'none',
        padding: '6px 8px',
        zIndex: isActive ? 5 : 3,
        outline: highlighted ? `2px solid ${color}` : 'none',
        outlineOffset: 2,
      }}
      title={`${node.name}\n${node.detail}`}
    >
      <div
        className="text-xs font-semibold truncate"
        style={{ color: '#e2e8f0' }}
      >
        {truncatedName}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span
          className="text-xs"
          style={{ color: isActive ? color : '#64748b', fontSize: 10 }}
        >
          {node.elementType}
        </span>
        {node.invocationCount > 1 && (
          <span style={{ color: '#475569', fontSize: 9 }}>
            &middot; {node.invocationCount}x
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create ActivityFeed component**

```typescript
// src/renderer/src/panels/activity-graph/ActivityFeed.tsx
import type { ActivityFeedEntry, ActivityNodeType } from '@shared/activity-types'

interface ActivityFeedProps {
  readonly entries: readonly ActivityFeedEntry[]
  readonly width: number
  readonly onEntryClick: (name: string) => void
}

const TYPE_COLORS: Record<string, string> = {
  subagent: '#a78bfa',
  skill: '#22d3ee',
  mcp: '#f59e0b',
}

const KIND_VERBS: Record<string, string> = {
  'skill-invoked': 'invoked',
  'agent-spawned': 'spawned',
  'subagent-spawned': 'dispatched',
  'mcp-called': 'called',
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function ActivityFeed({ entries, width, onEntryClick }: ActivityFeedProps) {
  return (
    <div
      className="absolute right-2 top-12 bottom-2 overflow-y-auto rounded-lg"
      style={{
        width,
        background: 'rgba(15, 23, 42, 0.92)',
        border: '1px solid #1e293b',
        padding: 10,
        zIndex: 15,
      }}
    >
      <div
        className="uppercase tracking-widest mb-2"
        style={{ fontSize: 9, color: '#475569' }}
      >
        Activity Feed
      </div>
      {entries.map((entry, i) => {
        const color = TYPE_COLORS[entry.elementType ?? ''] ?? '#94a3b8'
        const verb = KIND_VERBS[entry.kind] ?? entry.kind
        return (
          <div
            key={entry.id}
            className={`mb-1.5 pb-1.5 cursor-pointer hover:opacity-80 ${i === 0 ? 'activity-feed-enter' : ''}`}
            style={{ borderBottom: '1px solid #1e293b22' }}
            onClick={() => onEntryClick(entry.name)}
          >
            <div className="font-medium" style={{ fontSize: 11, color }}>
              &#9679; {truncate(entry.name, 30)} {verb}
            </div>
            {entry.detail && (
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                {truncate(entry.detail, 40)}
              </div>
            )}
            <div style={{ fontSize: 9, color: '#475569' }}>
              {relativeTime(entry.timestamp)}
            </div>
          </div>
        )
      })}
      {entries.length === 0 && (
        <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', marginTop: 20 }}>
          No activity yet
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/panels/activity-graph/activity-graph.css src/renderer/src/panels/activity-graph/SessionHub.tsx src/renderer/src/panels/activity-graph/ActivityNodeCard.tsx src/renderer/src/panels/activity-graph/ActivityFeed.tsx
git commit -m "feat: add activity graph UI components (hub, node card, feed)"
```

---

## Task 11: ActivityGraphPanel (Main Assembly)

**Files:**
- Replace: `src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx` (replace placeholder)

- [ ] **Step 1: Implement the full ActivityGraphPanel**

```typescript
// src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActivityGraphStore } from '../../store/activity-graph-store'
import { useVaultStore } from '../../store/vault-store'
import { useActivityStream } from '../../hooks/useActivityStream'
import { layoutActivityNodes } from './radial-layout'
import { SessionHub } from './SessionHub'
import { ActivityNodeCard } from './ActivityNodeCard'
import { ActivityFeed } from './ActivityFeed'
import './activity-graph.css'

const FEED_WIDTH_FACTOR = 0.18
const FEED_MIN = 180
const FEED_MAX = 220

export function ActivityGraphPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 600 })
  const [highlightedName, setHighlightedName] = useState<string | null>(null)
  // Viewport state for pan/zoom
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })

  const {
    nodes,
    feedEntries,
    sessionState,
    sessionStartTime,
    sessionFile,
  } = useActivityGraphStore()

  // Wire activity stream — pass vaultPath directly, main process derives Claude dir
  useActivityStream(true, vaultPath)

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Responsive feed width + hub size
  const isCompact = containerSize.width < 900
  const isMinimal = containerSize.width < 700
  const feedWidth = isMinimal ? 0 : Math.max(FEED_MIN, Math.min(FEED_MAX, containerSize.width * FEED_WIDTH_FACTOR))
  const showFeed = !isMinimal
  const hubSize = isCompact ? { width: 120, height: 70 } : { width: 160, height: 90 }

  // Compute layout
  const availableSize = {
    width: containerSize.width - (showFeed ? feedWidth + 16 : 0),
    height: containerSize.height,
  }
  const hubCenter = {
    x: availableSize.width / 2,
    y: availableSize.height / 2,
  }

  const layoutInputs = nodes.map((n) => ({
    id: n.id,
    state: n.state,
    teamId: n.teamId,
  }))
  const positions = layoutActivityNodes(layoutInputs, hubCenter, availableSize)

  const positionedNodes = nodes.map((n, i) => ({
    ...n,
    position: positions[i] ?? hubCenter,
  }))

  // Edge rendering
  const edges = positionedNodes.map((node) => ({
    id: node.id,
    from: node.position,
    to: hubCenter,
    color: getTypeColor(node.elementType),
    state: node.state,
  }))

  // Highlight by element name (not id) so feed entries match deduplicated nodes
  const handleFeedClick = useCallback((name: string) => {
    setHighlightedName(name)
    setTimeout(() => setHighlightedName(null), 2000)
  }, [])

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomDelta = e.deltaY > 0 ? 0.95 : 1.05
    setViewport((v) => ({
      ...v,
      zoom: Math.max(0.3, Math.min(3, v.zoom * zoomDelta)),
    }))
  }, [])

  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return // only on background
    isDragging.current = true
    dragStart.current = { x: e.clientX - viewport.x, y: e.clientY - viewport.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [viewport.x, viewport.y])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    setViewport((v) => ({
      ...v,
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    }))
  }, [])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const handleClear = useCallback(() => {
    useActivityGraphStore.getState().clearSession()
  }, [])

  // Empty state
  if (sessionState === 'none') {
    return (
      <div
        ref={containerRef}
        className="h-full flex items-center justify-center"
        style={{ background: '#0a0a0f' }}
      >
        <div className="text-center" style={{ maxWidth: 320 }}>
          <div className="text-lg font-semibold mb-2" style={{ color: '#475569' }}>
            Activity Graph
          </div>
          <div className="text-sm mb-4" style={{ color: '#334155' }}>
            Start a Claude session in this project to see your ecosystem in action.
          </div>
          <div className="text-sm mb-2" style={{ color: '#334155' }}>
            Skills, agents, MCP servers, and commands will appear here as Claude invokes them.
          </div>
          <div
            className="mt-4 inline-block px-3 py-1 rounded"
            style={{ background: '#111827', border: '1px solid #1e293b', color: '#475569', fontSize: 12 }}
          >
            Cmd+Shift+L
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-full relative overflow-hidden"
      style={{ background: '#0a0a0f' }}
    >
      {/* Toolbar */}
      <div className="absolute top-2 left-3 flex items-center gap-2 z-20">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
          style={{ background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b' }}
        >
          {sessionState === 'live' && (
            <div
              className="activity-live-dot rounded-full"
              style={{ width: 7, height: 7, background: '#34d399' }}
            />
          )}
          <span
            className="text-xs font-semibold uppercase"
            style={{ color: sessionState === 'live' ? '#34d399' : '#475569' }}
          >
            {sessionState}
          </span>
        </div>
        <button
          className="px-2.5 py-1 rounded-md text-xs"
          style={{ background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b', color: '#94a3b8' }}
          onClick={handleClear}
        >
          Clear
        </button>
      </div>

      {/* Viewport-transformed graph area (pan/zoom) */}
      <div
        className="absolute inset-0"
        style={{ overflow: 'hidden', cursor: isDragging.current ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >

      {/* Ring guides */}
      <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <circle
          cx={hubCenter.x}
          cy={hubCenter.y}
          r={availableSize.height * 0.42 / 2}
          stroke="#1e293b"
          strokeWidth={1}
          strokeDasharray="2,6"
          fill="none"
          opacity={0.4}
        />
      </svg>

      {/* Edges with animated flow for active state */}
      <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
        {edges.map((edge) => (
          <line
            key={edge.id}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            stroke={edge.color}
            strokeWidth={edge.state === 'active' ? 1.5 : 1}
            strokeDasharray={edge.state === 'active' ? '5,5' : 'none'}
            opacity={edge.state === 'historical' ? 0.1 : edge.state === 'recent' ? 0.25 : 0.5}
          >
            {edge.state === 'active' && (
              <animate
                attributeName="stroke-dashoffset"
                values="0;-10"
                dur="1.2s"
                repeatCount="indefinite"
              />
            )}
          </line>
        ))}
      </svg>

      {/* Hub */}
      <SessionHub
        sessionState={sessionState}
        sessionStartTime={sessionStartTime}
        sessionFile={sessionFile}
      />

      {/* Nodes */}
      {positionedNodes.map((node) => (
        <ActivityNodeCard
          key={node.id}
          node={node}
          highlighted={highlightedName === node.name}
        />
      ))}

      </div>{/* end viewport transform */}
      </div>{/* end viewport container */}

      {/* Feed */}
      {showFeed && (
        <ActivityFeed
          entries={feedEntries}
          width={feedWidth}
          onEntryClick={handleFeedClick}
        />
      )}
    </div>
  )
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    agent: '#a78bfa',
    subagent: '#c084fc',
    skill: '#22d3ee',
    mcp: '#f59e0b',
  }
  return colors[type] ?? '#94a3b8'
}
```

**Implementation notes for the implementer:**

1. **Pan/zoom support**: The panel's canvas area needs basic pan/zoom. Since we're not using CanvasSurface (which is typed against CanvasNode), implement a lightweight CSS transform-based viewport: track `viewportX`, `viewportY`, `zoom` in local state. Apply `transform: translate(${x}px, ${y}px) scale(${zoom})` to the nodes/edges container. Handle `wheel` for zoom and `pointerdown`/`pointermove` for drag. This matches the viewport pattern in CanvasSurface but without the CanvasNode dependency.

2. **Responsive breakpoints**: At container widths < 700px, set `feedWidth` to 0 and show a small icon button (40px) in the top-right that toggles a feed overlay. At < 700px, skip outer rings in the layout (pass `maxRings: 1` to `layoutActivityNodes`). Scale hub from 160x90 to 120x70 when container is < 900px.

3. **Backfill-aware feed entries**: In `ActivityFeed`, check `i === 0` for the `activity-feed-enter` class. During backfill, many entries arrive at once. The `backfill` flag on nodes controls node animation, but the feed should also skip slide-in animation for backfill entries. The simplest approach: track a `isBackfilling` boolean in the store, set it true during backfill, and conditionally skip the CSS class.

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No new errors

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/activity-graph/ActivityGraphPanel.tsx
git commit -m "feat: assemble ActivityGraphPanel with layout, hub, nodes, edges, and feed"
```

---

## Task 12: Run All Tests + Visual Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing 293 + new tests)

- [ ] **Step 2: Fix any test failures**

If failures, fix and re-run until green.

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: No errors

- [ ] **Step 4: Start dev server and visually verify**

Run: `npm run dev`

Manual checks:
1. Press Cmd+Shift+L: should show empty state invitation
2. Open a Claude session in a separate terminal targeting the same project
3. Verify: session hub appears when JSONL file is created
4. Verify: nodes appear in radial slots as skills/agents/MCPs are invoked
5. Verify: feed entries scroll in from top
6. Verify: nodes transition from active (glowing) to recent (dimmed) after inactivity
7. Press Cmd+Shift+L again: should toggle back to previous view

**Take screenshots of: empty state, live with nodes, feed panel.** Per project convention: always run and verify visually.

- [ ] **Step 5: Commit any fixes from visual verification**

```bash
git add -u
git commit -m "fix: visual verification fixes for activity graph"
```

- [ ] **Step 6: Final commit with test count update**

Run: `npm test -- --reporter=verbose 2>&1 | tail -5` to confirm test count.

```bash
git add -u
git commit -m "feat: Live Activity Graph complete — tail parser, radial layout, activity feed"
```
