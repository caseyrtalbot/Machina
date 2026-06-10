import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThreadMessage as TM } from '@shared/thread-types'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
import { rehypeEmojiIcons } from '../../markdown/rehype-emoji-icons'
import { LucideInline } from '../../markdown/LucideInline'

/**
 * Body of the system message appended when a native-agent run fails with
 * an AUTH error (use-thread-streaming.ts). ThreadMessage recognizes this
 * exact body — including after a thread-md round trip — and renders an
 * "Add API key in Settings" action under it.
 */
export const AUTH_ERROR_BODY =
  'The agent could not authenticate with the Anthropic API. Add your API key in Settings to keep using the native agent.'

interface Props {
  readonly message: TM
  readonly streamingBody?: string
}

const markdownComponents: Components = {
  span(props) {
    const {
      node: _node,
      children,
      ...rest
    } = props as unknown as {
      node?: unknown
      children?: unknown
      [key: string]: unknown
    }
    const r = rest as Record<string, unknown>
    const iconName = r['data-lucide-icon'] ?? r['dataLucideIcon']
    if (typeof iconName === 'string') {
      return <LucideInline name={iconName} />
    }
    return <span {...(rest as object)}>{children as never}</span>
  }
}

export function ThreadMessage({ message, streamingBody }: Props) {
  const heading =
    message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Machina' : 'System'
  const body =
    message.role === 'assistant' && streamingBody ? message.body + streamingBody : message.body

  return (
    <article
      data-role={message.role}
      style={{
        padding: '20px 24px',
        borderBottom: `1px solid ${colors.border.subtle}`
      }}
    >
      <div
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted,
          marginBottom: 8
        }}
      >
        {heading}
      </div>
      <div className="thread-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeEmojiIcons]}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      </div>
      {message.role === 'assistant' &&
        message.toolCalls?.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} />
        ))}
      {message.role === 'system' && message.body === AUTH_ERROR_BODY && <OpenSettingsAction />}
    </article>
  )
}

function OpenSettingsAction() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('te:open-settings'))}
      style={{
        marginTop: 10,
        padding: '5px 12px',
        borderRadius: borderRadius.inline,
        border: `1px solid ${colors.accent.default}`,
        background: 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)',
        color: colors.text.primary,
        cursor: 'pointer',
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.metadata.size,
        letterSpacing: typography.metadata.letterSpacing,
        textTransform: typography.metadata.textTransform,
        transition: `background ${transitions.fast}, border-color ${transitions.fast}`
      }}
    >
      Add API key in Settings
    </button>
  )
}
