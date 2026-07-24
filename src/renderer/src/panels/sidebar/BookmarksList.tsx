import { useState } from 'react'
import { Star } from 'lucide-react'
import { useUiStore } from '../../store/ui-store'
import { useVaultStore } from '../../store/vault-store'
import { colors, iconSize, iconStroke } from '../../design/tokens'

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
    <div className="te-bookmarks">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="tag-browser__toggle interactive-hover"
      >
        <div className="te-bookmarks-toggle-left">
          <span className="te-bookmarks-caret">{expanded ? '▾' : '▸'}</span>
          {/* Console section header: mono 10px / 0.14em uppercase, muted */}
          <span className="te-bookmarks-label">Bookmarks</span>
          <span className="te-bookmarks-count">{bookmarkedPaths.length}</span>
        </div>
      </button>

      {expanded && (
        <div className="te-bookmarks-list">
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
                className="te-bookmarks-row"
                data-active={isActive || undefined}
                title={`${item.path}\nRight-click to remove`}
              >
                <Star
                  className="te-bookmarks-star"
                  size={iconSize.sm}
                  strokeWidth={iconStroke}
                  color={isActive ? colors.accent.default : colors.text.muted}
                />
                <span className="te-bookmarks-name">{item.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
