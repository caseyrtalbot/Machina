# Live Session Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time floating overlay panel on the Project Canvas that streams Claude's active session activity as grouped milestones, so builders can see what Claude is doing as it happens.

**Architecture:** Main process `SessionTailer` watches Claude's JSONL session files via chokidar, extracts tool_use events, groups them into milestones, and streams them to the renderer via IPC. The renderer's `useSessionThread` hook manages state, and `SessionThreadPanel` renders the floating overlay with expandable progressive disclosure.

**Tech Stack:** Electron IPC, chokidar, React hooks, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-19-live-session-thread-design.md`

---

## File Map

| File | Responsibility | New/Modified |
|------|---------------|-------------|
| `src/shared/project-canvas-types.ts` | SessionMilestone + SessionToolEvent types | Modified |
| `src/shared/ipc-channels.ts` | session:tail-start, session:tail-stop channels + session:milestone, session:detected events | Modified |
| `src/main/services/session-utils.ts` | Shared `toDirKey()` + `extractToolEvents()` | New |
| `src/main/services/project-session-parser.ts` | Refactored to use shared utils | Modified |
| `src/main/services/session-milestone-grouper.ts` | Pure grouping function | New |
| `src/main/services/session-tailer.ts` | Chokidar JSONL tailing + milestone emission | New |
| `src/main/ipc/project.ts` | Register session IPC handlers | Modified |
| `src/main/index.ts` | Cleanup tailer on quit | Modified |
| `src/preload/index.ts` | Expose session IPC to renderer | Modified |
| `src/renderer/src/hooks/useSessionThread.ts` | Hook managing milestone state | New |
| `src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx` | Floating overlay UI | New |
| `src/renderer/src/panels/project-canvas/ProjectCanvasPanel.tsx` | Toolbar toggle + panel mount | Modified |
| `tests/services/session-utils.test.ts` | Tests for shared utils | New |
| `tests/services/session-milestone-grouper.test.ts` | Tests for grouping logic | New |
| `tests/services/session-tailer.test.ts` | Tests for tailer | New |

---

### Task 1: Add shared types

**Files:**
- Modify: `src/shared/project-canvas-types.ts`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add SessionToolEvent and SessionMilestone types**

In `src/shared/project-canvas-types.ts`, append after line 13:

```typescript
export interface SessionToolEvent {
  readonly tool: 'Read' | 'Write' | 'Edit' | 'Bash' | 'Grep'
  readonly timestamp: number
  readonly filePath?: string
  readonly detail?: string
}

export interface SessionMilestone {
  readonly id: string
  readonly type: 'edit' | 'create' | 'command' | 'research' | 'error' | 'session-switched'
  readonly timestamp: number
  readonly summary: string
  readonly files: readonly string[]
  readonly events: readonly SessionToolEvent[]
}

export interface SessionDetectedEvent {
  readonly active: boolean
}
```

- [ ] **Step 2: Add IPC channels and events**

In `src/shared/ipc-channels.ts`, add to `IpcChannels` after line 48 (after `project:parse-sessions`):

```typescript
  // --- Session Tailing ---
  'session:tail-start': { request: { projectPath: string }; response: void }
  'session:tail-stop': { request: void; response: void }
```

Add to `IpcEvents` after line 80 (after `project:file-changed`):

```typescript
  'session:milestone': SessionMilestone
  'session:detected': SessionDetectedEvent
```

Update the import at line 2 to include the new types:

```typescript
import type {
  ProjectSessionEvent,
  ProjectFileChangedEvent,
  SessionMilestone,
  SessionDetectedEvent
} from './project-canvas-types'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.node.json && npx tsc --noEmit --project tsconfig.web.json`
Expected: PASS (types are defined but not yet used)

- [ ] **Step 4: Commit**

```bash
git add src/shared/project-canvas-types.ts src/shared/ipc-channels.ts
git commit -m "feat(session-thread): add SessionMilestone and SessionToolEvent types + IPC channels"
```

---

### Task 2: Extract shared JSONL utilities

**Files:**
- Create: `src/main/services/session-utils.ts`
- Modify: `src/main/services/project-session-parser.ts`
- Create: `tests/services/session-utils.test.ts`

- [ ] **Step 1: Write tests for shared utilities**

Create `tests/services/session-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toDirKey, extractToolEvents } from '../../src/main/services/session-utils'

