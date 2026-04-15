# Canvas TextCard: Rich Text + Save-to-Vault

**Status:** Draft — awaiting user review
**Date:** 2026-04-15
**Scope:** Canvas panel only (`src/renderer/src/panels/canvas/`)

## Problem

Canvas TextCards are plain textareas. Users want:

1. Basic rich text formatting (bold, italic, headings, lists, etc.) with keyboard shortcuts.
2. A way to promote a TextCard to a vault note — either as a new markdown file in a chosen folder, or appended to an existing file.

## Goals

- Preserve markdown as the single storage format for TextCard content (no HTML, no proprietary JSON).
- Lightweight editing surface — not a full Note editor. No wikilinks, mermaid, callouts, concept nodes, or tables in TextCards.
- Zero new IPC channels. Reuse existing `fs:*` primitives.
- TextCard file stays under 200 lines. Pure save logic is unit-testable without React or IPC.

## Non-Goals

- No section targeting for "append" (v1 appends to end of file).
- No frontmatter generation for saved notes (v1).
- No per-card formatting presets or saved styles.
- No conversion from TextCard to a full `note` card type post-save (card remains a TextCard with a badge).

## Architecture

### File Layout

**New:**

- `src/renderer/src/panels/canvas/RichTextCardEditor.tsx` — Tiptap wrapper, ~120 lines.
- `src/renderer/src/panels/canvas/text-card-save.ts` — pure functions, no React/IPC deps.
- `src/renderer/src/panels/canvas/SaveTextCardDialog.tsx` — modal for "Save to…", ~200 lines.
- `src/renderer/src/panels/canvas/useSaveTextCard.ts` — hook composing settings + pure fns + IPC.
- `src/renderer/src/panels/canvas/__tests__/text-card-save.test.ts`
- `src/renderer/src/panels/canvas/__tests__/RichTextCardEditor.test.tsx`
- `src/renderer/src/panels/canvas/__tests__/useSaveTextCard.test.ts`
- `src/renderer/src/panels/canvas/__tests__/TextCard.test.tsx`
- `src/renderer/src/panels/canvas/__tests__/SaveTextCardDialog.test.tsx`

**Modified:**

- `TextCard.tsx` — swap textarea for `RichTextCardEditor`; render save badge; wire header save button.
- `CardContextMenu.tsx` — accept optional `onQuickSave` and `onSaveAs` props; render two items when present.
- `CanvasView.tsx` (or wherever context menu is owned) — pass handlers when the right-clicked card is a text card.
- `settings-store.ts` — add `canvasTextSaveFolder: string` with default `'Inbox'`.
- `src/shared/canvas-types.ts` — extend `CanvasNode` with optional `savedToPath?: string` and `savedContentHash?: string` (used to hide the badge when the card is edited post-save).

### Rich Text Editor Component

`RichTextCardEditor.tsx` wraps Tiptap's `useEditor` with a reduced extension set distinct from the full canvas Markdown/Note editor.

**Extensions:**

