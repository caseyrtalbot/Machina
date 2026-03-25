import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useVaultStore } from '../store/vault-store'
import { colors } from '../design/tokens'
import { ACCENT_COLORS, ACCENT_ORDER, type ThemeId } from '../design/themes'
import { FontPicker } from './FontPicker'

type TabId = 'appearance' | 'environment' | 'editor' | 'terminal' | 'vault'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onChangeVault?: () => void
}

interface SettingRowProps {
  label: string
  children: React.ReactNode
}

function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs flex-shrink-0 w-44" style={{ color: colors.text.secondary }}>
        {label}
      </span>
      <div className="flex items-center gap-2 flex-1 justify-end">{children}</div>
    </div>
  )
}

interface SliderInputProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  unit?: string
}

function SliderInput({ value, min, max, step, onChange, unit }: SliderInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28"
        style={{ accentColor: colors.accent.default }}
      />
      <span
        className="text-xs w-12 text-right tabular-nums"
        style={{ color: colors.text.secondary }}
      >
        {value}
        {unit ? unit : ''}
      </span>
    </div>
  )
}

interface ToggleProps {
  value: boolean
  onChange: (value: boolean) => void
}

function Toggle({ value, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="w-9 h-5 rounded-full relative transition-colors flex-shrink-0"
      style={{
        backgroundColor: value ? colors.accent.default : colors.bg.elevated,
        border: `1px solid ${value ? colors.accent.default : colors.border.default}`
      }}
    >
      <span
        className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform"
        style={{
          backgroundColor: value ? '#fff' : colors.text.muted,
          left: value ? 'calc(100% - 1rem)' : '2px'
        }}
      />
    </button>
  )
}

interface SelectOption {
  value: string
  label: string
}

interface SelectInputProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}

function SelectInput({ value, options, onChange }: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2 py-1 rounded"
      style={{
        backgroundColor: colors.bg.elevated,
        color: colors.text.primary,
        border: `1px solid ${colors.border.default}`,
        outline: 'none'
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-[11px] uppercase tracking-widest mb-3 mt-1"
      style={{ color: colors.text.muted }}
    >
      {children}
    </h3>
  )
}

function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const bodyFont = useSettingsStore((s) => s.bodyFont)
  const monoFont = useSettingsStore((s) => s.monoFont)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const setAccentColor = useSettingsStore((s) => s.setAccentColor)
  const setDisplayFont = useSettingsStore((s) => s.setDisplayFont)
  const setBodyFont = useSettingsStore((s) => s.setBodyFont)
  const setMonoFont = useSettingsStore((s) => s.setMonoFont)

  const handleFontChange = (name: string) => {
    setDisplayFont(name)
    setBodyFont(name)
  }

  const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'system', label: 'System' }
  ]

  return (
    <div>
      <SectionHeading>Theme</SectionHeading>
      <div className="flex gap-2 mb-5">
        {THEME_OPTIONS.map(({ id, label }) => {
          const isSelected = theme === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              className="rounded-lg px-4 py-2 text-center transition-all text-xs flex-1"
              style={{
                border: `1.5px solid ${isSelected ? colors.accent.default : colors.border.default}`,
                backgroundColor: colors.bg.elevated
              }}
            >
              <span style={{ color: colors.text.primary }}>{label}</span>
            </button>
          )
        })}
      </div>

      <SectionHeading>Accent Color</SectionHeading>
      <div className="flex gap-2.5 mb-5">
        {ACCENT_ORDER.map((id) => {
          const a = ACCENT_COLORS[id]
          const isSelected = accentColor === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setAccentColor(id)}
              title={a.label}
              className="w-6 h-6 rounded-full transition-all flex-shrink-0"
              style={{
                backgroundColor: a.value,
                outline: isSelected ? `2px solid ${a.value}` : '2px solid transparent',
                outlineOffset: '2px',
                transform: isSelected ? 'scale(1.15)' : undefined,
                boxShadow: isSelected ? `0 0 12px ${a.value}80, 0 0 4px ${a.value}40` : undefined
              }}
            />
          )
        })}
      </div>

      <SectionHeading>Typography</SectionHeading>
      <SettingRow label="Font">
        <FontPicker value={bodyFont} onChange={handleFontChange} />
      </SettingRow>
      <SettingRow label="Code Font">
        <FontPicker value={monoFont} onChange={setMonoFont} />
      </SettingRow>
    </div>
  )
}

