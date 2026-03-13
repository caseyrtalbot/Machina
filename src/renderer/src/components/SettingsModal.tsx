import { colors } from '../design/tokens'

interface SettingsModalProps { isOpen: boolean; onClose: () => void }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }} onClick={onClose}>
      <div className="w-full max-w-2xl h-[500px] rounded-xl border overflow-hidden"
        style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
        onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b"
          style={{ borderColor: colors.border.default }}>
          <span className="text-sm font-medium" style={{ color: colors.text.primary }}>
            Settings
          </span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded"
            style={{ color: colors.text.muted }}>Close</button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm" style={{ color: colors.text.muted }}>
            Settings will be implemented in Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}
