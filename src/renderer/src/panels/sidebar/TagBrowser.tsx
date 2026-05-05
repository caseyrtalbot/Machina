import { useMemo, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useSidebarFilterStore } from '../../store/sidebar-filter-store'
import { buildTagIndex } from '@engine/tag-index'
import type { TagTreeNode } from '@engine/tag-index'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
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
        className="tag-browser__row w-full flex items-center gap-1.5 px-2 py-1 text-left interactive-hover"
        style={{
          paddingLeft: 8 + depth * 12,
          transition: transitions.hover,
          backgroundColor: isSelected ? colors.accent.soft : 'transparent',
          // Active tag rows pick up the accent left-stripe; idle rows get a
          // matching transparent stripe so the indent grid stays aligned.
          borderLeft: `2px solid ${isSelected ? colors.accent.default : 'transparent'}`,
          borderRadius: borderRadius.inline
        }}
      >
        {hasChildren && (
          <span
            className="shrink-0 cursor-pointer"
            style={{
              color: colors.text.muted,
              width: 12,
              textAlign: 'center',
              fontSize: 'var(--env-sidebar-tertiary-font-size)'
            }}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.fullPath)
            }}
          >
            {isExpanded ? '\u25BE' : '\u25B8'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 12 }} />}
        <span
          className="truncate flex-1"
          style={{
            color: isSelected ? colors.accent.default : colors.text.secondary,
            fontSize: 'var(--env-sidebar-font-size)'
          }}
        >
          {node.name}
        </span>
        <span
          className="shrink-0"
          style={{
            color: colors.text.secondary,
            fontSize: 'var(--env-sidebar-secondary-font-size)'
          }}
        >
          {node.count}
        </span>
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
    <div className="tag-browser flex-shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="tag-browser__toggle interactive-hover"
        style={{ transition: transitions.hover }}
      >
        <div className="flex items-center gap-1.5">
          <span
            style={{
              color: colors.text.muted,
              fontSize: 'var(--env-sidebar-tertiary-font-size)'
            }}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
          {/* Console section header: muted mono 10px / 0.14em uppercase. */}
          <SectionLabel style={{ color: colors.text.muted }}>Tags</SectionLabel>
          <span
            style={{
              color: colors.text.disabled,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {tagTree.length}
          </span>
        </div>
        {expanded && (
          <span
            // Operator pill (AND/OR) uses the same hairline 2px chip recipe as
            // workspace chips for visual consistency across sidebar chrome.
            style={{
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              padding: '2px 6px',
              border: `0.5px solid ${colors.border.subtle}`,
              borderRadius: borderRadius.inline,
              lineHeight: 1
            }}
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
                  className="tag-browser__chip inline-flex items-center"
                  // Console: hairline accent-tint pill — transparent ground so the
                  // chip reads as an outline, not a filled tag from the artifact
                  // palette.
                  style={{
                    background: 'transparent',
                    border: `0.5px solid ${colors.accent.line}`,
                    borderRadius: borderRadius.inline,
                    color: colors.accent.default,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 11,
                    letterSpacing: 0,
                    padding: '2px 6px'
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => useSidebarFilterStore.getState().toggleTag(tag)}
                    className="opacity-60 hover:opacity-100"
                    style={{ transition: transitions.hover }}
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearTags}
                className="px-1 opacity-60 hover:opacity-100"
                style={{
                  color: colors.text.muted,
                  transition: transitions.hover,
                  fontSize: 'var(--env-sidebar-tertiary-font-size)'
                }}
              >
                Clear
              </button>
            </div>
          )}

          <div className="tag-browser__tree max-h-48 overflow-y-auto scrollbar-hover">
            {tagTree.map((node) => (
              <TagNodeWrapper key={node.fullPath} node={node} depth={0} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