function EnvironmentTab() {
  const env = useSettingsStore((s) => s.env)
  const setEnv = useSettingsStore((s) => s.setEnv)
  const resetEnv = useSettingsStore((s) => s.resetEnv)

  return (
    <div>
      <SectionHeading>Canvas</SectionHeading>
      <SettingRow label="Canvas Translucency">
        <SliderInput
          value={env.canvasTranslucency}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => setEnv('canvasTranslucency', v)}
        />
      </SettingRow>
      <SettingRow label="Card Opacity">
        <SliderInput
          value={env.cardOpacity}
          min={50}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => setEnv('cardOpacity', v)}
        />
      </SettingRow>
      <SettingRow label="Card Header Darkness">
        <SliderInput
          value={env.cardHeaderDarkness}
          min={0}
          max={60}
          step={1}
          unit="%"
          onChange={(v) => setEnv('cardHeaderDarkness', v)}
        />
      </SettingRow>
      <SettingRow label="Grid Dot Visibility">
        <SliderInput
          value={env.gridDotVisibility}
          min={0}
          max={50}
          step={1}
          unit="%"
          onChange={(v) => setEnv('gridDotVisibility', v)}
        />
      </SettingRow>

      <SectionHeading>Panels</SectionHeading>
      <SettingRow label="Panel Lightness">
        <SliderInput
          value={env.panelLightness}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => setEnv('panelLightness', v)}
        />
      </SettingRow>
      <SettingRow label="Menu Opacity">
        <SliderInput
          value={env.activityBarOpacity}
          min={20}
          max={80}
          step={1}
          unit="%"
          onChange={(v) => setEnv('activityBarOpacity', v)}
        />
      </SettingRow>

      <SectionHeading>Typography</SectionHeading>
      <SettingRow label="Card Title Font Size">
        <SliderInput
          value={env.cardTitleFontSize}
          min={10}
          max={15}
          step={1}
          unit="px"
          onChange={(v) => setEnv('cardTitleFontSize', v)}
        />
      </SettingRow>
      <SettingRow label="Sidebar Font Size">
        <SliderInput
          value={env.sidebarFontSize}
          min={11}
          max={16}
          step={1}
          unit="px"
          onChange={(v) => setEnv('sidebarFontSize', v)}
        />
      </SettingRow>

      <div className="mt-4">
        <button
          type="button"
          onClick={resetEnv}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            backgroundColor: colors.bg.elevated,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}

function EditorTab() {
  const defaultEditorMode = useSettingsStore((s) => s.defaultEditorMode)
  const autosaveInterval = useSettingsStore((s) => s.autosaveInterval)
  const spellCheck = useSettingsStore((s) => s.spellCheck)
  const setDefaultEditorMode = useSettingsStore((s) => s.setDefaultEditorMode)
  const setAutosaveInterval = useSettingsStore((s) => s.setAutosaveInterval)
  const setSpellCheck = useSettingsStore((s) => s.setSpellCheck)

  return (
    <div>
      <SectionHeading>Editor</SectionHeading>
      <SettingRow label="Default Mode">
        <SelectInput
          value={defaultEditorMode}
          options={[
            { value: 'rich', label: 'Rich' },
            { value: 'source', label: 'Source' }
          ]}
          onChange={(v) => setDefaultEditorMode(v as 'rich' | 'source')}
        />
      </SettingRow>
      <SettingRow label="Autosave Interval (ms)">
        <SliderInput
          value={autosaveInterval}
          min={500}
          max={10000}
          step={500}
          onChange={setAutosaveInterval}
        />
      </SettingRow>
      <SettingRow label="Spell Check">
        <Toggle value={spellCheck} onChange={setSpellCheck} />
      </SettingRow>
    </div>
  )
}

