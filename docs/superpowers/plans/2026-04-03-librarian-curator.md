# Librarian & Curator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the librarian prompt with a 5-pass audit workflow, fix stdout capture for visual feedback, and add a Curator button with selectable modes.

**Architecture:** Two vault-level `child_process.spawn` operations reusing the existing LibrarianMonitor infrastructure. Librarian outputs to `_librarian/`, Curator reads from `_librarian/` and applies additive-only changes to vault files. Both completely separate from canvas MCP agent actions.

**Tech Stack:** Electron, React, TypeScript, child_process.spawn, Claude CLI

**Spec:** `docs/superpowers/specs/2026-04-03-librarian-curator-design.md`

---

### Task 1: Replace librarian prompt

**Files:**
- Modify: `src/main/services/default-librarian-prompt.md`

- [ ] **Step 1: Replace the prompt file**

Overwrite the entire file with the 5-pass audit prompt:

```markdown
# Librarian

You are the Librarian for this knowledge vault -- a directory of interconnected
markdown files. Scan the vault and produce a single consolidated report.

## Setup

1. Read `_index.md` if it exists to understand the vault's current state
2. Use Glob to survey the file structure: `**/*.md`
3. Read a sample of files to understand existing conventions (tags, types, writing style)
4. Create the `_librarian/` directory if it doesn't exist
5. Run each pass below in order, writing results to a single report file at
   `_librarian/YYYY-MM-DD-audit.md` (use today's date)

## Pass 1: Contradictions

Scan for factual claims that conflict across articles. For each finding:
- Cite both source file paths and line numbers
- Include the conflicting quotes
- Flag confidence: **hard contradiction** vs. **ambiguous tension**

## Pass 2: Gaps

Identify:
- Claims missing citations
- Articles missing expected sections relative to peer articles
- Entities referenced but never defined (ghost wikilinks with no target file)

For each gap, propose a resolution with a markdown diff showing what to add.

## Pass 3: Connections

Find concept pairs that share substantial semantic overlap but lack cross-links.
For each, propose one or more of:
- (a) New backlinks to add
- (b) New bridging articles to create
- (c) Merges of redundant articles

Justify each proposal with specific overlapping claims or shared concepts.

## Pass 4: Staleness

Flag articles whose source material is older than 6 months or where the domain
has likely evolved. Prioritize by impact: articles that other articles depend on
(via wikilinks or sources) rank higher.

## Pass 5: Forward Questions

Propose 5-10 research questions the vault cannot yet answer but plausibly should.
Rank by how much existing material they would connect or build upon.

## Rules

- **Never edit existing vault files.** You may only create or edit files inside `_librarian/`.
- Cite article paths and line numbers for every finding.
- If a pass produces zero findings, say so explicitly and move on.
- Format the report in clean markdown with headers per pass, suitable for rich text review.
```

- [ ] **Step 2: Verify the file is valid markdown**

Run: `head -5 src/main/services/default-librarian-prompt.md`
Expected: First lines of the new prompt.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/default-librarian-prompt.md
git commit -m "feat: replace librarian prompt with 5-pass audit workflow"
```

---

### Task 2: Capture stdout and add process label to monitor

The spawn currently pipes stdout/stderr but never reads them. We need to:
1. Capture output so the renderer can show progress
2. Generalize the monitor label so it works for both librarian and curator

**Files:**
- Modify: `src/main/services/agent-spawner.ts:65-113`
- Modify: `src/main/services/librarian-monitor.ts:28-37,59-68`
- Modify: `tests/main/services/librarian-monitor.test.ts`

- [ ] **Step 1: Write failing test for label support in monitor**

Add to `tests/main/services/librarian-monitor.test.ts`:

```typescript
it('tracks a registered session with a custom label', () => {
  monitor.register('session-1', 12345, '/vault/path', undefined, 'curator')
  const states = monitor.getStates()
  expect(states[0].label).toBe('curator')
  expect(states[0].tmuxName).toBe('curator-session-1'.slice(0, 'curator-'.length + 8))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/main/services/librarian-monitor.test.ts`
Expected: FAIL because `register()` doesn't accept a label parameter.

- [ ] **Step 3: Update LibrarianMonitor.register to accept a label**

In `src/main/services/librarian-monitor.ts`, update the `TrackedSession` interface and `register` method:

```typescript
interface TrackedSession {
  readonly sessionId: string
  readonly pid: number
  readonly cwd: string
  readonly startedAt: string
  readonly label: string
  status: 'alive' | 'exited'
  exitCode?: number
  killFn?: () => void
}
```

Update `register`:

```typescript
register(sessionId: string, pid: number, cwd: string, killFn?: () => void, label = 'librarian'): void {
  this.sessions.set(sessionId, {
    sessionId,
    pid,
    cwd,
    startedAt: new Date().toISOString(),
    status: 'alive',
    label,
    killFn
  })
  this.notify()
}
```

Update `getStates` to use `s.label`:

```typescript
getStates(): AgentSidecarState[] {
  return [...this.sessions.values()].map((s) => ({
    sessionId: s.sessionId,
    tmuxName: `${s.label}-${s.sessionId.slice(0, 8)}`,
    status: s.status,
    pid: s.pid,
    startedAt: s.startedAt,
    label: s.label,
    cwd: s.cwd
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/main/services/librarian-monitor.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Add stdout capture to spawnLibrarian**

In `src/main/services/agent-spawner.ts`, add a `lastOutput` field to the monitor and wire stdout. After the `cpSpawn` call (line 83), add:

```typescript
child.stdout?.on('data', (chunk: Buffer) => {
  this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
})

child.stderr?.on('data', (chunk: Buffer) => {
  this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
})
```

- [ ] **Step 6: Add lastOutput tracking to LibrarianMonitor**

In `src/main/services/librarian-monitor.ts`, add `lastOutput` to `TrackedSession`:

```typescript
interface TrackedSession {
  readonly sessionId: string
  readonly pid: number
  readonly cwd: string
  readonly startedAt: string
  readonly label: string
  status: 'alive' | 'exited'
  exitCode?: number
  lastOutput?: string
  killFn?: () => void
}
```

Add the method:

```typescript
setLastOutput(sessionId: string, text: string): void {
  const session = this.sessions.get(sessionId)
  if (!session) return
  // Keep last 200 chars to avoid memory bloat
  session.lastOutput = text.slice(-200)
  this.notify()
}
```

Update `getStates` to include `lastOutput` via the `sidecar` field (reusing existing `AgentSidecarState.sidecar.currentTask`):

```typescript
getStates(): AgentSidecarState[] {
  return [...this.sessions.values()].map((s) => ({
    sessionId: s.sessionId,
    tmuxName: `${s.label}-${s.sessionId.slice(0, 8)}`,
    status: s.status,
    pid: s.pid,
    startedAt: s.startedAt,
    label: s.label,
    cwd: s.cwd,
    sidecar: s.lastOutput ? { filesTouched: [], currentTask: s.lastOutput } : undefined
  }))
}
```

- [ ] **Step 7: Write test for lastOutput**

Add to `tests/main/services/librarian-monitor.test.ts`:

```typescript
it('tracks last output via sidecar.currentTask', () => {
  monitor.register('session-1', 12345, '/vault/path')
  monitor.setLastOutput('session-1', 'Processing Pass 1: Contradictions...')
  const states = monitor.getStates()
  expect(states[0].sidecar?.currentTask).toBe('Processing Pass 1: Contradictions...')
})

it('truncates lastOutput to 200 chars', () => {
  monitor.register('session-1', 12345, '/vault/path')
  monitor.setLastOutput('session-1', 'x'.repeat(300))
  const states = monitor.getStates()
  expect(states[0].sidecar?.currentTask).toHaveLength(200)
})
```

- [ ] **Step 8: Run all monitor tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/main/services/librarian-monitor.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/services/librarian-monitor.ts src/main/services/agent-spawner.ts tests/main/services/librarian-monitor.test.ts
git commit -m "feat: capture stdout from librarian process, add label support to monitor"
```

---

### Task 3: Add curator spawn type and IPC dispatch

**Files:**
- Modify: `src/shared/agent-types.ts:83-87`
- Modify: `src/main/services/agent-spawner.ts`
- Modify: `src/main/ipc/agents.ts:18-28`
- Modify: `src/preload/index.ts:107-110`
- Create: `src/main/services/default-curator-prompt.md`
- Modify: `tests/main/agent-spawner.test.ts`

- [ ] **Step 1: Add 'curator' to AgentSpawnRequest type**

In `src/shared/agent-types.ts`, update the type union:

```typescript
export interface AgentSpawnRequest {
  readonly cwd: string
  readonly prompt?: string
  readonly type?: 'librarian' | 'curator'
  readonly curatorMode?: string
}
```

- [ ] **Step 2: Create default curator prompt**

Create `src/main/services/default-curator-prompt.md`:

```markdown
# Curator

You are the Curator for this knowledge vault. Your job is to apply approved
proposals from the Librarian's audit report to the vault files.

## Input

Read the librarian report(s) in `_librarian/` and the vault files they reference.

## Mode: {{MODE}}

{{MODE_DESCRIPTION}}

## Rules

- **ADDITIVE ONLY.** Never delete or modify existing text in vault files.
- You may add new sections, append content, insert wikilinks, and add frontmatter fields.
- You may create entirely new files if proposals call for bridging articles or new entries.
- For each change, note which librarian finding you are addressing (pass and finding number).
- Preserve all existing formatting, frontmatter, and content exactly as-is.
```

- [ ] **Step 3: Add readCuratorPrompt and spawnCurator to AgentSpawner**

In `src/main/services/agent-spawner.ts`, add after `readLibrarianPrompt`:

```typescript
/** Curator mode descriptions, keyed by mode ID. */
const CURATOR_MODES: Record<string, string> = {
  challenge: 'Stress-test ideas from the librarian report. For each proposal, add a "## Challenge" section to the relevant vault file examining assumptions, contradictions, and missing perspectives.',
  emerge: 'Surface hidden connections identified in the librarian report. Add "## Connections" sections with wikilinks and synthesis notes to relevant vault files.',
  research: 'Address gaps and forward questions from the librarian report. Add "## Research" sections with findings, citations, and proposed directions.',
  learn: 'Extract learning points from the librarian report. Add "## Key Learnings" sections summarizing insights and creating study-oriented content.'
}

