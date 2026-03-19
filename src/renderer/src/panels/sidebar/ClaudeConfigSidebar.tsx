import { useState, useCallback, useMemo } from 'react'
import { useClaudeConfigStore } from '../../store/claude-config-store'
import { useInspectorStore } from '../../store/inspector-store'
import { CLAUDE_TYPE_COLORS, type ClaudeTypeKey } from '../../design/claude-type-colors'
import { colors, typography } from '../../design/tokens'
import { SearchBar } from './SearchBar'
import { VaultSelector } from './VaultSelector'

interface ClaudeConfigSidebarProps {
  readonly vaultHistory: readonly string[]
  readonly onSelectVault: (path: string) => void
  readonly onOpenVaultPicker: () => void
  readonly onSelectClaudeConfig: () => void
  readonly onRemoveFromHistory?: (path: string) => void
}

interface ConfigFileItem {
  readonly name: string
  readonly filePath: string
}

interface TypeGroupData {
  readonly key: ClaudeTypeKey
  readonly label: string
  readonly items: readonly ConfigFileItem[]
}

function TypeGroupHeader({
  label,
  count,
  color,
  expanded,
  onToggle
}: {
  readonly label: string
  readonly count: number
  readonly color: string
  readonly expanded: boolean
  readonly onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:opacity-80"
    >
      <svg
        width={10}
        height={10}
        viewBox="0 0 10 10"
        style={{
          color: colors.text.muted,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: '150ms ease-out'
        }}
      >
        <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span
        style={{
          color,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: typography.fontFamily.display,
          letterSpacing: '0.04em',
          textTransform: 'uppercase'
        }}
      >
        {label}
      </span>
      {count > 0 && (
        <span
          className="px-1 rounded text-xs"
          style={{
            color: colors.text.muted,
            fontSize: 10,
            backgroundColor: 'rgba(255, 255, 255, 0.06)'
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function FileItem({
  name,
  filePath,
  color,
  isActive,
  onSelect
}: {
  readonly name: string
  readonly filePath: string
  readonly color: string
  readonly isActive: boolean
  readonly onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center w-full px-2 py-1 text-left text-xs truncate"
      style={{
        color: isActive ? colors.text.primary : colors.text.secondary,
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
        borderLeft: `3px solid ${color}`,
        paddingLeft: 10,
        fontFamily: typography.fontFamily.mono,
        fontSize: 12
      }}
      title={filePath}
    >
      {name}
    </button>
  )
}

export function ClaudeConfigSidebar({
  vaultHistory,
  onSelectVault,
  onOpenVaultPicker,
  onSelectClaudeConfig,
  onRemoveFromHistory
}: ClaudeConfigSidebarProps) {
  const config = useClaudeConfigStore((s) => s.config)
  const inspectorFile = useInspectorStore((s) => s.inspectorFile)
  const openInspector = useInspectorStore((s) => s.openInspector)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<ClaudeTypeKey>>(new Set())

  const toggleGroup = useCallback((key: ClaudeTypeKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const groups = useMemo<readonly TypeGroupData[]>(() => {
    if (!config) return []

    const settingsItems: ConfigFileItem[] = []
    if (config.settings) {
      settingsItems.push({
        name: 'settings.json',
        filePath: config.basePath + '/settings.json'
      })
    }

    return [
      { key: 'settings' as const, label: 'Settings', items: settingsItems },
      {
        key: 'agents' as const,
        label: 'Agents',
        items: config.agents.map((a) => ({ name: a.name, filePath: a.filePath }))
      },
      {
        key: 'skills' as const,
        label: 'Skills',
        items: config.skills.map((s) => ({ name: s.name, filePath: s.filePath }))
      },
      {
        key: 'rules' as const,
        label: 'Rules',
        items: config.rules.map((r) => ({ name: r.name, filePath: r.filePath }))
      },
      {
        key: 'commands' as const,
        label: 'Commands',
        items: config.commands.map((c) => ({ name: c.name, filePath: c.filePath }))
      },
      {
        key: 'teams' as const,
        label: 'Teams',
        items: config.teams.map((t) => ({ name: t.name, filePath: t.filePath }))
      },
      {
        key: 'memory' as const,
        label: 'Memory',
        items: config.memories.map((m) => ({ name: m.name, filePath: m.filePath }))
      }
    ]
  }, [config])

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups
    const query = searchQuery.toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => item.name.toLowerCase().includes(query))
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, searchQuery])

  if (!config) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-2 py-3">
          <VaultSelector
            currentName="~/.claude/"
            isClaudeConfig
            history={vaultHistory}
            onSelectVault={onSelectVault}
            onOpenPicker={onOpenVaultPicker}
            onSelectClaudeConfig={onSelectClaudeConfig}
            onRemoveFromHistory={onRemoveFromHistory}
          />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: colors.accent.default, borderTopColor: 'transparent' }}
            />
            <span className="text-xs" style={{ color: colors.text.muted }}>
              Loading config...
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-2">
        <VaultSelector
          currentName="~/.claude/"
          isClaudeConfig
          history={vaultHistory}
          onSelectVault={onSelectVault}
          onOpenPicker={onOpenVaultPicker}
          onSelectClaudeConfig={onSelectClaudeConfig}
          onRemoveFromHistory={onRemoveFromHistory}
        />
      </div>
      <div className="p-2 pt-0">
        <SearchBar onSearch={setSearchQuery} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredGroups.map((group) => {
          const color = CLAUDE_TYPE_COLORS[group.key]
          const isExpanded = !collapsed.has(group.key)

          return (
            <div key={group.key}>
              <TypeGroupHeader
                label={group.label}
                count={group.items.length}
                color={color}
                expanded={isExpanded}
                onToggle={() => toggleGroup(group.key)}
              />
              {isExpanded &&
                group.items.map((item) => (
                  <FileItem
                    key={item.filePath}
                    name={item.name}
                    filePath={item.filePath}
                    color={color}
                    isActive={inspectorFile?.path === item.filePath}
                    onSelect={() => openInspector(item.filePath, item.name)}
                  />
                ))}
            </div>
          )
        })}
        {filteredGroups.length === 0 && searchQuery.trim() && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs" style={{ color: colors.text.muted }}>
              No matching files
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