describe('toDirKey', () => {
  it('replaces slashes with dashes', () => {
    expect(toDirKey('/Users/casey/Projects/my-app')).toBe('-Users-casey-Projects-my-app')
  })

  it('handles root path', () => {
    expect(toDirKey('/')).toBe('-')
  })
})

describe('extractToolEvents', () => {
  it('extracts Read tool_use from assistant message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/src/index.ts' }
          }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0].tool).toBe('Read')
    expect(events[0].filePath).toBe('/src/index.ts')
  })

  it('extracts Edit tool_use with detail', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Edit',
            input: {
              file_path: '/src/parser.ts',
              old_string: 'const x = 1',
              new_string: 'const x = 2'
            }
          }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0].tool).toBe('Edit')
    expect(events[0].detail).toBeDefined()
  })

  it('extracts Bash tool_use with command detail', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'npm test' }
          }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0].tool).toBe('Bash')
    expect(events[0].detail).toBe('npm test')
  })

  it('returns empty array for non-assistant messages', () => {
    const line = JSON.stringify({
      type: 'human',
      message: { role: 'user', content: 'hello' }
    })
    expect(extractToolEvents(line)).toEqual([])
  })

  it('returns empty array for malformed JSON', () => {
    expect(extractToolEvents('not json at all')).toEqual([])
  })

  it('extracts multiple tool_use blocks from one message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/b.ts' } }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(2)
  })

  it('extracts Grep tool_use with search path', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Grep', input: { pattern: 'foo', path: '/src' } }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0].tool).toBe('Grep')
    expect(events[0].filePath).toBe('/src')
  })

  it('skips text blocks and only extracts tool_use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }
        ]
      },
      timestamp: '2026-03-19T12:00:00Z'
    })
    const events = extractToolEvents(line)
    expect(events).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/session-utils.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create session-utils.ts**

Create `src/main/services/session-utils.ts`:

```typescript
import type { SessionToolEvent } from '@shared/project-canvas-types'

/** Convert an absolute path to Claude's directory key format (slashes to dashes). */
export function toDirKey(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

const TOOL_NAMES_WITH_PATH = new Set(['Read', 'Write', 'Edit', 'Grep'])

interface JsonlEntry {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
  }
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input?: Record<string, unknown>
}

function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is ToolUseBlock =>
      block && typeof block === 'object' && block.type === 'tool_use'
  )
}

/**
 * Parse a single JSONL line and extract tool_use events.
 * Returns empty array for non-assistant messages or malformed lines.
 */
export function extractToolEvents(jsonLine: string): SessionToolEvent[] {
  try {
    const entry: JsonlEntry = JSON.parse(jsonLine)
    if (entry.type !== 'assistant' || entry.message?.role !== 'assistant') return []

    const toolBlocks = extractToolUseBlocks(entry.message?.content)
    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
    const events: SessionToolEvent[] = []

    for (const block of toolBlocks) {
      if (TOOL_NAMES_WITH_PATH.has(block.name)) {
        const filePath =
          (block.input?.file_path as string) || (block.input?.path as string) || undefined
        const detail =
          block.name === 'Edit'
            ? ((block.input?.new_string as string) ?? '').slice(0, 200)
            : undefined
        events.push({
          tool: block.name as SessionToolEvent['tool'],
          timestamp,
          filePath,
          detail
        })
      } else if (block.name === 'Bash') {
        const command = (block.input?.command as string) ?? ''
        events.push({
          tool: 'Bash',
          timestamp,
          detail: command.slice(0, 100)
        })
      }
    }

    return events
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/session-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor ProjectSessionParser to use shared utils**

In `src/main/services/project-session-parser.ts`, replace the duplicated logic. The file should import `toDirKey` and `extractToolEvents` from `./session-utils` and remove its own `toDirKey`, `TOOL_NAMES_WITH_PATH`, `JsonlEntry`, `ToolUseBlock`, `extractToolUseBlocks` definitions. The `parse()` method's inner loop changes from manual tool extraction to calling `extractToolEvents(line)` and mapping the results to `ProjectSessionEvent`.

- [ ] **Step 6: Run existing parser tests to verify no regression**

Run: `npx vitest run tests/services/project-session-parser.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 7: Commit**

```bash
git add src/main/services/session-utils.ts src/main/services/project-session-parser.ts tests/services/session-utils.test.ts
git commit -m "refactor(session): extract shared JSONL parsing utilities from ProjectSessionParser"
```

