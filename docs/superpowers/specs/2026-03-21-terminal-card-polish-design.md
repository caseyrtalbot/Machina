# Terminal Card Visual Polish

## Context

The terminal card rendering pipeline is excellent (xterm.js + WebGL + Catppuccin Mocha + counter-scale zoom), but the visual wrapper is generic. Every card type shares the same CardShell chrome, making terminal cards look like "a card containing a terminal" rather than "a terminal living on the canvas." This spec covers CSS/style changes only, no architectural changes.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Visual identity | Ghostty-native | Terminal card should feel like a terminal window, not a generic card |
| Traffic light dots | Skip entirely | macOS metaphor doesn't map to canvas semantics |
| Transparency approach | CSS opacity on wrapper | Keep WebGL for crisp text, blur shows in padding insets only |
| Internal padding | 8px 12px (iTerm2 default) | Comfortable breathing room without wasting columns |
| Card frame | Keep existing | 6px radius, existing shadow, existing inset border unchanged |

## Changes

### 1. Title Bar: CWD Display

**Current**: Generic "Terminal" or "Claude Live" text in CardShell title.

**After**: Show the terminal's initial working directory from `node.metadata.initialCwd`, shortened to `~/relative/path`. For Claude cards (`initialCommand === 'claude'`), keep "Claude Live".

Implementation:
- Use `initialCwd` from node metadata (already available at line 34 of TerminalCard.tsx)
- Shorten absolute path by replacing the home directory prefix with `~`
- If `initialCwd` is null, fall back to "Terminal"
- Pass the computed title string to `<CardShell title={...}>`
- No new IPC channels needed (avoids polling complexity for a display-only feature)

### 2. Internal Padding: 8px 12px

**Before**: `padding: '4px 0 0 4px'` on the `termContainerRef` div (TerminalCard.tsx, the div with `ref={termContainerRef}`).

**After**: `padding: '8px 12px'` on the same div.

```tsx
// Before (TerminalCard.tsx, termContainerRef div):
style={{ padding: '4px 0 0 4px', minHeight: 0 }}

// After:
style={{ padding: '8px 12px', minHeight: 0 }}
```

The FitAddon will automatically recalculate columns/rows to account for the reduced content area. No other changes needed.

### 3. Background Transparency

**Current**: Opaque background on the content wrapper div (the `className="h-full relative"` div at TerminalCard.tsx line 343).

**After**: Semi-transparent background with blur on the `termContainerRef` div (the innermost div that wraps the actual xterm element, inside the counter-scale container). This is the div that has the padding from change #2.

```tsx
// termContainerRef div:
style={{
  padding: '8px 12px',
  minHeight: 0,
  background: 'rgba(12, 14, 20, 0.85)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)'
}}
```

Why this div: The `termContainerRef` div is inside the counter-scale wrapper but outside xterm's own canvas. The 8px/12px padding creates visible inset areas where the semi-transparent background lets the canvas dot grid bleed through. xterm's WebGL canvas renders its own opaque background on top, so text rendering is unaffected.

Note: The outer `h-full relative` div has `overflow: 'hidden'`. Since the blur is applied to a child div within the overflow boundary, the blur effect is contained and renders correctly in the padding insets.

### 4. Focus State: Accent Glow

**Before** (on the `h-full relative` wrapper div):
```tsx
outline: focused ? `1px solid ${colors.accent.default}` : 'none',
outlineOffset: -1
```

**After** (same div, replace both properties):
```tsx
boxShadow: focused
  ? `0 0 0 1.5px ${colors.accent.default}, 0 0 12px rgba(0, 229, 191, 0.15)`
  : undefined
// Remove outline and outlineOffset entirely
```

This produces a subtle ambient glow rather than a hard border when the terminal is focused.

### 5. Title Bar Background

Drop this change from scope. The existing CardShell title bar background is consistent across card types and changing it for terminals only would require adding a prop to CardShell, which contradicts the goal of keeping CardShell untouched. The terminal's visual identity comes from the content area styling, not the title bar chrome.

## Files Modified

| File | Change |
|------|--------|
| `src/renderer/src/panels/canvas/TerminalCard.tsx` | Padding, transparency, focus glow, CWD title |

## What Does NOT Change

- CardShell component (no props added, no structural changes)
- xterm configuration (font family, theme colors, scrollback, WebGL, cursor)
- Counter-scale zoom trick
- PTY session lifecycle
- Card frame (6px radius, shadow, inset border)
- No new dependencies, no new card types, no new IPC channels
- `tokens.ts` (no new tokens needed, values are inline in TerminalCard)

## Verification

1. `npm run typecheck` passes
2. `npm test` passes (no test changes needed, these are style-only)
3. Manual visual check:
   - Terminal card shows CWD in title bar
   - Comfortable 8px 12px padding around xterm content
   - Canvas dot grid subtly visible through padding insets
   - Accent glow (not outline) on focus
4. Terminal card at various zoom levels: text stays crisp (WebGL unaffected)
5. Multiple terminal cards: no performance regression from backdrop-filter
6. Claude Live card still shows "Claude Live" title (not CWD)
