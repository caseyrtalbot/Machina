import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useVaultStore } from '../store/vault-store'
import { colors } from '../design/tokens'
import { FontPicker } from './FontPicker'

type TabId = 'appearance' | 'environment' | 'editor' | 'vault'

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
    <div className="settings-row">
      <span className="settings-label flex-shrink-0 w-44">{label}</span>
      <div className="settings-field">{children}</div>
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
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="graph-slider w-28"
      />
      <span
        className="settings-value w-12 text-right tabular-nums"
        style={{ color: colors.text.secondary }}
      >
        {value}
        {unit ?? ''}
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
      className="settings-toggle w-9 h-5 rounded-full relative transition-colors flex-shrink-0"
      style={{
        backgroundColor: value ? 'rgba(255, 255, 255, 0.3)' : colors.bg.elevated,
        border: `1px solid ${value ? 'rgba(255, 255, 255, 0.4)' : colors.border.default}`
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
      className="settings-select text-xs rounded"
      style={{ outline: 'none' }}
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
  return <h3 className="settings-section-heading">{children}</h3>
}

function AppearanceTab() {
  const bodyFont = useSettingsStore((s) => s.bodyFont)
  const monoFont = useSettingsStore((s) => s.monoFont)
  const setDisplayFont = useSettingsStore((s) => s.setDisplayFont)
  const setBodyFont = useSettingsStore((s) => s.setBodyFont)
  const setMonoFont = useSettingsStore((s) => s.setMonoFont)

  const handleFontChange = (name: string) => {
    setDisplayFont(name)
    setBodyFont(name)
  }

  return (
    <div>
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
      <SettingRow label="Card Blur">
        <SliderInput
          value={env.cardBlur}
          min={0}
          max={24}
          step={1}
          unit="px"
          onChange={(v) => setEnv('cardBlur', v)}
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
      <SettingRow label="Chrome Opacity">
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
          className="settings-button text-xs transition-colors"
          style={{ color: colors.text.primary }}
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

function VaultTab({ onChangeVault }: { onChangeVault?: () => void }) {
  const vaultPath = useVaultStore((s) => s.vaultPath)

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
          className="settings-primary-button text-xs transition-colors"
        >
          Open Vault...
        </button>
      </div>
    </div>
  )
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'environment', label: 'Environment' },
  { id: 'editor', label: 'Editor' },
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
        className="settings-shell flex flex-col h-full w-full"
        style={{
          backgroundColor: colors.bg.surface,
          borderLeft: `1px solid ${colors.border.default}`,
          boxShadow: isOpen ? '-8px 0 32px rgba(0, 0, 0, 0.3)' : 'none'
        }}
      >
        <div className="settings-header flex items-start justify-between px-4 pt-10 pb-3 flex-shrink-0">
          <div className="flex flex-col gap-2">
            <span className="settings-kicker">Workspace</span>
            <span className="settings-title">Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="settings-button text-xs transition-colors"
            style={{ color: colors.text.muted }}
          >
            Close
          </button>
        </div>

        <div className="settings-tab-strip flex-shrink-0">
          {TABS.map((tab, i) => (
            <button
              key={tab.id}
              ref={i === 0 ? firstTabRef : undefined}
              type="button"
              onClick={() => setCurrentTab(tab.id)}
              className="settings-tab transition-colors"
              data-active={currentTab === tab.id ? 'true' : 'false'}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content flex-1 overflow-y-auto">
          {renderTabContent(currentTab, onChangeVault)}
        </div>
      </div>
    </div>
  )
}
