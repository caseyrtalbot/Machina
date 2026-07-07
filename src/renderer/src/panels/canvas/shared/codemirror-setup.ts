import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { machinaCodeTheme } from './code-theme'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { loadLanguageExtension, type SupportedLanguage } from './codemirror-languages'
import { inferLanguage } from '../file-drop-utils'

interface CodeMirrorOptions {
  readonly readOnly?: boolean
  readonly onUpdate?: (content: string) => void
  readonly fontSize?: string
  readonly contentPadding?: string
}

/** Detect language from file path and return the SupportedLanguage key */
export function detectLanguage(filePath: string): SupportedLanguage {
  return inferLanguage(filePath) as SupportedLanguage
}

/** True when a window-level canvas hotkey should be ignored: the event
 *  carries modifier keys (Cmd+R must reach Electron untouched) or
 *  originated inside an editing surface (CodeMirror, input, textarea,
 *  contentEditable). */
export function shouldIgnoreCanvasHotkey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return true
  const target = e.target
  if (!(target instanceof Element)) return false
  if (target.closest('.cm-editor')) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return target instanceof HTMLElement && target.isContentEditable
}

/** Build the common extension set for a CodeMirror editor.
 *  Async because language extensions are lazy-loaded. */
export async function createEditorExtensions(
  language: SupportedLanguage,
  options: CodeMirrorOptions = {}
): Promise<Extension[]> {
  const { readOnly = false, onUpdate, fontSize = '13px', contentPadding = '8px 0' } = options

  const extensions: Extension[] = [
    lineNumbers(),
    EditorView.lineWrapping,
    machinaCodeTheme,
    EditorView.theme({
      '&': { height: '100%', fontSize },
      '.cm-scroller': {
        fontFamily: 'var(--font-code)',
        overflow: 'auto'
      },
      '.cm-content': { padding: contentPadding }
    }),
    // Prevent canvas/window shortcuts while typing (same as CodeCard)
    EditorView.domEventHandlers({
      keydown: (e) => {
        e.stopPropagation()
      }
    })
  ]

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true))
  } else {
    extensions.push(
      highlightActiveLine(),
      highlightSelectionMatches(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])
    )
  }

  if (onUpdate) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onUpdate(update.state.doc.toString())
        }
      })
    )
  }

  const langExt = await loadLanguageExtension(language)
  if (langExt) extensions.push(langExt)

  return extensions
}
