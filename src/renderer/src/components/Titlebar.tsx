import { colors } from '../design/tokens'

interface TitlebarProps { vaultName: string; onOpenSettings: () => void }

export function Titlebar({ vaultName, onOpenSettings }: TitlebarProps) {
  return (
    <div className="h-[38px] flex items-center px-3 select-none flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
      {/* Traffic light spacer (macOS native) */}
      <div className="w-[70px] flex-shrink-0" />
      {/* Vault tab */}
      <div className="flex items-center gap-2 px-3 py-1 rounded-md text-sm"
        style={{
          backgroundColor: colors.bg.elevated, color: colors.text.primary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}>
        <span className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.accent.default }} />
        <span className="truncate max-w-[200px]">{vaultName}</span>
      </div>
      <div className="flex-1" />
      {/* Settings gear */}
      <button onClick={onOpenSettings}
        className="p-1.5 rounded-md transition-colors hover:bg-[#1A1A1D]"
        style={{ color: colors.text.secondary, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Settings">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
        </svg>
      </button>
    </div>
  )
}