---

### Task 3: Build milestone grouping logic

**Files:**
- Create: `src/main/services/session-milestone-grouper.ts`
- Create: `tests/services/session-milestone-grouper.test.ts`

- [ ] **Step 1: Write grouper tests**

Create `tests/services/session-milestone-grouper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupEventsIntoMilestones } from '../../src/main/services/session-milestone-grouper'
import type { SessionToolEvent } from '@shared/project-canvas-types'

const ts = 1710849600000 // fixed timestamp for tests

describe('groupEventsIntoMilestones', () => {
  it('returns empty array for empty input', () => {
    expect(groupEventsIntoMilestones([])).toEqual([])
  })

  it('groups consecutive Reads into one research milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Read', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/b.ts' },
      { tool: 'Read', timestamp: ts + 2000, filePath: '/c.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
    expect(milestones[0].summary).toContain('3')
    expect(milestones[0].files).toHaveLength(3)
    expect(milestones[0].events).toHaveLength(3)
  })

  it('creates edit milestone for a single Edit', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/parser.ts', detail: 'added parseCoEditPairs' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('edit')
    expect(milestones[0].files).toEqual(['/parser.ts'])
  })

  it('groups consecutive Edits on same file into one milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/parser.ts', detail: 'change 1' },
      { tool: 'Edit', timestamp: ts + 1000, filePath: '/parser.ts', detail: 'change 2' },
      { tool: 'Edit', timestamp: ts + 2000, filePath: '/parser.ts', detail: 'change 3' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('edit')
    expect(milestones[0].summary).toContain('3')
    expect(milestones[0].events).toHaveLength(3)
  })

  it('creates separate milestones for Edits across different files', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Edit', timestamp: ts + 1000, filePath: '/b.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(2)
    expect(milestones[0].files).toEqual(['/a.ts'])
    expect(milestones[1].files).toEqual(['/b.ts'])
  })

  it('creates command milestone for Bash', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Bash', timestamp: ts, detail: 'npm test' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('command')
    expect(milestones[0].summary).toContain('npm test')
  })

  it('creates create milestone for Write', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Write', timestamp: ts, filePath: '/new-file.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('create')
    expect(milestones[0].files).toEqual(['/new-file.ts'])
  })

  it('breaks groups when category changes', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Read', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/b.ts' },
      { tool: 'Edit', timestamp: ts + 2000, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 3000, filePath: '/c.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(3)
    expect(milestones[0].type).toBe('research')
    expect(milestones[1].type).toBe('edit')
    expect(milestones[2].type).toBe('research')
  })

  it('handles single event as single milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Grep', timestamp: ts, filePath: '/src' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
  })

  it('groups consecutive Grep with Read into one research milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Grep', timestamp: ts, filePath: '/src' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/a.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/session-milestone-grouper.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the grouper**

Create `src/main/services/session-milestone-grouper.ts`:

```typescript
import { randomUUID } from 'crypto'
import type { SessionToolEvent, SessionMilestone } from '@shared/project-canvas-types'

type EventCategory = 'research' | 'edit' | 'create' | 'command'

const SUMMARY_MAX_CHARS = 200
const COMMAND_MAX_CHARS = 100

