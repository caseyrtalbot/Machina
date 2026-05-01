import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThreadMessage as TM } from '@shared/thread-types'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors } from '../../design/tokens'

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
      style={{ padding: 16, borderBottom: `1px solid ${colors.border.subtle}` }}
    >
      <h3
        style={{
          fontSize: 11,
          color: colors.text.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          margin: 0,
          marginBottom: 4
        }}
      >
        {heading}
      </h3>
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
      {message.role === 'assistant' &&
        message.toolCalls?.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} />
        ))}
    </article>
  )
}
