# Full-Bleed Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ViewTabBar and StatusBar to make the canvas/content area full-bleed edge-to-edge, matching Collaborator's layout. Move tab switching into the existing ActivityBar. Brighten the canvas dot grid.

**Architecture:** The content area currently has 3 layers of chrome eating vertical space: 28px titlebar + 36px tab bar + 24px status bar = 88px lost. We keep the ActivityBar (48px wide, left edge) as the sole view switcher, remove the tab bar and status bar, and move the settings gear into the sidebar header. The titlebar drag region becomes transparent and overlays the content.

**Tech Stack:** React, TypeScript, Tailwind, CSS

---

### Task 1: Remove ViewTabBar from ContentArea

**Files:**
- Modify: `src/renderer/src/App.tsx:52-106` (ContentArea component)

- [ ] **Step 1: Remove ViewTabBar from ContentArea render**

In `ContentArea`, remove the `<ViewTabBar>` and its wrapper div. The content panel should fill the full height.

```tsx
// BEFORE (lines 70-73):
<div className="h-full flex flex-col">
  <ViewTabBar onOpenSettings={onOpenSettings} />
  <div className="flex-1 overflow-hidden panel-card">

// AFTER:
<div className="h-full overflow-hidden panel-card">
```

Remove the `onOpenSettings` prop from `ContentArea` since the settings gear will move to the sidebar.

- [ ] **Step 2: Remove ViewTabBar import**

Remove the import of `ViewTabBar` from App.tsx.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

---

### Task 2: Remove StatusBar from WorkspaceShell

**Files:**
- Modify: `src/renderer/src/App.tsx:410-634` (WorkspaceShell component)

- [ ] **Step 1: Remove StatusBar from render**

In `WorkspaceShell`, remove `<StatusBar />` (line 620).

- [ ] **Step 2: Remove StatusBar import**

Remove the `StatusBar` import from App.tsx.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

---

### Task 3: Make titlebar drag region overlay content

**Files:**
- Modify: `src/renderer/src/App.tsx:571-579` (titlebar div in WorkspaceShell)

- [ ] **Step 1: Change titlebar from block to absolute overlay**

The titlebar currently takes 28px of vertical space as a block element. Change it to an absolute overlay so the content flows under it. The macOS traffic lights still need the drag region.

```tsx
// BEFORE:
<div
  className="shrink-0"
  style={{
    height: 28,
    WebkitAppRegion: 'drag'
  } as React.CSSProperties}
/>

// AFTER:
<div
  className="absolute top-0 left-0 right-0 z-50"
  style={{
    height: 28,
    WebkitAppRegion: 'drag'
  } as React.CSSProperties}
/>
```

Also change the parent from `flex flex-col` to `relative flex flex-col` so the absolute positioning works, and remove `flex-1` from the main body since it should now fill the full screen height.

- [ ] **Step 2: Verify layout**

Run: `npm run typecheck`

---

### Task 4: Move settings gear to sidebar header

**Files:**
- Modify: `src/renderer/src/panels/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx` (ConnectedSidebar)

- [ ] **Step 1: Add settings button to Sidebar's ActionBar**

Add an `onOpenSettings` prop to Sidebar and its ActionBar. Render a settings gear icon button in the ActionBar, right-aligned.

- [ ] **Step 2: Wire onOpenSettings from WorkspaceShell to ConnectedSidebar**

Pass the `setSettingsOpen` callback through ConnectedSidebar down to Sidebar.

- [ ] **Step 3: Remove onOpenSettings from ContentArea**

Clean up the `onOpenSettings` prop that was removed from ContentArea in Task 1.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

---

### Task 5: Brighten canvas dot grid

**Files:**
- Modify: `src/renderer/src/panels/canvas/CanvasSurface.tsx:150`

- [ ] **Step 1: Increase dot grid opacity**

```tsx
// BEFORE (line 150):
const gridSvg = buildGridSvg('rgba(148, 163, 184, 0.25)', 'rgba(148, 163, 184, 0.5)')

// AFTER:
const gridSvg = buildGridSvg('rgba(148, 163, 184, 0.4)', 'rgba(148, 163, 184, 0.7)')
```

- [ ] **Step 2: Typecheck and verify**

Run: `npm run typecheck`

---

### Task 6: Clean up unused imports and verify

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Remove all unused imports**

Remove imports for `ViewTabBar`, `StatusBar`, and any props/types no longer referenced.

- [ ] **Step 2: Full typecheck and test**

Run: `npm run typecheck && npm test`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/panels/sidebar/Sidebar.tsx src/renderer/src/panels/canvas/CanvasSurface.tsx
git commit -m "feat: full-bleed layout with activity bar view switching

Remove ViewTabBar and StatusBar chrome to make canvas/content
edge-to-edge. Settings gear moves to sidebar header. Titlebar
drag region overlays content instead of consuming vertical space.
Brighten canvas dot grid for better spatial orientation."
```
