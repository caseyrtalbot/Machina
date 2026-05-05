import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { borderRadius, colors, floatingPanel, transitions, typography } from '../../design/tokens'

interface EditorBubbleMenuProps {
  readonly editor: Editor
}

interface FormatButtonProps {
  readonly active: boolean
  readonly onClick: () => void
  readonly title: string
  readonly children: React.ReactNode
}

function FormatButton({ active, onClick, title, children }: FormatButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Console: hairline-square buttons. Active state uses accent-muted bg
        // and accent-default fg; the radius hint (2px) keeps focus rings clean.
        borderRadius: borderRadius.inline,
        border: 'none',
        cursor: 'pointer',
        fontFamily: typography.fontFamily.mono,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        backgroundColor: active ? 'var(--color-accent-muted)' : 'transparent',
        color: active ? 'var(--color-accent-default)' : colors.text.secondary,
        transition: `background-color ${transitions.focusRing}, color ${transitions.focusRing}`
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor =
            'color-mix(in srgb, var(--color-text-primary) 6%, transparent)'
          e.currentTarget.style.color = colors.text.primary
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = colors.text.secondary
        }
      }}
    >
      {children}
    </button>
  )
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed, state }) => {
        // Don't show in code blocks
        if (ed.isActive('codeBlock')) return false
        // Only show when there's a text selection
        const { from, to } = state.selection
        return from !== to
      }}
    >
      <div
        className="flex items-center gap-0.5 p-1"
        style={{
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          // Console-direction: hairline border on a near-square chrome surface.
          // Tool radius (4px) keeps shadow corners clean; full square felt knife-edged.
          border: `0.5px solid ${colors.border.default}`,
          borderRadius: borderRadius.tool,
          boxShadow: floatingPanel.shadowCompact
        }}
      >
        <FormatButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Cmd+B)"
        >
          <strong>B</strong>
        </FormatButton>

        <FormatButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Cmd+I)"
        >
          <em>I</em>
        </FormatButton>

        <FormatButton
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough (Cmd+Shift+S)"
        >
          <s>S</s>
        </FormatButton>

        <FormatButton
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Inline code (Cmd+E)"
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>&lt;/&gt;</span>
        </FormatButton>

        <FormatButton
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleMark('highlight').run()}
          title="Highlight (Cmd+Shift+H)"
        >
          <span
            style={{
              backgroundColor: 'color-mix(in srgb, #dfa11a 30%, transparent)',
              padding: '0 3px',
              borderRadius: borderRadius.inline,
              fontSize: 12,
              lineHeight: 1
            }}
          >
            H
          </span>
        </FormatButton>

        {/* Hairline divider — matches the chrome border weight */}
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: 16,
            backgroundColor: colors.border.subtle,
            margin: '0 2px'
          }}
        />

        <FormatButton
          active={editor.isActive('link')}
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run()
            } else {
              const url = window.prompt('URL')
              if (url) {
                editor.chain().focus().setLink({ href: url }).run()
              }
            }
          }}
          title="Link (Cmd+K)"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </FormatButton>

        <FormatButton
          active={editor.isActive('conceptNode')}
          onClick={() => editor.chain().focus().toggleConceptNode().run()}
          title="Concept node"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </FormatButton>
      </div>
    </BubbleMenu>
  )
}
