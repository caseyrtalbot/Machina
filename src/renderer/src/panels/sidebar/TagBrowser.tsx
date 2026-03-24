import { useMemo } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useSidebarFilterStore } from '../../store/sidebar-filter-store'
import { buildTagIndex } from '@engine/tag-index'
import type { TagTreeNode } from '@engine/tag-index'
import { colors, transitions } from '../../design/tokens'

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
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left rounded interactive-hover"
        style={{
          paddingLeft: 8 + depth * 12,
          transition: transitions.hover,
          backgroundColor: isSelected ? colors.accent.muted : 'transparent'
        }}
      >
        {hasChildren && (
          <span
            className="text-[10px] shrink-0 cursor-pointer"
            style={{ color: colors.text.muted, width: 12, textAlign: 'center' }}
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
          className="text-xs truncate flex-1"
          style={{ color: isSelected ? colors.accent.default : colors.text.secondary }}
        >
          {node.name}
        </span>
        <span className="text-[11px] shrink-0" style={{ color: colors.text.muted }}>
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

  const tagTree = useMemo(() => buildTagIndex(artifacts), [artifacts])

  if (tagTree.length === 0) {
    return (
      <div className="px-3 py-2">
        <span
          className="text-[10px] uppercase tracking-[0.15em]"
          style={{ color: colors.text.muted }}
        >
          Tags
        </span>
        <p className="text-xs mt-1" style={{ color: colors.text.muted }}>
          No tags yet. Add <code className="text-[11px]">tags:</code> to frontmatter.
        </p>
      </div>
    )
  }

  return (
    <div className="py-1">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1">
        <span
          className="text-[10px] uppercase font-medium tracking-[0.15em]"
          style={{ color: colors.text.muted }}
        >
          Tags
        </span>
        <button
          type="button"
          onClick={() => setTagOperator(tagOperator === 'and' ? 'or' : 'and')}
          className="text-[10px] uppercase px-1 rounded"
          style={{ color: colors.text.muted, transition: transitions.hover }}
          title={tagOperator === 'and' ? 'Match ALL selected tags' : 'Match ANY selected tag'}
        >
          {tagOperator}
        </button>
      </div>

      {/* Selected tag chips */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{
                color: colors.accent.default,
                backgroundColor: colors.accent.muted
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => useSidebarFilterStore.getState().toggleTag(tag)}
                className="text-[10px] opacity-60 hover:opacity-100"
                style={{ transition: transitions.hover }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearTags}
            className="text-[10px] px-1 opacity-60 hover:opacity-100"
            style={{ color: colors.text.muted, transition: transitions.hover }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Tag tree */}
      <div className="px-1">
        {tagTree.map((node) => (
          <TagNodeWrapper key={node.fullPath} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}