function TerminalTab() {
  const terminalShell = useSettingsStore((s) => s.terminalShell)
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize)
  const scrollbackLines = useSettingsStore((s) => s.scrollbackLines)
  const setTerminalShell = useSettingsStore((s) => s.setTerminalShell)
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize)
  const setScrollbackLines = useSettingsStore((s) => s.setScrollbackLines)

  return (
    <div>
      <SectionHeading>Terminal</SectionHeading>
      <SettingRow label="Shell Path">
        <input
          type="text"
          value={terminalShell}
          onChange={(e) => setTerminalShell(e.target.value)}
          placeholder="/bin/zsh"
          className="text-xs px-2 py-1 rounded w-44"
          style={{
            backgroundColor: colors.bg.elevated,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`,
            outline: 'none'
          }}
        />
      </SettingRow>
      <SettingRow label="Font Size">
        <SliderInput
          value={terminalFontSize}
          min={8}
          max={24}
          step={1}
          onChange={setTerminalFontSize}
        />
      </SettingRow>
      <SettingRow label="Scrollback Lines">
        <SliderInput
          value={scrollbackLines}
          min={1000}
          max={100000}
          step={1000}
          onChange={setScrollbackLines}
        />
      </SettingRow>
    </div>
  )
}

function VaultTab({ onChangeVault }: { onChangeVault?: () => void }) {
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const handleReindex = () => {
    // Placeholder: vault re-index will be wired when the indexer API is available
  }

  return (
    <div>
      <SectionHeading>Vault</SectionHeading>
      <SettingRow label="Vault Path">
        <span
          className="text-xs truncate max-w-[200px] text-right"
          title={vaultPath ?? ''}
          style={{ color: colors.text.muted }}
        >
          {vaultPath ?? 'No vault loaded'}
        </span>
      </SettingRow>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onChangeVault}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            backgroundColor: colors.accent.default,
            color: '#fff'
          }}
        >
          Open Vault...
        </button>
        <button
          type="button"
          onClick={handleReindex}
          className="text-xs px-3 py-1.5 rounded"
          style={{
            backgroundColor: colors.bg.elevated,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`
          }}
        >
          Re-index Vault
        </button>
      </div>
    </div>
  )
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'environment', label: 'Environment' },
  { id: 'editor', label: 'Editor' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'vault', label: 'Vault' }
]

function renderTabContent(tab: TabId, onChangeVault?: () => void) {
  switch (tab) {
    case 'appearance':
      return <AppearanceTab />
    case 'environment':
      return <EnvironmentTab />
    case 'editor':
      return <EditorTab />
    case 'terminal':
      return <TerminalTab />
    case 'vault':
      return <VaultTab onChangeVault={onChangeVault} />
  }
}

export function SettingsModal({ isOpen, onClose, onChangeVault }: SettingsModalProps) {
  const [currentTab, setCurrentTab] = useState<TabId>('appearance')
  const firstTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) firstTabRef.current?.focus()
  }, [isOpen])

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="fixed top-0 right-0 bottom-0 z-40 flex"
      style={{
        width: 380,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease-out',
        pointerEvents: isOpen ? 'auto' : 'none'
      }}
    >
      <div
        className="flex flex-col h-full w-full"
        style={{
          backgroundColor: colors.bg.surface,
          borderLeft: `1px solid ${colors.border.default}`,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: isOpen ? '-8px 0 32px rgba(0, 0, 0, 0.3)' : 'none'
        }}
      >
        {/* Header with close and tab nav */}
        <div
          className="flex items-center justify-between px-4 pt-10 pb-2 flex-shrink-0"
          style={{ borderBottom: `1px solid ${colors.border.default}` }}
        >
          <span className="text-xs font-medium" style={{ color: colors.text.muted }}>
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: colors.text.muted }}
          >
            Close
          </button>
        </div>

        {/* Tab strip */}
        <div
          className="flex gap-0.5 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: `1px solid ${colors.border.default}` }}
        >
          {TABS.map((tab, i) => (
            <button
              key={tab.id}
              ref={i === 0 ? firstTabRef : undefined}
              type="button"
              onClick={() => setCurrentTab(tab.id)}
              className="text-[11px] px-2 py-1 rounded transition-colors"
              style={{
                color: currentTab === tab.id ? colors.text.primary : colors.text.muted,
                backgroundColor: currentTab === tab.id ? colors.accent.muted : 'transparent'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {renderTabContent(currentTab, onChangeVault)}
        </div>
      </div>
    </div>
  )
}
