import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThreadMessage as TM } from '@shared/thread-types'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors, typography } from '../../design/tokens'

interface Props {
  readonly message: TM
  readonly streamingBody?: string
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
      {message.role === 'assistant' &&
        message.toolCalls?.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} />
        ))}
    </article>
  )
}