function readCuratorPrompt(vaultRoot: string): string | null {
  const userCustomized = join(vaultRoot, TE_DIR, 'curator-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }

  const bundledDefault = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'services', 'default-curator-prompt.md')
    : join(__dirname, 'default-curator-prompt.md')

  if (existsSync(bundledDefault)) {
    return readFileSync(bundledDefault, 'utf-8')
  }

  return null
}
```

Add `spawnCurator` method to `AgentSpawner`:

```typescript
/** Spawn a curator as a direct child process. */
spawnCurator(vaultPath: string, mode: string): { sessionId: string } {
  const sessionId = randomUUID()
  let systemPrompt = readCuratorPrompt(this.vaultRoot)

  const modeDescription = CURATOR_MODES[mode] ?? `Apply the "${mode}" workflow to the vault based on the librarian report.`

  if (systemPrompt) {
    systemPrompt = systemPrompt
      .replace('{{MODE}}', mode.charAt(0).toUpperCase() + mode.slice(1))
      .replace('{{MODE_DESCRIPTION}}', modeDescription)
  }

  const args = [
    '-p',
    '--dangerously-skip-permissions',
    '--allowedTools',
    'Read,Write,Edit,Glob,Grep,Bash',
    '--model',
    'sonnet',
    `Run the curator ${mode} workflow on this vault using the librarian reports in _librarian/.`
  ]

  if (systemPrompt) {
    args.unshift('--system-prompt', systemPrompt)
  }

  const child = cpSpawn('claude', args, {
    cwd: vaultPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
  })

  const killFn = () => {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already dead */
    }
  }

  this.librarianMonitor?.register(sessionId, child.pid ?? 0, vaultPath, killFn, 'curator')

  child.on('exit', (code) => {
    this.librarianMonitor?.complete(sessionId, code ?? 0)
    setTimeout(() => {
      this.librarianMonitor?.cleanup(sessionId)
    }, 5000)
  })

  child.on('error', (err) => {
    console.error(`Curator process error: ${err.message}`)
    this.librarianMonitor?.complete(sessionId, 1)
  })

  return { sessionId }
}
```

- [ ] **Step 4: Add curator dispatch to IPC handler**

In `src/main/ipc/agents.ts`, update the `agent:spawn` handler (line 18-28):

```typescript
typedHandle('agent:spawn', async (request) => {
  if (!activeSpawner) return { error: 'Agent spawner not available' }

  if (request.type === 'librarian') {
    return activeSpawner.spawnLibrarian(request.cwd)
  }

  if (request.type === 'curator') {
    return activeSpawner.spawnCurator(request.cwd, request.curatorMode ?? 'emerge')
  }

  const sessionId = activeSpawner.spawn(request)
  return { sessionId }
})
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agent-types.ts src/main/services/agent-spawner.ts src/main/services/default-curator-prompt.md src/main/ipc/agents.ts
git commit -m "feat: add curator spawn type with mode selection"
```

---

### Task 4: Add curator button and mode popup to toolbar

**Files:**
- Modify: `src/renderer/src/panels/canvas/CanvasToolbar.tsx:10-21,374-376`
- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx:96,105-122,634-651,662-679`

