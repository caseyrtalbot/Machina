# Handoff: Write UI Redesign Implementation Plan

**Date**: 2026-03-12
**From**: Brainstorming session (spec complete, user-approved)
**To**: Fresh context window
**Action**: Invoke `superpowers:writing-plans` skill to create the implementation plan

## What To Do

1. Read the approved design spec: `docs/superpowers/specs/2026-03-12-ui-redesign-design.md` (V4, 1016 lines)
2. Invoke the `superpowers:writing-plans` skill
3. The spec is the sole input. Do not re-brainstorm or redesign.

## Spec Summary

A 4-phase UI redesign for Thought Engine (Electron desktop knowledge engine):

| Phase | Name | Key Work |
|-------|------|----------|
| 1 | Foundation | IPC security lockdown, pre-existing bug fixes (7), VaultIndex Web Worker migration, custom titlebar, layout skeleton, session persistence, error boundaries, command palette, vault loading orchestration |
| 2 | Function | Filesystem tree, graph controls panel, terminal tabs + zoom, settings modal, autosave |
| 3 | Interaction | Neon highlights, real-time graph updates, Graph/Skills toggle, node sizing, graph performance/virtualization, minimap |
| 4 | Polish | Theme coherence, typography, editor toolbar + breadcrumb + backlinks + frontmatter, status bar, transitions/animations, keyboard navigation |

## Critical Context For The Plan Writer

### Pre-existing bugs that Phase 1 must fix
1. RichEditor calls `getText()` not markdown serializer (destroys formatting on save)
2. SourceEditor stale closure (empty deps captures onChange)
3. SplitPane mouse handlers leak on unmount
4. Terminal tab close doesn't kill PTY
5. VaultIndex blocks UI thread (move to Web Worker)
6. Mutable VaultIndex class in Zustand state (replace with plain data)
7. getGraph()/getArtifact() are methods not selectors (full-store re-renders)

### Architecture changes in Phase 1
- IPC: replace blanket `electronAPI` exposure with typed channel allowlist in preload
- Channel names must match `src/shared/ipc-channels.ts` (`fs:*`, `terminal:*`, `vault:*`)
- VaultIndex → Web Worker: store holds `artifacts: Artifact[]` and `graph: KnowledgeGraph` as plain state
- Vault loading: explicit orchestration sequence (not scattered useEffects)

### Sequencing constraints
- Phase 1A (IPC security) must be first. All IPC call sites change.
- Command palette is Phase 1 (not Phase 2). Users need it from day one.
- Graph intermediate verification step after stores are wired (before live vault data).
- Autosave lands in Phase 2 after editor toolbar.

### Implementation notes
- Stack: Electron, electron-vite, React 18, TypeScript, Zustand, Tiptap v2, CodeMirror 6, D3.js + Canvas2D, xterm.js + node-pty, Tailwind v4, Vitest
- 35 existing tests must pass throughout
- npm workaround: `--cache /tmp/npm-cache-te`
- File inventory: 25 new files, 24 modified files
- No localStorage anywhere. electron-store for app settings, vault JSON files for vault settings.
- Canvas2D graph (NOT SVG). D3 for force simulation only.

### What the plan does NOT need to cover
- The V1 build plan (`/Users/caseytalbot/docs/superpowers/plans/2026-03-12-thought-engine-plan.md`) is the original 26-task plan that built the app. It is historical. The new plan replaces it for the UI redesign scope.
- Multi-vault implementation (V1 is single-vault, but architecture must not preclude it)
- Wiki-link parsing (deliberate omission, edges are frontmatter-only)

## Project Location

- **Repo**: `/Users/caseytalbot/Projects/thought-engine/`
- **Spec**: `docs/superpowers/specs/2026-03-12-ui-redesign-design.md`
- **Git**: 7 spec commits on main (192643b through f9ff03f)
- **Branch**: `main`

## Key Source Files (for plan grounding)

| File | Why it matters |
|------|---------------|
| `src/preload/index.ts` | Current security gap (raw electronAPI exposure) |
| `src/shared/ipc-channels.ts` | Source of truth for channel names |
| `src/shared/types.ts` | VaultConfig, VaultState (needs extension) |
| `src/renderer/src/store/vault-store.ts` | Mutable VaultIndex, method-style getters |
| `src/renderer/src/engine/parser.ts` | Frontmatter-only relationship parsing |
| `src/renderer/src/engine/graph-builder.ts` | Edge construction from frontmatter fields |
| `src/renderer/src/engine/indexer.ts` | VaultIndex class (moves to Worker) |
| `src/renderer/src/panels/graph/GraphRenderer.ts` | Canvas2D renderer (not SVG) |
| `src/renderer/src/panels/graph/GraphPanel.tsx` | D3 zoom, force simulation |
| `src/renderer/src/panels/editor/RichEditor.tsx` | getText() bug |
| `src/renderer/src/panels/editor/SourceEditor.tsx` | Stale closure bug |
| `src/renderer/src/design/components/SplitPane.tsx` | Handler leak bug |
| `src/renderer/src/panels/terminal/TerminalPanel.tsx` | PTY lifecycle bug |
| `src/renderer/src/App.tsx` | Main orchestrator (232 lines) |
| `src/main/services/vault-watcher.ts` | Chokidar (needs hardening) |
| `src/main/ipc/filesystem.ts` | Registered fs/vault handlers |
| `src/main/ipc/shell.ts` | Registered terminal handlers |