- `StarterKit` (codeBlock: false — relies on starter's default code block behavior)
- `Markdown` (`@tiptap/markdown`) — markdown serialization round-trip
- `TaskList`, `TaskItem` (nested)
- `HighlightMark` (reused from `editor/extensions/highlight-mark`)
- `Link` (from StarterKit)

**Explicitly excluded** (to keep cards lightweight and distinct from notes):

- `ConceptNodeMark`, `MermaidCodeBlock`, `CalloutBlock`, `WikilinkNode`, `MachinaTableKit`.

**Props:**

```ts
interface RichTextCardEditorProps {
  value: string              // markdown
  editing: boolean           // controls editable state
  onChange: (markdown: string) => void
  onExit: (commit: boolean) => void   // blur or Esc/⌘↩
  onSaveShortcut: () => void          // ⌘⇧S
}
```

**Content sync:** editor is initialized once with `value` via `useEditor`'s initial content. `onUpdate` callback fires `onChange(editor.storage.markdown.getMarkdown())`. No `useEffect` pushes value back into the editor — content flows through user-action callbacks only (matches the project rule in `CLAUDE.md`).

**Non-editing render:** when `editing=false`, calls `editor.setEditable(false)` in an effect keyed on `editing`. The same Tiptap DOM renders read-only. Avoids a separate read-only markdown renderer.

**Heading styles:** the component applies a prose-style CSS class to the editor content root so H1–H6 render at visibly different sizes. Without this, the card's default `text-sm` flattens all headings. Use the same Tailwind prose token set that MarkdownCard uses, or define a dedicated class in `design/tokens.ts`.

### Keybindings

Tiptap's built-ins provide `⌘B`, `⌘I`, `⌘U`, `⌘K` (link), `#`/`##`/`###` headings, `- ` bullet list, `1. ` ordered list, ` ``` ` inline code, `==text==` highlight, `- [ ]` task.

Canvas-specific additions, registered via Tiptap's `addKeyboardShortcut` on a tiny custom extension:

| Shortcut | Action |
|---|---|
| `⌘↩` | `onExit(true)` — commit + exit edit mode |
| `Esc` | `onExit(false)` — discard edits since last commit (preserves existing `TextCard.tsx:29` behavior) |
| `⌘⇧S` | `onSaveShortcut()` — triggers quick save |

A wrapping `onKeyDown` on the editor's container calls `e.stopPropagation()` so canvas shortcuts don't fire during editing (matches existing pattern at `TextCard.tsx:33`).

### Save-to-Vault Flow

**Entry points — all reach `useSaveTextCard`:**

1. Right-click on TextCard → `CardContextMenu` shows two items: **"Save as new note"** (quick) and **"Save to…"** (dialog).
2. Header button on `CardShell` for TextCards. Click = quick. Shift-click = dialog.
3. Keyboard `⌘⇧S` inside editor = quick.

**Quick path (`saveQuick(node)`):**

1. Read `canvasTextSaveFolder` from settings (default `Inbox`).
2. Resolve absolute path `join(vaultPath, folder)`. If folder missing → `fs:mkdir`.
3. Compute slug: `slugifyFilename(firstLine(node.content), now)`.
4. `fs:list-files { dir, pattern: '*.md' }` → pass names to `resolveNewPath` for collision handling.
5. `fs:write-file { path, content: node.content }`.
6. `canvas-store.updateNode(node.id, { savedToPath })` — persists with canvas state.
7. Show toast "Saved → Inbox/my-note.md" + render badge on card.

**Dialog path (`SaveTextCardDialog`):**

- Two radio modes at top: **New file** and **Append to existing**.
- **New file mode:**
  - Folder tree derived from `fs:list-all-files` filtered to directories under vault.
  - Filename input pre-filled with `slugifyFilename(...)`.
  - Validation: non-empty, no `/`, `.md` appended if missing, collision warning.
- **Append mode:**
  - Search input over vault `.md` files (client-side filter of `fs:list-all-files`).
  - Selecting a file previews the last ~3 lines.
- **Save button:**
  - New → same as quick steps 3–7 with user-picked folder/filename.
  - Append → `fs:read-file` target, call `appendToExisting(existing, node.content)`, `fs:write-file`. Badge shows "Appended → path.md".

**Post-save badge:** small pill below the card body, text = relative path. Clicking opens the file in the editor via existing `editor-store` navigation. Persisted via `node.savedToPath`. Badge hides if card content changes after save (treat as "dirty again") — tracked by a `savedContentHash` field on the node.

### Pure Functions (`text-card-save.ts`)

```ts
export function slugifyFilename(firstLine: string, now: Date): string
// - Strip leading markdown prefixes (#, -, >, 1., [ ], etc.)
// - Lowercase, replace non-alphanumeric runs with '-', trim '-' ends.
// - Cap at 60 chars.
// - If result empty → `canvas-note-${YYYY-MM-DD-HHmm}`.

export function resolveNewPath(dir: string, slug: string, existing: string[]): string
// - Base name = `${slug}.md`.
// - If not in `existing` → return base.
// - Else append ` (2)`, ` (3)`, ... until free. Respects gaps.

export function appendToExisting(existing: string, addition: string): string
// - Ensures exactly one blank line between existing content and addition.
// - If `existing` is empty → return `addition`.
// - Collapses trailing newlines in `existing` to exactly one, then appends `\n${addition}`.
```

All three are pure — no React, no IPC — and live in the unit test suite.

### Error Handling

- IPC failure → toast `"Save failed: ${error.message}"`. No badge state change.
- Vault not set → hook short-circuits with a toast "Open a vault first".
- Target folder outside vault → guard in hook before IPC (normalize path, ensure it starts with vault path).
- Append mode: target file deleted between picker open and save → fall through to confirmation prompt "File no longer exists — save as new?"; on yes, run quick-new with the picked filename.
- Collision limit guard: if `resolveNewPath` would loop past 999, throw — surfaces as toast.

### Settings

`settings-store.ts` adds:

```ts
canvasTextSaveFolder: string   // default 'Inbox'
```

No UI for this in v1 — user edits via existing settings JSON. If a settings surface is added later, a single folder-picker input is enough.

## Data Flow

```
User edits TextCard
  → RichTextCardEditor.onChange(markdown)
  → canvas-store.updateNodeContent(nodeId, markdown)
  → savedContentHash mismatch → badge hidden

User presses ⌘⇧S (or context menu "Save as new note")
  → useSaveTextCard.saveQuick(node)
  → slugifyFilename → resolveNewPath → fs:write-file
  → canvas-store.updateNode({ savedToPath, savedContentHash })
  → badge renders

User right-clicks → "Save to…"
  → SaveTextCardDialog opens (mode = New)
  → user picks folder + filename OR switches to Append and picks file
  → Save → appendToExisting OR new-write via fs:*
  → canvas-store.updateNode(...)
  → dialog closes, badge renders
```

## Testing

**Unit (Vitest + happy-dom):**

- `text-card-save.test.ts`
  - `slugifyFilename`: empty → timestamp fallback; `# Title` → `title`; 200-char line → 60-char result; unicode/emoji handled (stripped or transliterated to `-`).
  - `resolveNewPath`: no collision → base; one collision → ` (2)`; `(2)` exists and `(3)` doesn't → `(3)`.
  - `appendToExisting`: existing has no trailing newline → `${existing}\n\n${addition}`; one trailing → `${existing}\n${addition}`; many trailing → collapse to one blank line; empty `existing` → `addition`.
- `RichTextCardEditor.test.tsx`: typing fires `onChange` with markdown; `⌘↩` → `onExit(true)`; `Esc` → `onExit(false)`; `⌘⇧S` → `onSaveShortcut`; outer keydown listener does not fire (stopPropagation verified).
- `useSaveTextCard.test.ts`: mocks `window.api.fs.*`; verifies call order `mkdir → list-files → write-file`; collision → ` (2)`; append path reads + writes with correct separator; IPC failure leaves store unchanged.

**Component:**

- `TextCard.test.tsx`: double-click enters edit mode; blur commits; `savedToPath` renders badge; right-click opens `CardContextMenu` with save items; badge hides when content edited after save.
- `SaveTextCardDialog.test.tsx`: mode toggle New/Append; filename auto-fills with slug; collision warning renders; append requires a selected file; Save disabled until valid.

**No E2E** (per `CLAUDE.md`: unit tests + manual screenshots for Electron).

**Manual verification checklist:**

1. Create text card, type markdown, verify `**bold**`, `*italic*`, `#`/`##`/`###` all render at visibly different sizes, lists, tasks, highlights.
2. `⌘↩` commits and exits; `Esc` discards since last commit.
3. `⌘⇧S` saves to `Inbox/`; badge renders; clicking badge opens file in editor.
4. Right-click → "Save to…" → New mode → pick custom folder → verify file written at that path.
5. Append mode → pick existing file → save → verify content appended with a blank-line separator.
6. Reopen canvas → `savedToPath` persists, badge still visible.
7. Edit card content after save → badge disappears; re-save → badge reappears with new path (or same path if quick-saved again — collision handling would produce ` (2)`).
8. Five cards, quick save each with same first line → filenames end ` (2)`, ` (3)`, etc.

**Quality gate:** `npm run check` passes clean (lint + typecheck + test).

## Migration

None required. Existing TextCards' `content` is already a markdown string; Tiptap's `Markdown` extension parses plain paragraphs correctly. `savedToPath` and `savedContentHash` are optional — absent on legacy nodes.

## Open Questions

None at spec time. Future work (out of scope v1):

- Section-targeted append (`## Section` anchor).
- Minimal frontmatter (`source: canvas`, `created: <ISO>`).
- Auto-convert saved TextCard to a live `note` card bound to the file.
- Settings UI for `canvasTextSaveFolder`.