- [ ] **Step 1: Add curator props to CanvasToolbar**

In `src/renderer/src/panels/canvas/CanvasToolbar.tsx`, update the props interface (line 10-21):

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
  readonly curatorActive: boolean
  readonly onCurator: (mode: string) => void
}
```

- [ ] **Step 2: Add curator button with mode popup after the librarian button**

In `CanvasToolbar.tsx`, after the librarian `</div>` (line 374), add the curator button before the existing divider:

```tsx
{/* Curator button with mode popup */}
<div ref={curatorMenuRef} style={{ position: 'relative' }}>
  <div className="canvas-toolbtn-wrap">
    <button
      onClick={() => {
        if (curatorActive) return
        setCuratorMenuOpen((prev) => !prev)
      }}
      className={`canvas-toolbtn${curatorActive ? ' canvas-toolbtn--active' : ''}`}
      data-testid="canvas-curator"
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
        style={curatorActive ? { animation: 'te-pulse 2s ease-in-out infinite' } : undefined}
      >
        {/* Stamp/seal icon */}
        <rect x="4" y="1" width="8" height="4" rx="1" />
        <line x1="8" y1="5" x2="8" y2="9" />
        <rect x="2" y="9" width="12" height="5" rx="1" />
      </svg>
    </button>
    <Tip label={curatorActive ? 'Curator running...' : 'Curator'} />
  </div>
  {curatorMenuOpen && (
    <div
      className="sidebar-popover absolute flex flex-col gap-1 p-2"
      style={{
        top: 0,
        left: '100%',
        marginLeft: 8,
        minWidth: 160,
        zIndex: 100
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '2px 8px', marginBottom: 2 }}>
        Select mode
      </div>
      {[
        { id: 'challenge', label: 'Challenge', desc: 'Stress-test ideas' },
        { id: 'emerge', label: 'Emerge', desc: 'Surface connections' },
        { id: 'research', label: 'Research', desc: 'Address gaps' },
        { id: 'learn', label: 'Learn', desc: 'Extract learnings' }
      ].map((mode) => (
        <button
          key={mode.id}
          onClick={() => {
            onCurator(mode.id)
            setCuratorMenuOpen(false)
          }}
          className="sidebar-popover__item"
          style={{ textAlign: 'left', padding: '4px 8px', borderRadius: 4 }}
        >
          <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{mode.label}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{mode.desc}</div>
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 3: Add state and ref for curator menu**

At the top of the `CanvasToolbar` component function, add:

```typescript
const [curatorMenuOpen, setCuratorMenuOpen] = useState(false)
const curatorMenuRef = useRef<HTMLDivElement>(null)
```

And add the click-outside handler (same pattern as the existing `envMenuRef`):

```typescript
useEffect(() => {
  if (!curatorMenuOpen) return
  const handleClickOutside = (e: MouseEvent) => {
    if (curatorMenuRef.current && !curatorMenuRef.current.contains(e.target as Node)) {
      setCuratorMenuOpen(false)
    }
  }
  document.addEventListener('mousedown', handleClickOutside)
  return () => document.removeEventListener('mousedown', handleClickOutside)
}, [curatorMenuOpen])
```

- [ ] **Step 4: Destructure new props in CanvasToolbar**

Update the destructured props to include `curatorActive` and `onCurator`.

- [ ] **Step 5: Wire curator state in CanvasView**

In `src/renderer/src/panels/canvas/CanvasView.tsx`, add curator tracking alongside the librarian tracking.

After `librarianSeenRef` (line 104), add:

```typescript
const curatorSeenRef = useRef(false)
const curatorActive = useMemo(() => {
  if (!agent.curatorSessionId) {
    curatorSeenRef.current = false
    return false
  }
  const session = agentStates.find((s) => s.sessionId === agent.curatorSessionId)
  if (session && session.status !== 'exited') {
    curatorSeenRef.current = true
    return true
  }
  if (curatorSeenRef.current) {
    queueMicrotask(() => agent.setCuratorSessionId(null))
    return false
  }
  return true
}, [agent.curatorSessionId, agentStates, agent.setCuratorSessionId])
```

- [ ] **Step 6: Add handleCurator callback**

After `handleLibrarian` (line 651), add:

```typescript
const handleCurator = useCallback((mode: string) => {
  if (curatorActive && agent.curatorSessionId) {
    agent.setCuratorSessionId(null)
  } else {
    const vp = useVaultStore.getState().vaultPath
    if (!vp) return
    void (async () => {
      try {
        const result = await window.api.agent.spawn({ cwd: vp, type: 'curator', curatorMode: mode })
        if ('sessionId' in result) {
          agent.setCuratorSessionId(result.sessionId)
        }
      } catch (err) {
        console.error('Curator spawn failed:', err)
      }
    })()
  }
}, [curatorActive, agent])
```

- [ ] **Step 7: Add curatorSessionId state to useAgentOrchestrator**

In `src/renderer/src/hooks/use-agent-orchestrator.ts`, after `librarianSessionId` (line 55), add:

```typescript
const [curatorSessionId, setCuratorSessionId] = useState<string | null>(null)
```

And add to the return object:

```typescript
return {
  ...state,
  librarianSessionId,
  setLibrarianSessionId,
  curatorSessionId,
  setCuratorSessionId,
  trigger,
  apply,
  cancel
}
```

- [ ] **Step 8: Pass curator props to CanvasToolbar**

In `CanvasView.tsx`, update the `<CanvasToolbar>` JSX to include:

```tsx
curatorActive={curatorActive}
onCurator={handleCurator}
```

- [ ] **Step 9: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasToolbar.tsx src/renderer/src/panels/canvas/CanvasView.tsx src/renderer/src/hooks/use-agent-orchestrator.ts
git commit -m "feat: add curator toolbar button with mode selection popup"
```

---

### Task 5: Add distinct color for librarian artifacts

Files in `_librarian/` should be visually distinct on canvas. The parser assigns `type` from frontmatter, but librarian reports won't necessarily have a recognized type. We add a path-based color override.

**Files:**
- Modify: `src/renderer/src/design/tokens.ts:72-77`

- [ ] **Step 1: Add path-based override in getArtifactColor**

This is a minimal change. In `src/renderer/src/design/tokens.ts`, the `getArtifactColor` function currently takes a `type` string. We don't want to change its signature since it's used everywhere. Instead, we add `'librarian'` as a recognized artifact type color:

Add to the `ARTIFACT_COLORS` object (line 39-49). This requires also adding `'librarian'` to `ARTIFACT_TYPES` in `src/shared/types.ts`.

Actually, the simpler approach: librarian report files will have frontmatter with `type: librarian`. The `getArtifactColor` function already falls through to a hash-based palette for unknown types. We just need to add an explicit color entry.

In `src/renderer/src/design/tokens.ts`, add after the `ARTIFACT_COLORS` object closing (but before `as const satisfies`):

We can't add to `ARTIFACT_COLORS` without also updating `BuiltInArtifactType`. The cleaner approach is to handle it in the `getArtifactColor` function itself:

```typescript
export function getArtifactColor(type: string): string {
  if (type === 'tag') return '#dfa11a'
  if (type === 'librarian') return '#60b8d6' // oklch(0.75 0.12 220) distinct cyan
  const builtIn = (ARTIFACT_COLORS as Record<string, string>)[type]
  if (builtIn) return builtIn
  return CUSTOM_TYPE_PALETTE[hashString(type) % CUSTOM_TYPE_PALETTE.length]
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/design/tokens.ts
git commit -m "feat: add distinct cyan color for librarian artifact type"
```

---

### Task 6: Add stdout capture to existing librarian spawn

Task 2 added the monitor support. This task wires it into the existing `spawnLibrarian` method if not already done in Task 2.

**Covered by Task 2, Step 5.** Skip this task if Task 2 is complete.

---

### Task 7: Update librarian prompt in toolbar to indicate type: librarian in output

The librarian prompt (Task 1) tells Claude to write reports to `_librarian/YYYY-MM-DD-audit.md`. For those files to render with the librarian color on canvas, they need `type: librarian` in frontmatter. Update the prompt to specify this.

**Files:**
- Modify: `src/main/services/default-librarian-prompt.md`

- [ ] **Step 1: Add frontmatter instruction to the prompt**

Add after the "Setup" section, before "Pass 1":

```markdown
## Report Format

Begin the report file with this frontmatter:

\`\`\`yaml
---
title: "Librarian Audit YYYY-MM-DD"
type: librarian
origin: agent
created: YYYY-MM-DD
---
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/default-librarian-prompt.md
git commit -m "feat: add frontmatter template to librarian prompt for type coloring"
```

---

### Task 8: Run quality gate

- [ ] **Step 1: Run full quality gate**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run check`
Expected: Zero lint errors, zero type errors, all tests pass.

- [ ] **Step 2: Fix any issues found**

If there are failures, fix them and re-run.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve lint and typecheck errors from librarian-curator implementation"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Start dev app**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run dev`

- [ ] **Step 2: Verify librarian button**

Click the book icon in the toolbar. Confirm:
- Process spawns (pulse animation plays)
- "Stop Librarian" tooltip appears
- After completion, `_librarian/` directory is created with an audit report
- The report file appears on canvas with cyan color

- [ ] **Step 3: Verify curator button**

Click the curator (stamp) icon. Confirm:
- Mode popup appears with Challenge/Emerge/Research/Learn options
- Selecting a mode spawns the process
- Pulse animation plays while running
- Tooltip shows "Curator running..."

- [ ] **Step 4: Take screenshot for verification**

Ask user to share a screenshot showing both buttons and the curator popup.