function getCategory(tool: SessionToolEvent['tool']): EventCategory {
  switch (tool) {
    case 'Read':
    case 'Grep':
      return 'research'
    case 'Edit':
      return 'edit'
    case 'Write':
      return 'create'
    case 'Bash':
      return 'command'
  }
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function buildMilestone(category: EventCategory, events: SessionToolEvent[]): SessionMilestone {
  const files = [...new Set(events.map((e) => e.filePath).filter(Boolean))] as string[]
  const timestamp = events[events.length - 1].timestamp

  switch (category) {
    case 'research':
      return {
        id: randomUUID(),
        type: 'research',
        timestamp,
        summary: `Researching : ${events.length} operation${events.length > 1 ? 's' : ''}`,
        files,
        events
      }
    case 'create':
      return {
        id: randomUUID(),
        type: 'create',
        timestamp,
        summary: `Created ${basename(files[0] ?? 'file')}`,
        files,
        events
      }
    case 'edit':
      return {
        id: randomUUID(),
        type: 'edit',
        timestamp,
        summary:
          events.length === 1
            ? `Edited ${basename(files[0] ?? 'file')}`
            : `Edited ${basename(files[0] ?? 'file')} : ${events.length} edits`,
        files,
        events
      }
    case 'command': {
      const detail = (events[0].detail ?? '').slice(0, COMMAND_MAX_CHARS)
      return {
        id: randomUUID(),
        type: 'command',
        timestamp,
        summary: detail || 'Command',
        files,
        events
      }
    }
  }
}

/**
 * Group a sequence of raw tool events into logical milestones.
 * Consecutive events of the same category are grouped together.
 * Edit events are further split by file path.
 * Each Bash command gets its own milestone.
 */
export function groupEventsIntoMilestones(events: readonly SessionToolEvent[]): SessionMilestone[] {
  if (events.length === 0) return []

  const milestones: SessionMilestone[] = []
  let currentGroup: SessionToolEvent[] = []
  let currentCategory: EventCategory | null = null
  let currentEditFile: string | undefined

  function flushGroup(): void {
    if (currentGroup.length === 0 || currentCategory === null) return
    milestones.push(buildMilestone(currentCategory, currentGroup))
    currentGroup = []
    currentCategory = null
    currentEditFile = undefined
  }

  for (const event of events) {
    const category = getCategory(event.tool)

    // Bash commands always get their own milestone
    // Note: error milestones from non-zero exit codes require parsing tool_result
    // entries (not tool_use). Deferred to a follow-up. The 'error' type exists in
    // the type union but is not produced by this grouper yet.
    if (category === 'command') {
      flushGroup()
      milestones.push(buildMilestone('command', [event]))
      continue
    }

    // Write events always get their own milestone
    if (category === 'create') {
      flushGroup()
      milestones.push(buildMilestone('create', [event]))
      continue
    }

    // Edit events: split by file path
    if (category === 'edit') {
      if (currentCategory === 'edit' && event.filePath === currentEditFile) {
        currentGroup.push(event)
      } else {
        flushGroup()
        currentCategory = 'edit'
        currentEditFile = event.filePath
        currentGroup = [event]
      }
      continue
    }

    // Research events: group consecutive Read/Grep
    if (currentCategory === 'research') {
      currentGroup.push(event)
    } else {
      flushGroup()
      currentCategory = 'research'
      currentGroup = [event]
    }
  }

  flushGroup()
  return milestones
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/session-milestone-grouper.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/session-milestone-grouper.ts tests/services/session-milestone-grouper.test.ts
git commit -m "feat(session-thread): add milestone grouping logic with tests"
```

---

### Task 4: Build SessionTailer service

**Files:**
- Create: `src/main/services/session-tailer.ts`
- Create: `tests/services/session-tailer.test.ts`

- [ ] **Step 1: Write tailer tests**

Create `tests/services/session-tailer.test.ts`. Tests should use temp directories with real `.jsonl` files. Key tests:
- Reads new lines appended after start (seek-to-end)
- Parses tool_use blocks from appended lines
- Skips malformed lines without crashing
- Handles missing session directory gracefully
- Buffers incomplete lines (no trailing newline)
- Calls onMilestone callback with grouped milestones
- Stops cleanly on `stop()`

Use the same temp directory pattern as `project-session-parser.test.ts`: `mkdtemp`, `mkdir` for the claude projects dir, write fixture JSONL, then clean up in `afterEach`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/session-tailer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SessionTailer**

Create `src/main/services/session-tailer.ts`:

```typescript
import type { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { readdir, stat, open } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { toDirKey, extractToolEvents } from './session-utils'
import { groupEventsIntoMilestones } from './session-milestone-grouper'
import { typedSend } from '../typed-ipc'
import type { SessionMilestone } from '@shared/project-canvas-types'

const SESSION_CHECK_INTERVAL_MS = 5000

export class SessionTailer {
  private mainWindow: BrowserWindow
  private watcher: FSWatcher | null = null
  private currentFile: string | null = null
  private fileOffset = 0
  private lineBuffer = ''
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private claudeDir = ''
  private hasEmittedDetected = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  async start(projectPath: string): Promise<void> {
    await this.stop()

    const dirKey = toDirKey(projectPath)
    this.claudeDir = join(homedir(), '.claude', 'projects', dirKey)

    const file = await this.findMostRecentSession()
    if (!file) return

    await this.tailFile(file)

    // Periodically check for newer session files
    this.checkInterval = setInterval(async () => {
      const newest = await this.findMostRecentSession()
      if (newest && newest !== this.currentFile) {
        await this.tailFile(newest)
        const milestone: SessionMilestone = {
          id: crypto.randomUUID(),
          type: 'session-switched',
          timestamp: Date.now(),
          summary: 'New session detected',
          files: [],
          events: []
        }
        typedSend(this.mainWindow, 'session:milestone', milestone)
      }
    }, SESSION_CHECK_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.currentFile = null
    this.fileOffset = 0
    this.lineBuffer = ''
    this.hasEmittedDetected = false
  }

  private async findMostRecentSession(): Promise<string | null> {
    try {
      const entries = await readdir(this.claudeDir)
      const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'))
      if (jsonlFiles.length === 0) return null

      let newest: { file: string; mtime: number } | null = null
      for (const f of jsonlFiles) {
        const fullPath = join(this.claudeDir, f)
        try {
          const s = await stat(fullPath)
          if (!newest || s.mtimeMs > newest.mtime) {
            newest = { file: fullPath, mtime: s.mtimeMs }
          }
        } catch {
          // stat error, skip
        }
      }
      return newest?.file ?? null
    } catch {
      return null
    }
  }

  private async tailFile(filePath: string): Promise<void> {
    // Close existing watcher
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    this.currentFile = filePath
    this.lineBuffer = ''

    // Seek to end
    try {
      const s = await stat(filePath)
      this.fileOffset = s.size
    } catch {
      this.fileOffset = 0
    }

    // Emit session detected
    if (!this.hasEmittedDetected) {
      this.hasEmittedDetected = true
      typedSend(this.mainWindow, 'session:detected', { active: true })
    }

    // Watch the file for changes
    this.watcher = watch(filePath, {
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })

    this.watcher.on('change', () => this.readNewContent())
  }

  private async readNewContent(): Promise<void> {
    if (!this.currentFile) return

    try {
      const fh = await open(this.currentFile, 'r')
      try {
        const s = await fh.stat()
        if (s.size <= this.fileOffset) return

        const bytesToRead = s.size - this.fileOffset
        const buffer = Buffer.alloc(bytesToRead)
        await fh.read(buffer, 0, bytesToRead, this.fileOffset)
        this.fileOffset = s.size

        const text = this.lineBuffer + buffer.toString('utf-8')
        const lines = text.split('\n')

        // Last element is either empty (line ended with \n) or incomplete
        this.lineBuffer = lines.pop() ?? ''

        const allEvents = lines
          .filter((l) => l.trim())
          .flatMap((l) => extractToolEvents(l))

        if (allEvents.length > 0) {
          const milestones = groupEventsIntoMilestones(allEvents)
          for (const milestone of milestones) {
            typedSend(this.mainWindow, 'session:milestone', milestone)
          }
        }
      } finally {
        await fh.close()
      }
    } catch {
      // File read error — will retry on next change event
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/session-tailer.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/services/session-tailer.ts tests/services/session-tailer.test.ts
git commit -m "feat(session-thread): add SessionTailer service with chokidar file tailing"
```

---

### Task 5: Wire IPC and preload

**Files:**
- Modify: `src/main/ipc/project.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Register session IPC handlers in project.ts**

In `src/main/ipc/project.ts`, import `SessionTailer` and create a singleton. Register `session:tail-start` and `session:tail-stop` handlers. The `registerProjectIpc` function already receives `mainWindow`, so pass it to the `SessionTailer` constructor.

Add after line 7:
```typescript
import { SessionTailer } from '../services/session-tailer'
```

Add after `const parser` (line 7):
```typescript
let tailer: SessionTailer | null = null
```

Add inside `registerProjectIpc`, after the `project:parse-sessions` handler:
```typescript
  tailer = new SessionTailer(mainWindow)

  typedHandle('session:tail-start', async (args) => {
    await tailer!.start(args.projectPath)
  })

  typedHandle('session:tail-stop', async () => {
    await tailer!.stop()
  })
```

Export a getter for cleanup:
```typescript
export function getSessionTailer(): SessionTailer | null {
  return tailer
}
```

- [ ] **Step 2: Add cleanup in main/index.ts**

In `src/main/index.ts`, import `getSessionTailer` and call `stop()` in the `before-quit` handler. Add after line 120 (`getProjectWatcher().stop()`):

```typescript
  getSessionTailer()?.stop()
```

Update the import to include `getSessionTailer`:
```typescript
import { registerProjectIpc, getProjectWatcher, getSessionTailer } from './ipc/project'
```

- [ ] **Step 3: Add preload bridge methods**

In `src/preload/index.ts`, add to the `project` namespace (after `parseSessions`, line 62):
```typescript
    tailStart: (projectPath: string) => typedInvoke('session:tail-start', { projectPath }),
    tailStop: () => typedInvoke('session:tail-stop'),
```

Add to the `on` namespace (after `projectFileChanged`, line 85):
```typescript
    sessionMilestone: (callback: (data: SessionMilestone) => void) =>
      typedOn('session:milestone', callback),
    sessionDetected: (callback: (data: SessionDetectedEvent) => void) =>
      typedOn('session:detected', callback)
```

Update the import at line 6:
```typescript
import type { ProjectFileChangedEvent, SessionMilestone, SessionDetectedEvent } from '../shared/project-canvas-types'
```

- [ ] **Step 4: Typecheck all layers**

Run: `npx tsc --noEmit --project tsconfig.node.json && npx tsc --noEmit --project tsconfig.web.json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/project.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(session-thread): wire session tailing IPC and preload bridge"
```

---

### Task 6: Build useSessionThread hook

**Files:**
- Create: `src/renderer/src/hooks/useSessionThread.ts`

- [ ] **Step 1: Implement the hook**

Create `src/renderer/src/hooks/useSessionThread.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import type { SessionMilestone } from '@shared/project-canvas-types'

const MAX_MILESTONES = 50
const IDLE_TIMEOUT_MS = 10000
const RETAINED_MILESTONES = 5

export interface SessionThreadState {
  readonly milestones: readonly SessionMilestone[]
  readonly expandedIds: ReadonlySet<string>
  readonly isLive: boolean
  readonly toggle: (id: string) => void
  readonly clear: () => void
}

export function useSessionThread(
  projectPath: string | null,
  enabled: boolean
): SessionThreadState {
  const [milestones, setMilestones] = useState<readonly SessionMilestone[]>([])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [isLive, setIsLive] = useState(false)
  const lastEventTimeRef = useRef(0)
  const pendingRef = useRef<SessionMilestone[]>([])
  const rafRef = useRef<number | null>(null)

  // Start/stop tailing based on enabled flag
  useEffect(() => {
    if (!enabled || !projectPath) {
      // Retain last N milestones for continuity
      setMilestones((prev) => prev.slice(0, RETAINED_MILESTONES))
      setIsLive(false)
      window.api.project.tailStop().catch(() => {})
      return
    }

    window.api.project.tailStart(projectPath).catch(() => {})

    const unsubMilestone = window.api.on.sessionMilestone((milestone) => {
      lastEventTimeRef.current = Date.now()
      setIsLive(true)

      // Batch with rAF
      pendingRef.current.push(milestone)
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          const batch = pendingRef.current
          pendingRef.current = []
          rafRef.current = null
          setMilestones((prev) => [...batch, ...prev].slice(0, MAX_MILESTONES))
        })
      }
    })

    return () => {
      unsubMilestone()
      window.api.project.tailStop().catch(() => {})
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled, projectPath])

  // Track idle state
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => {
      if (Date.now() - lastEventTimeRef.current > IDLE_TIMEOUT_MS) {
        setIsLive(false)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [enabled])

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setMilestones([])
    setExpandedIds(new Set())
  }, [])

  return { milestones, expandedIds, isLive, toggle, clear }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.web.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useSessionThread.ts
git commit -m "feat(session-thread): add useSessionThread hook with enabled lifecycle"
```

---

### Task 7: Build SessionThreadPanel UI

**Files:**
- Create: `src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx`

- [ ] **Step 1: Implement the panel component**

Create `src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx`. The component receives `SessionThreadState` as props and renders:

- A floating overlay (position: absolute, right: 12px, top: 48px, width: 280px, max-height: 70%)
- Header with "Live Thread" title and status dot (green/gray/red based on `isLive` and milestone count)
- Scrollable milestone list, newest first
- Each milestone: type icon + summary + relative timestamp (collapsed), expandable on click
- `session-switched` milestones render as horizontal separators, not expandable
- Empty state when no milestones
- File paths in expanded view are clickable (calls `onFileClick` prop)
- Auto-scroll: stays at top unless user scrolled down
- Relative timestamps update via `setInterval` every 5 seconds
- Styling uses `colors.bg.elevated`, `colors.border.default`, `typography.fontFamily.mono` from design tokens

Key props interface:
```typescript
interface SessionThreadPanelProps {
  readonly state: SessionThreadState
  readonly onFileClick: (filePath: string) => void
}
```

The component should be ~150-200 lines. Use the existing `colors` and `typography` imports from `../../design/tokens`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.web.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/project-canvas/SessionThreadPanel.tsx
git commit -m "feat(session-thread): add SessionThreadPanel floating overlay component"
```

---

### Task 8: Integrate into ProjectCanvasPanel

**Files:**
- Modify: `src/renderer/src/panels/project-canvas/ProjectCanvasPanel.tsx`

- [ ] **Step 1: Add imports, state, and hook**

At the top of `ProjectCanvasPanel.tsx`, add:
```typescript
import { useSessionThread } from '../../hooks/useSessionThread'
import { SessionThreadPanel } from './SessionThreadPanel'
```

Inside the component, add state for the thread toggle and compute `enabled`:
```typescript
const [threadOpen, setThreadOpen] = useState(false)
const activeTabId = useTabStore((s) => s.activeTabId)
const isActiveTab = activeTabId === 'project-canvas'
const threadState = useSessionThread(projectPath, isActiveTab)
```

Add auto-show on session detection:
```typescript
useEffect(() => {
  if (!isActiveTab) return
  const unsub = window.api.on.sessionDetected((event) => {
    if (event.active) setThreadOpen(true)
  })
  return unsub
}, [isActiveTab])
```

- [ ] **Step 2: Add toggle button to toolbar**

In the toolbar JSX (after the `+ Terminal` button, around line 328), add:
```typescript
<div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
<button
  onClick={() => setThreadOpen((prev) => !prev)}
  className="text-xs px-2 py-0.5 rounded hover:opacity-80"
  style={{
    color: threadOpen ? colors.accent.default : colors.text.secondary
  }}
  title={threadOpen ? 'Hide live thread' : 'Show live thread'}
>
  ⚡ {threadState.isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 ml-1 animate-pulse" />}
</button>
```

- [ ] **Step 3: Mount SessionThreadPanel**

After `<CanvasMinimap>` in the JSX (around line 349), add:
```typescript
{threadOpen && (
  <SessionThreadPanel
    state={threadState}
    onFileClick={(filePath) => {
      useEditorStore.getState().setActiveNote(filePath, filePath)
      useTabStore.getState().activateTab('editor')
    }}
  />
)}
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit --project tsconfig.web.json && npm run build`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/panels/project-canvas/ProjectCanvasPanel.tsx
git commit -m "feat(session-thread): integrate live thread panel into ProjectCanvasPanel"
```

---

### Task 9: Visual verification

- [ ] **Step 1: Start the app**

Run: `npm run dev`

- [ ] **Step 2: Open Project Canvas**

Press `Cmd+Shift+P` to open the Project Canvas.

- [ ] **Step 3: Verify empty state**

With no active Claude session, verify the thread panel either doesn't auto-show or shows the empty state message.

- [ ] **Step 4: Start a Claude session**

In a separate terminal, start a Claude Code session in the same project directory. Run a few commands (read files, edit files, run tests).

- [ ] **Step 5: Verify live milestones**

Switch to the Thought Engine app and verify:
- Thread panel auto-shows when session is detected
- Milestones appear in real time
- Research events are grouped ("Researching — N operations")
- Edit events show the file name
- Bash commands show the command preview
- Clicking a milestone expands it
- Clicking a file path in expanded view opens the file
- Status dot is green when events are flowing
- Relative timestamps update

- [ ] **Step 6: Verify tab switch retention**

Switch to another tab, then back to Project Canvas. Verify:
- Last 5 milestones are retained
- New events resume appearing

- [ ] **Step 7: Take a screenshot for the user**

Ask the user to share a screenshot of the working thread panel for visual verification.

---

### Task 10: Final build verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit --project tsconfig.node.json && npx tsc --noEmit --project tsconfig.web.json`

- [ ] **Step 2: Full test suite**

Run: `npm test`

- [ ] **Step 3: Full build**

Run: `npm run build`

- [ ] **Step 4: Commit any remaining fixes**

If any issues were found during visual verification, fix and commit them.
