import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThreadMessage as TM } from '@shared/thread-types'
import { resolveWikilinkTarget } from '@shared/engine/wikilink-resolver'
import { useVaultStore } from '../../store/vault-store'
import { useDockStore } from '../../store/dock-store'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
import { rehypeEmojiIcons } from '../../markdown/rehype-emoji-icons'
import { remarkWikilinks } from '../../markdown/remark-wikilinks'
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

/** Open a chat [[wikilink]] in an editor dock tab if it resolves to a note. */
function openWikilink(target: string): void {
  const { artifacts, artifactPathById } = useVaultStore.getState()
  const id = resolveWikilinkTarget(target, artifacts, artifactPathById)
  const path = id ? artifactPathById[id] : undefined
  if (path) {
    useDockStore.getState().openOrFocusDockTab({ kind: 'editor', path })
  }
}

const markdownComponents: Components = {
  a(props) {
    const {
      node: _node,
      children,
      href,
      ...rest
    } = props as unknown as {
      node?: unknown
      children?: unknown
      href?: string
      [key: string]: unknown
    }
    const target = (rest as Record<string, unknown>)['data-wikilink-target']
    if (typeof target === 'string') {
      return (
        <a
          href="#wikilink"
          data-wikilink-target={target}
          title={target}
          style={{
            color: colors.accent.default,
            textDecoration: 'none',
            cursor: 'pointer',
            borderBottom: `1px solid ${colors.accent.line}`
          }}
          onClick={(e) => {
            e.preventDefault()
            openWikilink(target)
          }}
        >
          {children as never}
        </a>
      )
    }
    return (
      <a href={href} {...(rest as object)}>
        {children as never}
      </a>
    )
  },
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
  // Plain-text CLI agents (and degraded structured runs) produce finals with
  // an empty body — suppress the empty prose block instead of rendering a
  // heading over nothing, and say where the reply went when tool cards exist.
  const hasBody = body.trim().length > 0
  const toolOnly = message.role === 'assistant' && !hasBody && (message.toolCalls?.length ?? 0) > 0

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
      {hasBody && (
        <div className="thread-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkWikilinks]}
            rehypePlugins={[rehypeEmojiIcons]}
            components={markdownComponents}
          >
            {body}
          </ReactMarkdown>
        </div>
      )}
      {toolOnly && (
        <div
          style={{
            fontSize: typography.metadata.size,
            color: colors.text.muted,
            fontStyle: 'italic'
          }}
        >
          No text reply (see command output)
        </div>
      )}
      {message.role === 'assistant' &&
        message.toolCalls?.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} historical />
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
