import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThreadMessage as TM } from '@shared/thread-types'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors, typography } from '../../design/tokens'
import { rehypeEmojiIcons } from '../../markdown/rehype-emoji-icons'
import { LucideInline } from '../../markdown/LucideInline'

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
    </article>
  )
}
