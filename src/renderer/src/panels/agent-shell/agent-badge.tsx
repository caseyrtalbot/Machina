import type { CSSProperties } from 'react'
import type { AgentIdentity } from '@shared/agent-identity'
import { agentPillStyle } from './agent-color'
import { agentTag } from './agent-tag'
import { typography } from '../../design/tokens'

export function AgentBadge({
  agent,
  compact = false
}: {
  readonly agent: AgentIdentity
  readonly compact?: boolean
}) {
  const pill = agentPillStyle(agent)
  const iconSize = compact ? 12 : 13

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 5 : 6,
        padding: 0,
        background: pill.background,
        border: pill.border,
        color: pill.color,
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.metadata.size,
        letterSpacing: typography.metadata.letterSpacing,
        textTransform: typography.metadata.textTransform,
        whiteSpace: 'nowrap',
        lineHeight: 1
      }}
    >
      <AgentIcon agent={agent} size={iconSize} />
      <span>{agentTag(agent)}</span>
    </span>
  )
}

export function AgentIcon({
  agent,
  size
}: {
  readonly agent: AgentIdentity
  readonly size: number
}) {
  const common: CSSProperties = {
    flexShrink: 0,
    display: 'block'
  }

  switch (agent) {
    case 'machina-native':
      return (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={common}
        >
          <rect x="5.5" y="5.5" width="13" height="13" rx="3.5" />
          <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'cli-claude':
      return (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          style={common}
        >
          <path d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
        </svg>
      )
    case 'cli-codex':
      return (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          style={common}
        >
          <path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
        </svg>
      )
    case 'cli-gemini':
      return (
        <svg
          aria-hidden
          viewBox="0 0 512 512"
          width={size}
          height={size}
          fill="currentColor"
          style={common}
        >
          <path d="M512 256.5c-137.5 8.4-247.1 118-255.5 255.5h-1C247.1 374.5 137.5 264.9 0 256.5v-1c137.5-8.4 247.1-118 255.5-255.5h1c8.4 137.5 118 247.1 255.5 255.5z" />
        </svg>
      )
  }
}
