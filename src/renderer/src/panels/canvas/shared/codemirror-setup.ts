import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
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
    oneDark,
    EditorView.theme({
      '&': { height: '100%', fontSize },
      '.cm-scroller': {
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        overflow: 'auto'
      },
      '.cm-content': { padding: contentPadding }
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
