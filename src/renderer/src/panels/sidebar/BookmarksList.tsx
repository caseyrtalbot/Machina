import { useState } from 'react'
import { useUiStore } from '../../store/ui-store'
import { useVaultStore } from '../../store/vault-store'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'

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
            {expanded ? '▾' : '▸'}
          </span>
          {/* Console section header: mono 10px / 0.14em uppercase, muted */}
          <span
            style={{
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              fontWeight: 600
            }}
          >
            Bookmarks
          </span>
          <span
            style={{
              color: colors.text.disabled,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              fontVariantNumeric: 'tabular-nums'
            }}
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
                className="file-row-hover flex items-center gap-2 px-2 py-1 text-left"
                style={{
                  // Active rows pick up a 2px accent left-stripe + brighter
                  // background, matching the tree row treatment.
                  background: isActive ? 'var(--color-bg-elevated)' : 'transparent',
                  borderLeft: `2px solid ${isActive ? colors.accent.default : 'transparent'}`,
                  borderRadius: borderRadius.inline,
                  paddingLeft: 6,
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
                    fontSize: 12
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
