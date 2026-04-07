import { useState } from 'react'
import { useUiStore } from '../../store/ui-store'
import { useVaultStore } from '../../store/vault-store'
import { colors, transitions } from '../../design/tokens'

interface BookmarksListProps {
  activeFilePath: string | null
  onFileSelect: (path: string) => void
}

export function BookmarksList({ activeFilePath, onFileSelect }: BookmarksListProps) {
  const bookmarkedPaths = useUiStore((s) => s.bookmarkedPaths)
  const toggleBookmark = useUiStore((s) => s.toggleBookmark)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifacts = useVaultStore((s) => s.artifacts)
  const [expanded, setExpanded] = useState(true)

  if (bookmarkedPaths.length === 0) return null

  const items = bookmarkedPaths.map((path) => {
    const id = fileToId[path]
    const artifact = id ? artifacts.find((a) => a.id === id) : undefined
    const filename = path.split('/').pop() ?? path
    const title = artifact?.title ?? filename.replace(/\.md$/i, '')
    return { path, title }
  })

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="tag-browser__toggle interactive-hover"
        style={{ transition: transitions.hover }}
      >
        <div className="flex items-center gap-1.5">
          <span
            style={{ color: colors.text.muted, fontSize: 'var(--env-sidebar-tertiary-font-size)' }}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
          <span
            className="uppercase font-medium tracking-[0.04em]"
            style={{ color: colors.text.muted, fontSize: 'var(--env-sidebar-tertiary-font-size)' }}
          >
            Bookmarks
          </span>
          <span
            style={{ color: colors.text.muted, fontSize: 'var(--env-sidebar-tertiary-font-size)' }}
          >
            {bookmarkedPaths.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="flex flex-col gap-0.5 px-1 pb-1">
          {items.map((item) => {
            const isActive = activeFilePath === item.path
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onFileSelect(item.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  toggleBookmark(item.path)
                }}
                className="file-row-hover flex items-center gap-2 px-2 py-1 text-left rounded"
                style={{
                  backgroundColor: isActive ? colors.accent.muted : 'transparent',
                  transition: transitions.hover
                }}
                title={`${item.path}\nRight-click to remove`}
              >
                <span
                  className="shrink-0"
                  style={{
                    color: isActive ? colors.accent.default : colors.text.muted,
                    fontSize: 'var(--env-sidebar-tertiary-font-size)'
                  }}
                >
                  ★
                </span>
                <span
                  className="truncate flex-1"
                  style={{
                    color: isActive ? colors.text.primary : colors.text.secondary,
                    fontSize: 'var(--env-sidebar-font-size)'
                  }}
                >
                  {item.title}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
