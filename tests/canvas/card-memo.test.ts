/**
 * Verifies that card components are wrapped in React.memo for render performance.
 * CardShell is excluded (children prop defeats memo). CardLodPreview is separate.
 */
import { describe, expect, it, vi } from 'vitest'

// Stub out heavy dependencies that card modules import at module level
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(),
  EditorContent: () => null
}))
vi.mock('@codemirror/state', () => ({
  EditorState: { create: vi.fn() }
}))
vi.mock('@codemirror/view', () => ({
  EditorView: vi.fn(),
  keymap: vi.fn(),
  lineNumbers: vi.fn(),
  highlightActiveLine: vi.fn()
}))
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: [] }))
vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: vi.fn(),
  historyKeymap: []
}))
vi.mock('@codemirror/search', () => ({
  searchKeymap: [],
  highlightSelectionMatches: vi.fn()
}))
vi.mock('pdfjs-dist', () => ({}))
vi.mock('@renderer/panels/canvas/pdf-worker-setup', () => ({ pdfjs: { getDocument: vi.fn() } }))
vi.mock('@renderer/panels/canvas/shared/tiptap-config', () => ({
  getCanvasEditorExtensions: vi.fn(() => [])
}))
vi.mock('@renderer/panels/canvas/shared/codemirror-languages', () => ({
  LANGUAGES: [],
  loadLanguageExtension: vi.fn()
}))
vi.mock('@renderer/panels/canvas/shared/codemirror-setup', () => ({
  createEditorExtensions: vi.fn(() => []),
  detectLanguage: vi.fn()
}))
vi.mock('@renderer/panels/canvas/shared/file-view-utils', () => ({
  computeLineDelta: vi.fn(),
  countLines: vi.fn()
}))
vi.mock('@renderer/panels/canvas/CardShell', () => ({
  CardShell: () => null
}))
vi.mock('@renderer/panels/canvas/shared/CardBadge', () => ({
  CardBadge: () => null
}))
vi.mock('@renderer/panels/canvas/shared/MetadataGrid', () => ({
  MetadataGrid: () => null
}))
vi.mock('@renderer/panels/canvas/shared/frontmatter-utils', () => ({
  frontmatterToEntries: vi.fn(() => [])
}))
vi.mock('@renderer/store/canvas-store', () => ({
  useCanvasStore: vi.fn(() => vi.fn())
}))
vi.mock('@renderer/store/vault-store', () => ({
  useVaultStore: vi.fn(() => vi.fn())
}))
vi.mock('@renderer/store/editor-store', () => ({
  useEditorStore: vi.fn(() => vi.fn())
}))
vi.mock('@renderer/store/thread-store', () => ({
  useThreadStore: Object.assign(
    vi.fn(() => vi.fn()),
    { getState: vi.fn(() => ({ addDockTab: vi.fn() })) }
  )
}))
vi.mock('@renderer/hooks/useClaudeContext', () => ({
  useClaudeContext: vi.fn()
}))
vi.mock('@renderer/engine/context-serializer', () => ({
  buildCanvasContext: vi.fn()
}))
vi.mock('@renderer/utils/error-logger', () => ({
  logError: vi.fn()
}))
vi.mock('@renderer/design/tokens', () => ({
  colors: {
    text: { primary: '#fff', secondary: '#ccc', muted: '#888' },
    bg: { surface: '#111' },
    border: { subtle: '#222' }
  },
  typography: { fontFamily: { mono: 'monospace', sans: 'sans-serif' } },
  getArtifactColor: vi.fn(() => '#fff')
}))
vi.mock('@engine/vault-event-hub', () => ({
  vaultEvents: { subscribe: vi.fn(() => vi.fn()), emit: vi.fn() }
}))
vi.mock('@shared/format-elapsed', () => ({
  formatElapsed: vi.fn(() => '0s')
}))
vi.mock('@renderer/system-artifacts/system-artifact-runtime', () => ({
  openArtifactInEditor: vi.fn()
}))
vi.mock('@renderer/panels/workbench/workbench-artifact-placement', () => ({
  restorePatternSnapshot: vi.fn()
}))

describe('card memo wrappers', () => {
  const cardModules = [
    { name: 'NoteCard', path: '@renderer/panels/canvas/NoteCard' },
    { name: 'MarkdownCard', path: '@renderer/panels/canvas/MarkdownCard' },
    { name: 'TextCard', path: '@renderer/panels/canvas/TextCard' },
    { name: 'CodeCard', path: '@renderer/panels/canvas/CodeCard' },
    { name: 'ImageCard', path: '@renderer/panels/canvas/ImageCard' },
    { name: 'PdfCard', path: '@renderer/panels/canvas/PdfCard' },
    { name: 'TerminalCard', path: '@renderer/panels/canvas/TerminalCard' },
    { name: 'FileViewCard', path: '@renderer/panels/canvas/FileViewCard' },
    { name: 'ProjectFolderCard', path: '@renderer/panels/canvas/ProjectFolderCard' },
    { name: 'WorkbenchFileCard', path: '@renderer/panels/workbench/WorkbenchFileCard' },
    { name: 'SystemArtifactCard', path: '@renderer/panels/workbench/SystemArtifactCard' }
  ]

  it.each(cardModules)('$name default export is wrapped in React.memo', async ({ path }) => {
    const mod = await import(path)
    const component = mod.default
    expect(component).toBeDefined()
    // React.memo components have $$typeof === Symbol.for('react.memo')
    expect(component.$$typeof).toBe(Symbol.for('react.memo'))
  })
})
