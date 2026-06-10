import { createRef } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import { createRoot } from 'react-dom/client'
import {
  SlashCommandList,
  type SlashCommandItem,
  type SlashCommandListHandle
} from './slash-command-list'
import { floatingPanel } from '../../../design/tokens'

const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    }
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    }
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    }
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: '\u2022',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    }
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: '1.',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    }
  },
  {
    title: 'Task List',
    description: 'Checkboxes',
    icon: '\u2610',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    }
  },
  {
    title: 'Code Block',
    description: 'Syntax-highlighted code',
    icon: '<>',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    }
  },
  {
    title: 'Blockquote',
    description: 'Quoted text',
    icon: '\u275D',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    }
  },
  {
    title: 'Callout',
    description: 'Highlighted block (note, tip, warning)',
    icon: '\u25A1',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).setCallout('note').run()
    }
  },
  {
    title: 'Divider',
    description: 'Horizontal line',
    icon: '\u2500',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    }
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: '\u25A6',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    }
  }
]

function filterItems(query: string): SlashCommandItem[] {
  if (!query) return SLASH_COMMAND_ITEMS
  const lower = query.toLowerCase()
  return SLASH_COMMAND_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(lower) || item.description.toLowerCase().includes(lower)
  )
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
        items: ({ query }) => filterItems(query),
        allow: ({ state, range }) => {
          // Only trigger at the start of a block (after optional whitespace)
          const $from = state.doc.resolve(range.from)
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
          return textBefore.trim() === ''
        },
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
            <div
              style={{
                width: 280,
                backgroundColor: floatingPanel.glass.bg,
                backdropFilter: floatingPanel.glass.blur,
                borderRadius: floatingPanel.borderRadius,
                boxShadow: floatingPanel.shadow,
                overflow: 'hidden'
              }}
            >
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
    ]
  }
})
