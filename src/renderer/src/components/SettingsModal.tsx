import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useVaultStore } from '../store/vault-store'
import { colors } from '../design/tokens'
import { BASE_COLORS } from '../design/themes'
import { FontPicker } from './FontPicker'

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
      <span className="settings-label flex-shrink-0">{label}</span>
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
  ariaLabel: string
}

function Toggle({ value, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
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

export function SettingsModal({ isOpen, onClose, onChangeVault }: SettingsModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Settings state
  const bodyFont = useSettingsStore((s) => s.bodyFont)
  const monoFont = useSettingsStore((s) => s.monoFont)
  const setDisplayFont = useSettingsStore((s) => s.setDisplayFont)
  const setBodyFont = useSettingsStore((s) => s.setBodyFont)
  const setMonoFont = useSettingsStore((s) => s.setMonoFont)
  const env = useSettingsStore((s) => s.env)
  const setEnv = useSettingsStore((s) => s.setEnv)
  const resetEnv = useSettingsStore((s) => s.resetEnv)
  const defaultEditorMode = useSettingsStore((s) => s.defaultEditorMode)
  const autosaveInterval = useSettingsStore((s) => s.autosaveInterval)
  const spellCheck = useSettingsStore((s) => s.spellCheck)
  const setDefaultEditorMode = useSettingsStore((s) => s.setDefaultEditorMode)
  const setAutosaveInterval = useSettingsStore((s) => s.setAutosaveInterval)
  const setSpellCheck = useSettingsStore((s) => s.setSpellCheck)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const handleFontChange = (name: string) => {
    setDisplayFont(name)
    setBodyFont(name)
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen])

  const vaultName = vaultPath?.split('/').pop() ?? null

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="fixed top-0 right-0 bottom-0 z-40 flex"
      style={{
        width: 340,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease-out',
        pointerEvents: isOpen ? 'auto' : 'none'
      }}
    >
      <div
        className="settings-shell flex flex-col h-full w-full"
        style={{
          backgroundColor: `rgb(${BASE_COLORS.canvasSurface.r}, ${BASE_COLORS.canvasSurface.g}, ${BASE_COLORS.canvasSurface.b})`,
          borderLeft: `1px solid ${colors.border.default}`,
          boxShadow: isOpen ? '-8px 0 32px rgba(0, 0, 0, 0.3)' : 'none'
        }}
      >
        {/* Header */}
        <div className="settings-header flex items-center justify-between px-4 pt-10 pb-3 flex-shrink-0">
          <div className="flex flex-col gap-1">
            <span className="settings-kicker">Workspace</span>
            <span className="settings-title">Settings</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="settings-close-btn"
            aria-label="Close settings"
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>

        {/* Single scrollable content */}
        <div className="settings-content flex-1 overflow-y-auto">
          {/* ── Typography ── */}
          <SectionHeading>Typography</SectionHeading>
          <SettingRow label="Font">
            <FontPicker value={bodyFont} onChange={handleFontChange} />
          </SettingRow>
          <SettingRow label="Code Font">
            <FontPicker value={monoFont} onChange={setMonoFont} />
          </SettingRow>
          <SettingRow label="Card Titles">
            <SliderInput
              value={env.cardTitleFontSize}
              min={10}
              max={15}
              step={1}
              unit="px"
              onChange={(v) => setEnv('cardTitleFontSize', v)}
            />
          </SettingRow>
          <SettingRow label="Card Text">
            <SliderInput
              value={env.cardBodyFontSize}
              min={10}
              max={20}
              step={1}
              unit="px"
              onChange={(v) => setEnv('cardBodyFontSize', v)}
            />
          </SettingRow>
          <SettingRow label="Sidebar">
            <SliderInput
              value={env.sidebarFontSize}
              min={11}
              max={16}
              step={1}
              unit="px"
              onChange={(v) => setEnv('sidebarFontSize', v)}
            />
          </SettingRow>

          {/* ── Canvas ── */}
          <SectionHeading>Canvas</SectionHeading>
          <SettingRow label="Translucency">
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
          <SettingRow label="Card Header">
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
          <SettingRow label="Grid Dots">
            <SliderInput
              value={env.gridDotVisibility}
              min={0}
              max={50}
              step={1}
              unit="%"
              onChange={(v) => setEnv('gridDotVisibility', v)}
            />
          </SettingRow>

          {/* ── Chrome ── */}
          <SectionHeading>Chrome</SectionHeading>
          <SettingRow label="Panel Opacity">
            <SliderInput
              value={env.activityBarOpacity}
              min={20}
              max={80}
              step={1}
              unit="%"
              onChange={(v) => setEnv('activityBarOpacity', v)}
            />
          </SettingRow>

          {/* ── Editor ── */}
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
          <SettingRow label="Autosave">
            <SliderInput
              value={autosaveInterval}
              min={500}
              max={10000}
              step={500}
              onChange={setAutosaveInterval}
              unit="ms"
            />
          </SettingRow>
          <SettingRow label="Spell Check">
            <Toggle value={spellCheck} onChange={setSpellCheck} ariaLabel="Spell check" />
          </SettingRow>

          {/* ── Vault ── */}
          <SectionHeading>Vault</SectionHeading>
          <div className="settings-vault-card">
            <div className="flex items-center gap-2 min-w-0">
              <svg
                width={14}
                height={14}
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: colors.text.muted, flexShrink: 0 }}
              >
                <path d="M7 1L1.5 3.5v4L7 10l5.5-2.5v-4L7 1z" />
                <path d="M1.5 3.5L7 6l5.5-2.5" />
                <line x1="7" y1="6" x2="7" y2="10" />
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="text-xs truncate" style={{ color: colors.text.primary }}>
                  {vaultName ?? 'No vault'}
                </span>
                <span
                  className="text-[10px] truncate"
                  title={vaultPath ?? ''}
                  style={{ color: colors.text.muted }}
                >
                  {vaultPath ?? 'Select a vault to get started'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onChangeVault}
              className="settings-button text-xs transition-colors flex-shrink-0"
              style={{ color: colors.text.secondary }}
            >
              {vaultPath ? 'Change' : 'Open'}
            </button>
          </div>

          {/* ── Reset ── */}
          <div className="settings-footer">
            <button
              type="button"
              onClick={resetEnv}
              className="settings-button text-xs transition-colors"
              style={{ color: colors.text.muted }}
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
