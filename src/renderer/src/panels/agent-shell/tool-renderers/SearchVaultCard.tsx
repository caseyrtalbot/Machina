import type { ToolCall, ToolResult } from '@shared/thread-types'
import { unwrapSpotlighting } from '@shared/spotlighting'
import { openNoteInEditor } from '../../../store/dock-store'
import { useVaultStore } from '../../../store/vault-store'
import { ToolCardShell } from './ToolCardShell'

type SearchVaultCall = Extract<ToolCall, { kind: 'search_vault' }>
type SuccessResult = Extract<ToolResult, { ok: true }>

interface Hit {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

const PREVIEW_LIMIT = 10

// search_vault serializes hits into a Spotlighting-wrapped `results` string
// (snippets are untrusted vault content). Unwrap + parse it back into hits for
// display; malformed or absent payloads degrade to an empty list.
function parseHits(output: unknown): Hit[] {
  if (typeof output !== 'object' || output === null) return []
  const results = (output as { results?: unknown }).results
  if (typeof results !== 'string') return []
  try {
    const parsed = JSON.parse(unwrapSpotlighting(results))
    return Array.isArray(parsed) ? (parsed as Hit[]) : []
  } catch {
    return []
  }
}

export function SearchVaultCard({
  call,
  result
}: {
  readonly call: SearchVaultCall
  readonly result?: SuccessResult
}) {
  if (!result) {
    return (
      <ToolCardShell variant="pill" inline pending className="te-tool-loading">
        <SearchGlyph />
        <span>searching for &ldquo;{call.args.query}&rdquo;…</span>
      </ToolCardShell>
    )
  }

  const output =
    typeof result.output === 'object' && result.output !== null
      ? (result.output as { truncated?: boolean; engine?: string })
      : {}
  const hits = parseHits(result.output)
  const truncated = output.truncated === true

  function open(rel: string) {
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    openNoteInEditor(`${vault}/${rel}`)
  }

  return (
    <ToolCardShell variant="block">
      <div className="te-tool-search-head">
        <SearchGlyph />
        <span>
          {hits.length}
          {truncated ? '+' : ''} {hits.length === 1 ? 'hit' : 'hits'} for &ldquo;
          {call.args.query}&rdquo;
          {truncated ? ' — capped, narrow the query for more' : ''}
        </span>
      </div>
      <ul className="te-tool-plain-list">
        {hits.slice(0, PREVIEW_LIMIT).map((h, i) => (
          <li
            key={`${h.path}:${h.line}:${i}`}
            className="te-tool-hit"
            data-last={i === Math.min(hits.length, PREVIEW_LIMIT) - 1 ? '' : undefined}
          >
            <a
              href="#"
              className="te-tool-link"
              onClick={(e) => {
                e.preventDefault()
                open(h.path)
              }}
            >
              {h.path}:{h.line}
            </a>
            <code className="te-tool-hit-snippet">{h.snippet}</code>
          </li>
        ))}
        {hits.length > PREVIEW_LIMIT && (
          <li className="te-tool-hit-more">… {hits.length - PREVIEW_LIMIT} more</li>
        )}
      </ul>
    </ToolCardShell>
  )
}

function SearchGlyph() {
  return (
    <svg aria-hidden width={11} height={11} viewBox="0 0 11 11" className="te-tool-glyph">
      <circle cx={4.5} cy={4.5} r={3.5} fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M7.5 7.5 L10 10" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
    </svg>
  )
}
