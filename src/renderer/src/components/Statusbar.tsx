import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useVaultStore } from '../store/vault-store'
import { useEditorStore } from '../store/editor-store'
import { useThreadStore } from '../store/thread-store'
import { useIndexingProgress } from '../utils/chunk-loader'
import { formatModelLabel } from '@shared/format-model-label'

interface StatusbarItem {
  readonly key: string
  readonly text: string
  readonly tone?: 'success' | 'warn' | 'danger' | 'accent' | 'muted'
  readonly dot?: boolean
  readonly title?: string
}

function ItemRow({ item }: { readonly item: StatusbarItem }): ReactNode {
  const tone = item.tone
  const showDot = item.dot ?? Boolean(tone)
  return (
    <div className="te-statusbar__item" data-tone={tone} title={item.title}>
      {showDot ? <span className="te-statusbar__dot" /> : null}
      <span>{item.text}</span>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`.replace('.0k', 'k')
  return `${Math.round(n / 1000)}k`
}

/**
 * Application status bar.
 *
 * Pinned to the bottom of the workspace shell, mono 10.5px / 0.06em tracking.
 * Left side reads vault state (indexed file count, graph size, dirty state);
 * right side reads agent state (active model, run state). Items are
 * derived from the existing stores so the bar reflects actual app state and
 * does not need explicit wiring from each surface.
 */
export function Statusbar() {
  const fileCount = useVaultStore((s) => s.files.filter((f) => f.path.endsWith('.md')).length)
  const nodeCount = useVaultStore((s) => s.artifacts.length)
  const edgeCount = useVaultStore((s) => s.graph.edges.length)
  const dirty = useEditorStore((s) => s.isDirty)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? (s.threadsById[s.activeThreadId] ?? null) : null
  )
  const inFlight = useThreadStore((s) =>
    s.activeThreadId ? Boolean(s.inFlightByThreadId[s.activeThreadId]) : false
  )
  const indexingTotal = useIndexingProgress((s) => s.total)
  const indexingDone = useIndexingProgress((s) => s.indexed)

  const leftItems: StatusbarItem[] = useMemo(() => {
    const items: StatusbarItem[] = []
    if (indexingTotal > 0) {
      items.push({
        key: 'indexing',
        tone: 'accent',
        dot: true,
        text: `Indexing ${formatNumber(indexingDone)}/${formatNumber(indexingTotal)} notes`,
        title: `${indexingDone} of ${indexingTotal} notes indexed`
      })
    } else if (fileCount > 0) {
      items.push({
        key: 'indexed',
        tone: 'success',
        dot: true,
        text: `Indexed · ${formatNumber(fileCount)} files`,
        title: `${fileCount} markdown files indexed`
      })
    } else {
      items.push({
        key: 'indexing',
        tone: 'warn',
        dot: true,
        text: 'No vault loaded'
      })
    }
    if (nodeCount > 0) {
      items.push({
        key: 'graph',
        text: `${formatNumber(nodeCount)} nodes · ${formatNumber(edgeCount)} edges`
      })
    }
    if (activeNotePath && dirty) {
      items.push({ key: 'dirty', tone: 'warn', dot: true, text: 'unsaved' })
    } else if (activeNotePath) {
      items.push({ key: 'saved', text: 'saved' })
    }
    return items
  }, [indexingTotal, indexingDone, fileCount, nodeCount, edgeCount, dirty, activeNotePath])

  const rightItems: StatusbarItem[] = useMemo(() => {
    const items: StatusbarItem[] = []
    if (activeThread) {
      const label = formatModelLabel(activeThread.model ?? 'Agent')
      items.push({
        key: 'agent',
        tone: inFlight ? 'accent' : undefined,
        dot: true,
        text: inFlight ? `${label} · running` : label
      })
    }
    return items
  }, [activeThread, inFlight])

  return (
    <div className="te-statusbar" role="status" aria-label="Workspace status">
      {leftItems.map((item) => (
        <ItemRow key={item.key} item={item} />
      ))}
      <div className="te-statusbar__spacer" />
      {rightItems.map((item) => (
        <ItemRow key={item.key} item={item} />
      ))}
    </div>
  )
}
