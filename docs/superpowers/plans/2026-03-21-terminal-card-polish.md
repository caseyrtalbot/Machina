# Terminal Card Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the terminal card from generic CardShell chrome to Ghostty-native visual identity with comfortable padding, translucent blur insets, accent glow focus, and CWD title.

**Architecture:** Four CSS/style changes in `TerminalCard.tsx` only. No CardShell modifications, no new IPC, no new dependencies. The xterm rendering pipeline (WebGL, counter-scale, FitAddon) is untouched.

**Tech Stack:** React, xterm.js, CSS (inline styles), existing design tokens

**Spec:** `docs/superpowers/specs/2026-03-21-terminal-card-polish-design.md`

---

### Task 1: CWD Title Display

**Files:**
- Modify: `src/renderer/src/panels/canvas/TerminalCard.tsx:34,337-340`

- [ ] **Step 1: Compute CWD title**

Add a `useMemo` to compute the display title from `initialCwd`. Insert after line 34 (`const initialCwd = ...`):

```tsx
const homePath = window.api.getHomePath?.() ?? ''

const displayTitle = useMemo(() => {
  if (node.metadata?.initialCommand === 'claude') return 'Claude Live'
  if (!initialCwd) return 'Terminal'
  if (homePath && initialCwd.startsWith(homePath)) {
    return '~' + initialCwd.slice(homePath.length)
  }
  return initialCwd
}, [initialCwd, node.metadata?.initialCommand, homePath])
```

Add `useMemo` to the existing React import on line 1 (it's not currently imported).

- [ ] **Step 2: Wire title into CardShell**

Replace line 339:

```tsx
// Before:
title={node.metadata?.initialCommand === 'claude' ? 'Claude Live' : 'Terminal'}

// After:
title={displayTitle}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/TerminalCard.tsx
git commit -m "feat: show CWD in terminal card title bar"
```

---

### Task 2: Comfortable Internal Padding

**Files:**
- Modify: `src/renderer/src/panels/canvas/TerminalCard.tsx:377`

- [ ] **Step 1: Update padding**

Change the `termContainerRef` div's padding on line 377:

```tsx
// Before:
style={{ padding: '4px 0 0 4px', minHeight: 0 }}

// After:
style={{ padding: '8px 12px', minHeight: 0 }}
```

FitAddon recalculates cols/rows automatically on the next resize observer tick.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/TerminalCard.tsx
git commit -m "feat: increase terminal card padding to 8px 12px"
```

---

### Task 3: Semi-Transparent Background with Blur

**Files:**
- Modify: `src/renderer/src/panels/canvas/TerminalCard.tsx:377`

- [ ] **Step 1: Add transparency and blur to termContainerRef div**

Extend the style object on the `termContainerRef` div (same div as Task 2):

```tsx
// Before (after Task 2):
style={{ padding: '8px 12px', minHeight: 0 }}

// After:
style={{
  padding: '8px 12px',
  minHeight: 0,
  background: 'rgba(12, 14, 20, 0.85)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)'
}}
```

The blur is visible only in the 8px/12px padding insets. xterm's WebGL canvas paints its own opaque `#0c0e14` background on top, so terminal text rendering is unaffected.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/TerminalCard.tsx
git commit -m "feat: add translucent blur background to terminal card padding"
```

---

### Task 4: Focus Glow

**Files:**
- Modify: `src/renderer/src/panels/canvas/TerminalCard.tsx:355-360`

- [ ] **Step 1: Replace outline with boxShadow glow**

On the `h-full relative` wrapper div, replace the `outline` and `outlineOffset` properties:

```tsx
// Before:
style={{
  minHeight: 0,
  overflow: 'hidden',
  outline: focused ? `1px solid ${colors.accent.default}` : 'none',
  outlineOffset: -1
}}

// After:
style={{
  minHeight: 0,
  overflow: 'hidden',
  boxShadow: focused
    ? `0 0 0 1.5px ${colors.accent.default}, 0 0 12px rgba(0, 229, 191, 0.15)`
    : undefined
}}
```

Both `outline` and `outlineOffset` are removed entirely. The `boxShadow` produces a soft ambient glow instead of a hard border.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: no errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/TerminalCard.tsx
git commit -m "feat: replace terminal focus outline with accent glow"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full verification suite**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass

- [ ] **Step 2: Manual visual verification**

Run `npm run dev`, open the app, and verify:
- Terminal card title shows CWD (e.g. `~/Projects/thought-engine`)
- Claude Live card still shows "Claude Live"
- Comfortable padding around terminal text (8px top/bottom, 12px left/right)
- Canvas dot grid subtly visible through padding insets (translucent blur)
- Soft accent glow on terminal focus (not a hard outline)
- Text stays crisp at all zoom levels (WebGL unaffected)
- Multiple terminal cards render without performance issues
