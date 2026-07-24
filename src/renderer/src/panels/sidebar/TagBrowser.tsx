import { useMemo, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useSidebarFilterStore } from '../../store/sidebar-filter-store'
import { buildTagIndex } from '@engine/tag-index'
import type { TagTreeNode } from '@engine/tag-index'
import { SectionLabel } from '../../design/components/SectionLabel'

function TagNode({
  node,
  depth,
  isSelected,
  isExpanded,
  onToggle,
  onToggleExpand
}: {
  node: TagTreeNode
  depth: number
  isSelected: boolean
  isExpanded: boolean
  onToggle: (path: string) => void
  onToggleExpand: (path: string) => void
}) {
  const hasChildren = node.children.length > 0

  return (
    <>
      <button
        type="button"
        onClick={() => onToggle(node.fullPath)}
        className="te-tagbrowser-row"
        data-selected={isSelected ? 'true' : undefined}
        // Depth-based indent is runtime geometry (tree nesting level).
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {hasChildren && (
          <span
            className="te-tagbrowser-expand"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.fullPath)
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        )}
        {!hasChildren && <span className="te-tagbrowser-spacer" />}
        <span className="te-tagbrowser-name">{node.name}</span>
        <span className="te-tagbrowser-nodecount">{node.count}</span>
      </button>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TagNodeWrapper key={child.fullPath} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  )
}

function TagNodeWrapper({ node, depth }: { node: TagTreeNode; depth: number }) {
  const selectedTags = useSidebarFilterStore((s) => s.selectedTags)
  const expandedPaths = useSidebarFilterStore((s) => s.expandedTagPaths)
  const toggleTag = useSidebarFilterStore((s) => s.toggleTag)
  const toggleExpand = useSidebarFilterStore((s) => s.toggleTagExpanded)

  return (
    <TagNode
      node={node}
      depth={depth}
      isSelected={selectedTags.includes(node.fullPath)}
      isExpanded={expandedPaths.has(node.fullPath)}
      onToggle={toggleTag}
      onToggleExpand={toggleExpand}
    />
  )
}

export function TagBrowser() {
  const artifacts = useVaultStore((s) => s.artifacts)
  const selectedTags = useSidebarFilterStore((s) => s.selectedTags)
  const tagOperator = useSidebarFilterStore((s) => s.tagOperator)
  const clearTags = useSidebarFilterStore((s) => s.clearTags)
  const setTagOperator = useSidebarFilterStore((s) => s.setTagOperator)

  const [expanded, setExpanded] = useState(false)
  const tagTree = useMemo(() => buildTagIndex(artifacts), [artifacts])

  if (tagTree.length === 0) return null

  return (
    <div className="tag-browser te-tagbrowser">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="tag-browser__toggle interactive-hover"
      >
        <div className="te-tagbrowser-toggle-left">
          <span className="te-tagbrowser-caret">{expanded ? '▾' : '▸'}</span>
          {/* Console section header: muted mono 10px / 0.14em uppercase. */}
          <SectionLabel>Tags</SectionLabel>
          <span className="te-tagbrowser-count">{tagTree.length}</span>
        </div>
        {expanded && (
          <span
            // Operator pill (AND/OR) uses the same hairline 2px chip recipe as
            // workspace chips for visual consistency across sidebar chrome.
            className="te-tagbrowser-operator"
            onClick={(e) => {
              e.stopPropagation()
              setTagOperator(tagOperator === 'and' ? 'or' : 'and')
            }}
            title={tagOperator === 'and' ? 'Match ALL selected tags' : 'Match ANY selected tag'}
          >
            {tagOperator}
          </span>
        )}
      </button>

      {expanded && (
        <>
          {selectedTags.length > 0 && (
            <div className="tag-browser__chips">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  // Console: hairline accent-tint pill — transparent ground so the
                  // chip reads as an outline, not a filled tag from the artifact
                  // palette.
                  className="tag-browser__chip te-tagbrowser-chip"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => useSidebarFilterStore.getState().toggleTag(tag)}
                    className="te-tagbrowser-chip-remove"
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearTags} className="te-tagbrowser-clear">
                Clear
              </button>
            </div>
          )}

          <div className="tag-browser__tree te-tagbrowser-tree scrollbar-hover">
            {tagTree.map((node) => (
              <TagNodeWrapper key={node.fullPath} node={node} depth={0} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
