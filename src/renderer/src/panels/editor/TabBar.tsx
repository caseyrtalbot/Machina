import { useCallback } from 'react'
import { colors, transitions } from '../../design/tokens'
import type { Tab } from '../../store/editor-store'

interface TabBarProps {
  readonly tabs: readonly Tab[]
  readonly activePath: string | null
  readonly onSwitch: (path: string) => void
  readonly onClose: (path: string) => void
}

export function TabBar({ tabs, activePath, onSwitch, onClose }: TabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div
      className="flex items-center shrink-0 overflow-x-auto"
      style={{
        height: 32,
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`
      }}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.path}
          tab={tab}
          isActive={tab.path === activePath}
          onSwitch={onSwitch}
          onClose={onClose}
        />
      ))}
    </div>
  )
}

interface TabItemProps {
  readonly tab: Tab
  readonly isActive: boolean
  readonly onSwitch: (path: string) => void
  readonly onClose: (path: string) => void
}

function TabItem({ tab, isActive, onSwitch, onClose }: TabItemProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onClose(tab.path)
    },
    [tab.path, onClose]
  )

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        onClose(tab.path)
      }
    },
    [tab.path, onClose]
  )

  return (
    <div
      className="flex items-center group cursor-pointer shrink-0"
      style={{
        height: '100%',
        borderRight: `1px solid ${colors.border.default}`,
        backgroundColor: isActive ? colors.bg.base : 'transparent',
        borderBottom: isActive ? `2px solid ${colors.accent.default}` : '2px solid transparent',
        transition: transitions.default
      }}
      onClick={() => onSwitch(tab.path)}
      onMouseDown={handleMiddleClick}
    >
      <span
        className="px-3 text-xs truncate select-none"
        style={{
          color: isActive ? colors.text.primary : colors.text.secondary,
          maxWidth: 160
        }}
        title={tab.title}
      >
        {tab.title}
      </span>
      <button
        onClick={handleClose}
        className="flex items-center justify-center w-4 h-4 mr-1 rounded opacity-0 group-hover:opacity-100"
        style={{
          color: colors.text.muted,
          fontSize: 11,
          transition: transitions.default
        }}
        title="Close tab"
      >
        ×
      </button>
    </div>
  )
}
