# Librarian Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire the Librarian from a broken MCP-based tmux agent to a direct `child_process.spawn` of Claude CLI operating on the vault folder with native file tools.

**Architecture:** Claude CLI spawned as a child process in the vault directory with `--system-prompt` and `--allowedTools`. A lightweight `LibrarianMonitor` tracks the process and emits `AgentSidecarState` updates through the existing agent state pipeline. The Librarian is removed from the canvas action bar (it's not a spatial operation) and added as a book icon on the canvas toolbar.

**Tech Stack:** Node.js `child_process`, Claude CLI (`-p --system-prompt --allowedTools --dangerously-skip-permissions`), Vitest, React

**Spec:** `docs/superpowers/specs/2026-04-02-librarian-redesign.md`

---

### Task 1: LibrarianMonitor — Process Lifecycle Tracker

**Files:**
- Create: `src/main/services/librarian-monitor.ts`
- Create: `tests/main/services/librarian-monitor.test.ts`

This is the core infrastructure that replaces TmuxMonitor for librarian sessions. It tracks a child process and emits `AgentSidecarState`-shaped snapshots.

- [ ] **Step 1: Write the failing test for LibrarianMonitor state tracking**

```typescript
// tests/main/services/librarian-monitor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LibrarianMonitor } from '../../../src/main/services/librarian-monitor'
import type { AgentSidecarState } from '@shared/agent-types'

describe('LibrarianMonitor', () => {
  let monitor: LibrarianMonitor

  beforeEach(() => {
    monitor = new LibrarianMonitor()
  })

  it('returns empty states initially', () => {
    expect(monitor.getStates()).toEqual([])
  })

  it('tracks a registered session as alive', () => {
    monitor.register('session-1', 12345, '/vault/path')
    const states = monitor.getStates()
    expect(states).toHaveLength(1)
    expect(states[0].sessionId).toBe('session-1')
    expect(states[0].status).toBe('alive')
    expect(states[0].pid).toBe(12345)
    expect(states[0].cwd).toBe('/vault/path')
    expect(states[0].label).toBe('librarian')
  })

  it('marks session as exited on complete', () => {
    monitor.register('session-1', 12345, '/vault/path')
    monitor.complete('session-1', 0)
    const states = monitor.getStates()
    expect(states[0].status).toBe('exited')
  })

  it('removes session on cleanup', () => {
    monitor.register('session-1', 12345, '/vault/path')
    monitor.complete('session-1', 0)
    monitor.cleanup('session-1')
    expect(monitor.getStates()).toEqual([])
  })

  it('calls onChange when state changes', () => {
    const onChange = vi.fn()
    monitor.setOnChange(onChange)
    monitor.register('session-1', 12345, '/vault/path')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0][0].sessionId).toBe('session-1')
  })

  it('kills a running session', () => {
    const killFn = vi.fn()
    monitor.register('session-1', 12345, '/vault/path', killFn)
    monitor.kill('session-1')
    expect(killFn).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/services/librarian-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LibrarianMonitor**

```typescript
// src/main/services/librarian-monitor.ts
import type { AgentSidecarState } from '@shared/agent-types'

interface TrackedSession {
  readonly sessionId: string
  readonly pid: number
  readonly cwd: string
  readonly startedAt: string
  status: 'alive' | 'exited'
  exitCode?: number
  killFn?: () => void
}

type OnChange = (states: AgentSidecarState[]) => void

/**
 * Lightweight process monitor for librarian child processes.
 * Emits AgentSidecarState-shaped snapshots compatible with the
 * existing agent:states-changed IPC pipeline.
 */
export class LibrarianMonitor {
  private sessions = new Map<string, TrackedSession>()
  private onChange: OnChange | null = null

  setOnChange(cb: OnChange): void {
    this.onChange = cb
  }

  register(sessionId: string, pid: number, cwd: string, killFn?: () => void): void {
    this.sessions.set(sessionId, {
      sessionId,
      pid,
      cwd,
      startedAt: new Date().toISOString(),
      status: 'alive',
      killFn
    })
    this.notify()
  }

  complete(sessionId: string, exitCode: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.status = 'exited'
    session.exitCode = exitCode
    this.notify()
  }

  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.notify()
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.killFn?.()
  }

  getStates(): AgentSidecarState[] {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      tmuxName: `librarian-${s.sessionId.slice(0, 8)}`,
      status: s.status,
      pid: s.pid,
      startedAt: s.startedAt,
      label: 'librarian',
      cwd: s.cwd
    }))
  }

  /** Kill all active librarian sessions. */
  killAll(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'alive') {
        session.killFn?.()
      }
    }
  }

  private notify(): void {
    this.onChange?.(this.getStates())
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/services/librarian-monitor.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/librarian-monitor.ts tests/main/services/librarian-monitor.test.ts
git commit -m "feat: add LibrarianMonitor for child process lifecycle tracking"
```

---

### Task 2: Add Type Discriminator to AgentSpawnRequest

**Files:**
- Modify: `src/shared/agent-types.ts:82-86`
- Modify: `src/shared/__tests__/agent-spawn-types.test.ts`

- [ ] **Step 1: Update the existing spawn types test**

Add test cases to `src/shared/__tests__/agent-spawn-types.test.ts`:

```typescript
it('accepts optional type field for librarian', () => {
  const request: AgentSpawnRequest = { cwd: '/vault', type: 'librarian' }
  expect(request.type).toBe('librarian')
})

it('defaults type to undefined for regular agents', () => {
  const request: AgentSpawnRequest = { cwd: '/vault' }
  expect(request.type).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/__tests__/agent-spawn-types.test.ts`
Expected: FAIL — type property does not exist on AgentSpawnRequest

- [ ] **Step 3: Add type field to AgentSpawnRequest**

In `src/shared/agent-types.ts`, change `AgentSpawnRequest`:

```typescript
/** IPC request shape for spawning an agent (sessionId and vaultRoot added by main). */
export interface AgentSpawnRequest {
  readonly cwd: string
  readonly prompt?: string
  readonly type?: 'librarian'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/__tests__/agent-spawn-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-types.ts src/shared/__tests__/agent-spawn-types.test.ts
git commit -m "feat: add type discriminator to AgentSpawnRequest"
```

---

### Task 3: Implement spawnLibrarian in AgentSpawner

**Files:**
- Modify: `src/main/services/agent-spawner.ts`
- Modify: `tests/main/agent-spawner.test.ts`

The new `spawnLibrarian()` method uses `child_process.spawn` directly, bypassing tmux and the wrapper script. The prompt is written to a temp file to avoid shell escaping issues.

- [ ] **Step 1: Write failing tests for spawnLibrarian**

Add to `tests/main/agent-spawner.test.ts`:

```typescript
// Add at the top with other imports:
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Mock child_process.spawn for spawnLibrarian tests
const mockChildProcess = vi.hoisted(() => ({
  spawned: null as unknown,
  onHandlers: {} as Record<string, (...args: unknown[]) => void>
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = {
        pid: 99999,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          mockChildProcess.onHandlers[event] = handler
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() }
      }
      mockChildProcess.spawned = child
      return child
    })
  }
})

describe('AgentSpawner.spawnLibrarian', () => {
  let mockShellService: ShellService

  beforeEach(() => {
    vi.clearAllMocks()
    mockShellService = createMockShellService()
    mockChildProcess.spawned = null
    mockChildProcess.onHandlers = {}
  })

  it('spawns claude CLI as a child process', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    expect(spawn).toHaveBeenCalledOnce()
    const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[0]).toBe('claude')
    expect(args[2].cwd).toBe('/vault/root')
  })

  it('passes system prompt via --system-prompt flag', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    const cliArgs: string[] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(cliArgs).toContain('--system-prompt')
  })

  it('includes --allowedTools with file tools', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    const cliArgs: string[] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(cliArgs).toContain('--allowedTools')
    const toolsIdx = cliArgs.indexOf('--allowedTools')
    const toolsArg = cliArgs[toolsIdx + 1]
    expect(toolsArg).toContain('Read')
    expect(toolsArg).toContain('Write')
    expect(toolsArg).toContain('Edit')
    expect(toolsArg).toContain('Glob')
    expect(toolsArg).toContain('Grep')
  })

  it('returns a session ID and registers with the monitor', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    const result = spawner.spawnLibrarian('/vault/root')
    expect(result.sessionId).toBeTruthy()
    expect(typeof result.sessionId).toBe('string')
  })

  it('does not call shellService.create', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    expect(mockShellService.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/agent-spawner.test.ts`
Expected: FAIL — spawnLibrarian is not a function

- [ ] **Step 3: Implement spawnLibrarian**

In `src/main/services/agent-spawner.ts`, add the import and method:

```typescript
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn as cpSpawn } from 'child_process'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'
import type { LibrarianMonitor } from './librarian-monitor'
import { TE_DIR } from '@shared/constants'

/** Shell-escape a string by wrapping in single quotes and escaping embedded quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Read the librarian system prompt, preferring a user-customized file over the bundled default. */
function readLibrarianPrompt(vaultRoot: string): string | null {
  const userCustomized = join(vaultRoot, TE_DIR, 'librarian-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }

  const bundledDefault = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'services', 'default-librarian-prompt.md')
    : join(__dirname, 'default-librarian-prompt.md')

  if (existsSync(bundledDefault)) {
    return readFileSync(bundledDefault, 'utf-8')
  }

  return null
}

/** Read the agent system prompt, preferring a user-customized file over the bundled default. */
function readAgentPrompt(vaultRoot: string): string | null {
  const userCustomized = join(vaultRoot, TE_DIR, 'agent-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }

  const bundledDefault = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'services', 'default-agent-prompt.md')
    : join(__dirname, 'default-agent-prompt.md')

  if (existsSync(bundledDefault)) {
    return readFileSync(bundledDefault, 'utf-8')
  }

  return null
}

export class AgentSpawner {
  private librarianMonitor: LibrarianMonitor | null = null

  constructor(
    private readonly shellService: ShellService,
    private readonly vaultRoot: string
  ) {}

  setLibrarianMonitor(monitor: LibrarianMonitor): void {
    this.librarianMonitor = monitor
  }

  /** Spawn a librarian as a direct child process (no tmux, no wrapper script). */
  spawnLibrarian(vaultPath: string): { sessionId: string } {
    const sessionId = randomUUID()
    const systemPrompt = readLibrarianPrompt(this.vaultRoot)

    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
      '--model', 'sonnet',
      'Run the librarian workflow on this vault.'
    ]

    if (systemPrompt) {
      args.unshift('--system-prompt', systemPrompt)
    }

    const child = cpSpawn('claude', args, {
      cwd: vaultPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    const killFn = () => {
      try { child.kill('SIGTERM') } catch { /* already dead */ }
    }

    this.librarianMonitor?.register(sessionId, child.pid ?? 0, vaultPath, killFn)

    child.on('exit', (code) => {
      this.librarianMonitor?.complete(sessionId, code ?? 0)
      // Auto-cleanup after a short delay so the UI can show the exited state
      setTimeout(() => {
        this.librarianMonitor?.cleanup(sessionId)
      }, 5000)
    })

    child.on('error', (err) => {
      console.error(`Librarian process error: ${err.message}`)
      this.librarianMonitor?.complete(sessionId, 1)
    })

    return { sessionId }
  }

  // ... existing spawn() method stays unchanged ...
```

Keep the existing `spawn()` method exactly as-is. Only add the new `spawnLibrarian()` method and the `librarianMonitor` field.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/agent-spawner.test.ts`
Expected: PASS (all tests including new ones)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-spawner.ts tests/main/agent-spawner.test.ts
git commit -m "feat: add spawnLibrarian using child_process.spawn"
```

---

### Task 4: Integrate LibrarianMonitor into IPC Layer

**Files:**
- Modify: `src/main/ipc/agents.ts`
- Modify: `src/main/index.ts:164-174`

Wire the LibrarianMonitor into the agent IPC handlers so the renderer sees librarian state through the same `agent:states-changed` pipeline.

- [ ] **Step 1: Update agents.ts to create and integrate LibrarianMonitor**

```typescript
// src/main/ipc/agents.ts
import type { TmuxMonitor } from '../services/tmux-monitor'
import type { AgentSpawner } from '../services/agent-spawner'
import { LibrarianMonitor } from '../services/librarian-monitor'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'

let activeMonitor: TmuxMonitor | null = null
let activeSpawner: AgentSpawner | null = null
let librarianMonitor: LibrarianMonitor | null = null

export function registerAgentIpc(): void {
  typedHandle('agent:get-states', async () => {
    const tmuxStates = activeMonitor ? activeMonitor.getAgentStates() : []
    const librarianStates = librarianMonitor ? librarianMonitor.getStates() : []
    return [...tmuxStates, ...librarianStates]
  })

  typedHandle('agent:spawn', async (request) => {
    if (!activeSpawner) return { error: 'Agent spawner not available' }

    // Dispatch librarian spawns to the direct child_process path
    if (request.type === 'librarian') {
      return activeSpawner.spawnLibrarian(request.cwd)
    }

    const sessionId = activeSpawner.spawn(request)
    return { sessionId }
  })
}

export function setAgentServices(monitor: TmuxMonitor | null, spawner: AgentSpawner | null): void {
  activeMonitor?.stop()

  activeMonitor = monitor
  activeSpawner = spawner

  // Create and wire the librarian monitor
  librarianMonitor = new LibrarianMonitor()
  spawner?.setLibrarianMonitor(librarianMonitor)

  // Push librarian state changes to the renderer
  librarianMonitor.setOnChange((librarianStates) => {
    const window = getMainWindow()
    if (window) {
      const tmuxStates = activeMonitor ? activeMonitor.getAgentStates() : []
      typedSend(window, 'agent:states-changed', {
        states: [...tmuxStates, ...librarianStates]
      })
    }
  })

  if (monitor) {
    monitor.start((tmuxStates) => {
      const window = getMainWindow()
      if (window) {
        const ls = librarianMonitor ? librarianMonitor.getStates() : []
        typedSend(window, 'agent:states-changed', {
          states: [...tmuxStates, ...ls]
        })
      }
    })
  }
}

export function stopAgentServices(): void {
  activeMonitor?.stop()
  activeMonitor = null
  activeSpawner = null
  librarianMonitor?.killAll()
  librarianMonitor = null
}
```

- [ ] **Step 2: Run existing agent IPC test to verify no regressions**

Run: `npx vitest run src/main/ipc/__tests__/agents-window.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/agents.ts
git commit -m "feat: integrate LibrarianMonitor into agent IPC layer"
```

---

### Task 5: Rewrite the Librarian Prompt

**Files:**
- Modify: `src/main/services/default-librarian-prompt.md`

Rewrite to reference native Claude file tools instead of MCP tools. Encode the full AK workflow.

- [ ] **Step 1: Write the new prompt**

```markdown
# Librarian

You are the librarian for this knowledge vault — a directory of interconnected markdown files that form a personal knowledge base. Your job is to compile, maintain, and enhance this wiki.

You have full read/write access to the vault. Work autonomously. Git is the safety net — the user will review your changes via diff.

## Your Responsibilities (in priority order)

### 1. Compile unprocessed sources

Find files with `origin: source` in their YAML frontmatter that have no compiled derivatives (no other file has `sources: [[this title]]` pointing back). For each:
- Read the full content
- Extract key concepts, claims, and data
- Write structured wiki articles with proper frontmatter
- Use existing tags from the vault for consistency
- Create backlinks to the source via `sources:` frontmatter

### 2. Lint for consistency

Scan the vault for:
- Conflicting claims across articles — create tension artifacts to flag them
- Inconsistent tags (same concept, different tag names) — normalize them
- Broken wikilinks (`[[Title]]` pointing to non-existent files) — fix or remove them
- Missing or malformed frontmatter — add or correct it

### 3. Maintain connections

Find articles discussing related topics that lack explicit links:
- Add `[[wikilinks]]` in body text where concepts are referenced
- Look for co-occurrence patterns that suggest missing relationships
- Strengthen the link graph so related knowledge is discoverable

### 4. Fill gaps

- Identify ghost references (wikilinks to files that don't exist) with high reference counts — write articles for the most-referenced ones
- Find topics with thin coverage relative to their importance — expand them
- Where data seems incomplete, note what's missing

### 5. Update the index

Write or update `_index.md` at the vault root with:
- Total article count by type
- Key concepts and their article counts
- Recent additions
- Coverage gaps and suggested research directions

## Output Contract

Every file you create MUST include this frontmatter:

```yaml
---
title: <descriptive title>
type: <one of: gene, constraint, research, output, note, index, tension>
origin: agent
tags:
  - <relevant tags, consistent with existing vault tags>
sources:
  - "[[Source Title 1]]"
  - "[[Source Title 2]]"
created: <today's date YYYY-MM-DD>
modified: <today's date YYYY-MM-DD>
---
```

### Naming

Slugify the title: lowercase, hyphens for spaces, no special characters. Place at vault root unless the vault has a clear directory structure.

Example: `concept-attention-mechanisms.md`

### Wikilinks

Use `[[Title]]` syntax to link to other articles. Check that the target exists before linking. Use the exact title from the target's frontmatter.

## Working Method

1. Start by reading `_index.md` if it exists to understand the vault's current state
2. Use Glob to survey the file structure: `**/*.md`
3. Read a sample of files to understand existing conventions (tags, types, writing style)
4. Work through your responsibilities in priority order
5. Update `_index.md` last, reflecting all changes made
```

- [ ] **Step 2: Verify the prompt file is readable by the spawner**

Run: `npx vitest run tests/main/agent-spawner.test.ts`
Expected: PASS (the existing `readLibrarianPrompt()` test still works)

- [ ] **Step 3: Commit**

```bash
git add src/main/services/default-librarian-prompt.md
git commit -m "feat: rewrite librarian prompt for native file tools"
```

---

### Task 6: Remove Librarian from Canvas Action Bar

**Files:**
- Modify: `src/shared/agent-action-types.ts:16-59`
- Modify: `tests/shared/agent-action-types.test.ts`
- Modify: `src/renderer/src/panels/canvas/CanvasActionBar.tsx:91-111`
- Modify: `src/renderer/src/panels/canvas/CanvasActionBar.tsx:8-14` (props)

- [ ] **Step 1: Update agent-action-types tests**

In `tests/shared/agent-action-types.test.ts`, update the expected values:

Change `it('has six actions'` to:
```typescript
it('has five actions', () => {
  expect(AGENT_ACTIONS).toHaveLength(5)
})
```

Change `it('contains challenge, emerge, organize, tidy, compile, librarian'` to:
```typescript
it('contains challenge, emerge, organize, tidy, compile', () => {
  const ids = AGENT_ACTIONS.map((a) => a.id)
  expect(ids).toEqual(['challenge', 'emerge', 'organize', 'tidy', 'compile'])
})
```

Update `AGENT_ACTION_NAMES` test:
```typescript
it('exports AGENT_ACTION_NAMES matching registry ids', () => {
  expect(AGENT_ACTION_NAMES).toEqual([
    'challenge',
    'emerge',
    'organize',
    'tidy',
    'compile'
  ])
})
```

Remove the `it('librarian requires no selection')` test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/agent-action-types.test.ts`
Expected: FAIL — still 6 actions

- [ ] **Step 3: Remove librarian from AGENT_ACTIONS**

In `src/shared/agent-action-types.ts`, remove the librarian entry from the `AGENT_ACTIONS` array (lines 52-58).

- [ ] **Step 4: Remove librarian button from CanvasActionBar**

In `src/renderer/src/panels/canvas/CanvasActionBar.tsx`:

Remove the `librarianActive` prop from `CanvasActionBarProps` (line 13).

Remove it from the destructured props (line 35).

Remove the librarian ActionButton block (lines 102-111):
```tsx
{hasAnyContent && (
  <ActionButton
    label="Librarian"
    action="librarian"
    isRunning={librarianActive}
    isBusy={isComputing}
    onTrigger={onTriggerAction}
    onStop={onStop}
  />
)}
```

- [ ] **Step 5: Update CanvasView to stop passing librarianActive to CanvasActionBar**

In `src/renderer/src/panels/canvas/CanvasView.tsx`, remove the `librarianActive` prop from the `<CanvasActionBar>` usage (line 655).

Keep the `librarianActive` computation and the `librarianSeenRef` — we'll route these to the toolbar in the next task.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run tests/shared/agent-action-types.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: PASS (all tests, check no broken imports from the type change)

- [ ] **Step 7: Commit**

```bash
git add src/shared/agent-action-types.ts tests/shared/agent-action-types.test.ts \
  src/renderer/src/panels/canvas/CanvasActionBar.tsx \
  src/renderer/src/panels/canvas/CanvasView.tsx
git commit -m "refactor: remove librarian from canvas action bar and agent actions"
```

---

### Task 7: Add Book Icon to Canvas Toolbar

**Files:**
- Modify: `src/renderer/src/panels/canvas/CanvasToolbar.tsx`
- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`

- [ ] **Step 1: Add librarian props to CanvasToolbar**

In `src/renderer/src/panels/canvas/CanvasToolbar.tsx`, add to `CanvasToolbarProps`:

```typescript
interface CanvasToolbarProps {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onAddCard: () => void
  readonly onOpenImport: () => void
  readonly onOrganize: () => void
  readonly organizePhase: string
  readonly librarianActive: boolean
  readonly onLibrarian: () => void
}
```

Add `librarianActive` and `onLibrarian` to the destructured props.

- [ ] **Step 2: Add the book icon button**

Insert a new divider and book button BEFORE the "Start Claude" button (before line 346). Place it after the "Show/Hide Edges" section:

```tsx
<div className="canvas-toolrail__divider" />

<div className="canvas-toolbtn-wrap">
  <button
    onClick={onLibrarian}
    className={`canvas-toolbtn${librarianActive ? ' canvas-toolbtn--active' : ''}`}
    data-testid="canvas-librarian"
  >
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={librarianActive ? { animation: 'te-pulse 2s ease-in-out infinite' } : undefined}
    >
      {/* Open book icon */}
      <path d="M8 3C6.5 2 4.5 1.5 2 2v10c2.5-.5 4.5 0 6 1" />
      <path d="M8 3c1.5-1 3.5-1.5 6-1v10c-2.5-.5-4.5 0-6 1" />
      <line x1="8" y1="3" x2="8" y2="13" />
    </svg>
  </button>
  <Tip label={librarianActive ? 'Stop Librarian' : 'Librarian'} />
</div>
```

- [ ] **Step 3: Wire CanvasView to pass librarian props to toolbar**

In `src/renderer/src/panels/canvas/CanvasView.tsx`, update the `<CanvasToolbar>` component to pass the new props.

Add a `handleLibrarian` callback:

```typescript
const handleLibrarian = useCallback(() => {
  if (librarianActive && agent.librarianSessionId) {
    // Kill the running librarian process via the spawn IPC
    // The monitor's killFn sends SIGTERM to the child process
    agent.setLibrarianSessionId(null)
  } else {
    const vp = useVaultStore.getState().vaultPath
    if (!vp) return
    void (async () => {
      try {
        const result = await window.api.agent.spawn({ cwd: vp, type: 'librarian' })
        if ('sessionId' in result) {
          agent.setLibrarianSessionId(result.sessionId)
        }
      } catch (err) {
        console.error('Librarian spawn failed:', err)
      }
    })()
  }
}, [librarianActive, agent])
```

Update `<CanvasToolbar>`:

```tsx
<CanvasToolbar
  canUndo={commandStack.current.canUndo()}
  canRedo={commandStack.current.canRedo()}
  onUndo={() => commandStack.current.undo()}
  onRedo={() => commandStack.current.redo()}
  onAddCard={() => { ... }}
  onOpenImport={() => setImportOpen(true)}
  onOrganize={ontology.startOrganize}
  organizePhase={ontology.phase}
  librarianActive={librarianActive}
  onLibrarian={handleLibrarian}
/>
```

- [ ] **Step 4: Remove the old librarian trigger from use-agent-orchestrator**

In `src/renderer/src/hooks/use-agent-orchestrator.ts`, remove the librarian special case from `trigger()` (lines 64-89). The librarian is now triggered directly from CanvasView, not through the orchestrator.

Keep `librarianSessionId`, `setLibrarianSessionId` in the hook's return value — they're still used by CanvasView for state tracking.

- [ ] **Step 5: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx tsc --noEmit --project tsconfig.web.json 2>&1 | grep -v 'TS6307\|TS2366' | head -20`
Expected: No new errors

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasToolbar.tsx \
  src/renderer/src/panels/canvas/CanvasView.tsx \
  src/renderer/src/hooks/use-agent-orchestrator.ts
git commit -m "feat: add librarian book icon to canvas toolbar"
```

---

### Task 8: End-to-End Verification

No code changes. Manual testing against a running dev instance.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open a vault with files**

Open an existing vault that contains markdown files.

- [ ] **Step 3: Verify the book icon appears on the canvas toolbar**

Look at the left vertical toolbar rail. The book icon should appear between "Show edges" and "Start Claude".

- [ ] **Step 4: Click the book icon**

The icon should pulse/animate. A child process should spawn running `claude -p`.

- [ ] **Step 5: Verify the session appears in workbench**

Switch to the workbench panel. The librarian session should appear in the agent states.

- [ ] **Step 6: Verify vault changes appear in the UI**

If the librarian creates or modifies files, they should appear in the sidebar file tree and canvas automatically (via the chokidar watcher).

- [ ] **Step 7: Verify git safety**

Run: `git diff` to see all changes the librarian made.
Run: `git checkout .` to revert cleanly.

- [ ] **Step 8: Run full quality gate**

Run: `npm run check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 9: Commit the spec update**

```bash
git add docs/superpowers/specs/2026-04-02-librarian-redesign.md \
  docs/superpowers/plans/2026-04-03-librarian-redesign.md
git commit -m "docs: add librarian redesign plan and update spec with council findings"
```
