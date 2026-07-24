import { createRef } from 'react'
import type { Editor } from '@tiptap/core'
import { PluginKey, type Plugin } from '@tiptap/pm/state'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import { createRoot } from 'react-dom/client'
import type { Artifact } from '@shared/types'
import {
  SlashCommandList,
  type SlashCommandItem,
  type SlashCommandListHandle
} from './slash-command-list'
import { filterWikilinkSuggestions } from './wikilink-suggestion-filter'
import { useVaultStore } from '../../../store/vault-store'

function toItems(artifacts: readonly Artifact[]): SlashCommandItem[] {
  return artifacts.map((a) => ({
    title: a.title,
    description: a.id,
    icon: '[[',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertWikilink(a.title).run()
    }
  }))
}

/**
 * @tiptap/suggestion plugin triggered by `[[`. Queries vault-store artifacts
 * with the ConnectionAutocomplete scoring and inserts a wikilink node via the
 * insertWikilink command. Popup rendering mirrors slash-command.tsx.
 */
export function createWikilinkSuggestion(editor: Editor): Plugin {
  return Suggestion({
    editor,
    char: '[[',
    pluginKey: new PluginKey('wikilinkSuggestion'),
    allowSpaces: true,
    // Trigger mid-word too ("see[[note"), matching Obsidian behavior.
    allowedPrefixes: null,
    items: ({ query }) =>
      toItems(filterWikilinkSuggestions(useVaultStore.getState().artifacts, query)),
    render: () => {
      let container: HTMLDivElement | null = null
      let root: ReturnType<typeof createRoot> | null = null
      let dismissed = false
      const listRef = createRef<SlashCommandListHandle>()

      const position = (props: SuggestionProps) => {
        const rect = props.clientRect?.()
        if (rect && container) {
          container.style.left = `${rect.left}px`
          container.style.top = `${rect.bottom + 4}px`
        }
      }

      const renderPanel = (props: SuggestionProps) => (
        <div className="te-slashmenu-panel">
          <SlashCommandList
            ref={listRef}
            items={props.items as SlashCommandItem[]}
            command={(item) => {
              item.command({
                editor: props.editor,
                range: props.range
              })
            }}
          />
        </div>
      )

      const teardown = () => {
        root?.unmount()
        container?.remove()
        root = null
        container = null
      }

      return {
        onStart: (props) => {
          dismissed = false
          container = document.createElement('div')
          container.style.position = 'fixed'
          container.style.zIndex = '999'
          container.style.animation = 'te-scale-in 150ms ease-out'
          document.body.appendChild(container)

          root = createRoot(container)
          position(props)
          root.render(renderPanel(props))
        },

        onUpdate: (props) => {
          if (dismissed || !root) return
          position(props)
          root.render(renderPanel(props))
        },

        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            // Genuinely exit: tear the popup down and stop intercepting
            // keys so Enter/arrows go back to the editor.
            dismissed = true
            teardown()
            return true
          }
          if (dismissed) return false
          return listRef.current?.onKeyDown(props.event) ?? false
        },

        onExit: teardown
      }
    }
  })
}
