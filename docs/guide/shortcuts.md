# Keyboard Shortcuts

The complete keyboard reference. Cmd means the macOS Command key; global and panel shortcuts also accept Ctrl in its place. Canvas shortcuts require Cmd.

Ground truth lives in `src/renderer/src/panels/agent-shell/keybindings.ts` and `src/renderer/src/panels/canvas/use-canvas-keyboard-shortcuts.ts`; this page mirrors them.

## Global

| Shortcut | Action |
|---|---|
| Cmd+K | Open command palette (search, surfaces, actions) |
| Cmd+N | New untitled note (requires an open vault) |
| Cmd+Shift+N | New native agent thread (requires an open vault) |
| Cmd+1 .. Cmd+9 | Select thread 1 through 9 |
| Cmd+W | Close active dock tab |
| Cmd+. | Cancel the active agent run (works even inside text inputs) |
| Ctrl+` | Toggle the terminal strip (Ctrl only — Cmd+` is macOS window cycling) |
| Escape | Close the command palette |

Most Cmd shortcuts are suppressed while typing in a text input, so Cmd+W in the message composer never closes a tab. Cmd+. is the deliberate exception.

## Panels and layout

| Shortcut | Action |
|---|---|
| Cmd+/ or Cmd+Shift+D | Toggle content dock |
| Cmd+Shift+B | Toggle threads sidebar |
| Cmd+Shift+C | Toggle chat panel |
| Cmd+Shift+V | Toggle vault files panel |
| Cmd+Shift+F | Focus mode (content dock only; restores the previous layout on exit) |

## Canvas

Active while a canvas is visible. Spatial shortcuts (select, duplicate, copy, paste, nudge) pause while you are typing in a card, while a menu is open, or while a card is locked for interaction.

### Editing

| Shortcut | Action |
|---|---|
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+A | Select all cards |
| Cmd+D | Duplicate selection |
| Cmd+C | Copy selected cards (only claims the key when cards are selected; text copy is untouched otherwise) |
| Cmd+V | Paste copied cards |
| Arrow keys | Nudge selection 1 px |
| Shift+Arrow | Nudge selection 24 px (snap grid) |
| Delete or Backspace | Remove selected cards or selected edge |

### Navigation and creation

| Shortcut | Action |
|---|---|
| j / k | Focus next / previous card |
| n | New note at the cursor position |
| Cmd+G | Open the import dialog |
| Cmd+Shift+E | Toggle split editor for the focused card |
| Cmd+L | Apply tile layout (2x2 grid) |
| Cmd+Shift+L | Apply semantic layout |
| Cmd+1 .. Cmd+5 | Jump to saved focus frame |
| Cmd+Shift+1 .. Cmd+Shift+5 | Save focus frame |
| Escape | Unlock the locked card, or clear card focus |

Note: while a canvas is visible, Cmd+1 through Cmd+5 fires both the focus-frame jump and the global thread switch on the same keypress.

## Editor

| Shortcut | Action |
|---|---|
| Cmd+F | Find in note (rich mode) |
| Enter / Shift+Enter | Next / previous match in the find bar |
| Escape | Close the find bar |
| Cmd+Alt+Left / Cmd+Alt+Right | Navigation history back / forward |
| Cmd+Shift+O | Toggle outline panel |
| Cmd+Click on a `[[wikilink]]` | Follow the link |
| `[[` | Wikilink autocomplete (also in canvas note cards) |
| `/` | Slash menu: insert callouts, code blocks, tables, and more (mermaid diagrams render from a code block with language `mermaid`) |

History and the outline toggle work from inside the editor, so backing out of a wikilink rabbit hole never requires clicking out of the document first.

## Terminal

Terminal cards follow the canvas focus model: click to focus the card, click again to interact. While interacting, keystrokes go to the shell, so your usual shell and TUI keybindings apply unchanged.

| Shortcut | Action |
|---|---|
| Cmd+. | Cancel the active agent run (when the card is focused but not in interact mode) |

To return control to the canvas, click outside the card. While interacting, the terminal owns the keyboard, so Escape (like every other key) goes to the shell rather than unlocking the card.

Pinning the latest command block to the canvas is a mouse action: the pin button on the terminal card header.
