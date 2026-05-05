import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useVaultStore } from '../store/vault-store'
import { useClaudeStatusStore } from '../store/claude-status-store'
import { colors, borderRadius, typography } from '../design/tokens'
import { ACCENT_PRESETS, type AccentId } from '../design/accent-presets'
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
      className="settings-toggle relative transition-colors flex-shrink-0"
      style={{
        width: 36,
        height: 20,
        borderRadius: borderRadius.inline,
        backgroundColor: value ? colors.accent.soft : 'transparent',
        border: `1px solid ${value ? colors.accent.default : colors.border.default}`,
        padding: 0
      }}
    >
      <span
        className="absolute transition-transform"
        style={{
          top: 3,
          width: 12,
          height: 12,
          borderRadius: borderRadius.inline,
          backgroundColor: value ? colors.accent.default : colors.text.muted,
          left: value ? 'calc(100% - 15px)' : 3,
          transition: 'left 150ms ease-out, background-color 150ms ease-out'
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

interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface SegmentedControlProps<T extends string> {
  readonly value: T
  readonly options: ReadonlyArray<SegmentedOption<T>>
  readonly onChange: (value: T) => void
  readonly ariaLabel: string
}

/** Hairline-square segmented switch for density / radii / background tint.
 * Mirrors the design's Tweaks panel chip strip — flat, monospace label,
 * accent under-line on the active segment. */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 'var(--r-inline)',
        background: 'var(--bg-card)',
        overflow: 'hidden'
      }}
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: '4px 10px',
              fontFamily: typography.fontFamily.mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: active ? 'var(--color-accent-default)' : colors.text.secondary,
              background: active ? 'var(--bg-tint-accent)' : 'transparent',
              border: 'none',
              borderLeft: i === 0 ? 'none' : `1px solid ${colors.border.subtle}`,
              cursor: 'pointer',
              transition: 'color 120ms ease-out, background 120ms ease-out'
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

interface AccentPreviewRowProps {
  readonly accentId: AccentId
  readonly customHex: string
  readonly onPick: (id: AccentId) => void
}

function AccentPreviewRow({ accentId, customHex, onPick }: AccentPreviewRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 24px)',
        gap: 6,
        padding: '4px 0 14px'
      }}
    >
      {ACCENT_PRESETS.map((p) => {
        const active = accentId === p.id
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            title={`${p.label} · ${p.hex}`}
            aria-label={p.label}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: borderRadius.inline,
              background: p.hex,
              border: `1px solid ${active ? colors.text.primary : colors.border.default}`,
              cursor: 'pointer',
              transition: 'border-color 120ms ease-out'
            }}
          />
        )
      })}
      <button
        type="button"
        onClick={() => onPick('custom')}
        title="Custom hex"
        aria-label="Custom"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          borderRadius: borderRadius.inline,
          background: accentId === 'custom' ? customHex : 'transparent',
          border:
            accentId === 'custom'
              ? `1px solid ${colors.text.primary}`
              : `0.5px dashed ${colors.border.default}`,
          color: colors.text.muted,
          fontFamily: typography.fontFamily.mono,
          fontSize: 11,
          lineHeight: '20px',
          cursor: 'pointer'
        }}
      >
        {accentId === 'custom' ? '' : '+'}
      </button>
    </div>
  )
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
  const accentId = useSettingsStore((s) => s.accentId)
  const customAccentHex = useSettingsStore((s) => s.customAccentHex)
  const setAccentId = useSettingsStore((s) => s.setAccentId)
  const setCustomAccentHex = useSettingsStore((s) => s.setCustomAccentHex)
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

  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    void window.api.agentNative.hasKey().then(setHasKey)
  }, [isOpen])

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) return
    try {
      await window.api.agentNative.setKey(keyDraft.trim())
      setKeyDraft('')
      setKeyError(null)
      setHasKey(true)
      useClaudeStatusStore.getState().setNativeKeyConfigured(true)
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err))
    }
  }

  const clearKey = async (): Promise<void> => {
    await window.api.agentNative.clearKey()
    setHasKey(false)
    useClaudeStatusStore.getState().setNativeKeyConfigured(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed top-0 right-0 bottom-0 z-40 flex"
      style={{
        width: 360,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease-out',
        pointerEvents: isOpen ? 'auto' : 'none'
      }}
    >
      <div
        className="settings-shell flex flex-col h-full w-full"
        style={{
          backgroundColor: colors.bg.base,
          borderLeft: `1px solid ${colors.border.subtle}`
        }}
      >
        {/* Header */}
        <div
          className="settings-header flex items-center justify-between px-4 pt-10 pb-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${colors.border.subtle}` }}
        >
          <div className="flex flex-col gap-2">
            <span
              className="settings-kicker"
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: typography.metadata.size,
                letterSpacing: typography.metadata.letterSpacing,
                textTransform: typography.metadata.textTransform,
                color: colors.text.muted
              }}
            >
              Workspace
            </span>
            <span
              id="settings-dialog-title"
              className="settings-title"
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: 12,
                letterSpacing: typography.metadata.letterSpacing,
                textTransform: typography.metadata.textTransform,
                color: colors.text.primary,
                fontWeight: 500
              }}
            >
              Settings
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="settings-close-btn"
            aria-label="Close settings"
            style={{ borderRadius: borderRadius.inline }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>

        {/* Single scrollable content */}
        <div className="settings-content flex-1 overflow-y-auto">
          {/* ── Appearance ── */}
          <SectionHeading>Appearance</SectionHeading>
          <SettingRow label="Accent">
            <SelectInput
              value={accentId === 'custom' ? customAccentHex : accentId}
              options={ACCENT_PRESETS.map((p) => ({
                value: p.id,
                label: `${p.label} · ${p.hex}`
              }))}
              onChange={(v) => setAccentId(v as AccentId)}
            />
          </SettingRow>
          <AccentPreviewRow accentId={accentId} customHex={customAccentHex} onPick={setAccentId} />
          {accentId === 'custom' && (
            <div style={{ padding: '0 0 14px' }}>
              <input
                type="text"
                value={customAccentHex}
                onChange={(e) => setCustomAccentHex(e.target.value)}
                spellCheck={false}
                aria-label="Custom accent hex"
                placeholder="#ffb454"
                className="settings-input text-xs rounded"
                style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}

          {/* ── Tweaks ── */}
          <SectionHeading>Tweaks</SectionHeading>
          <SettingRow label="Density">
            <SegmentedControl
              ariaLabel="Density"
              value={env.density}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'default', label: 'Default' },
                { value: 'comfy', label: 'Comfy' }
              ]}
              onChange={(v) => setEnv('density', v)}
            />
          </SettingRow>
          <SettingRow label="Corners">
            <SegmentedControl
              ariaLabel="Corner radii"
              value={env.radii}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'soft', label: 'Soft' }
              ]}
              onChange={(v) => setEnv('radii', v)}
            />
          </SettingRow>
          <SettingRow label="Background">
            <SegmentedControl
              ariaLabel="Background tint"
              value={env.backgroundTint}
              options={[
                { value: 'pure', label: 'Pure' },
                { value: 'near-black', label: 'Near' },
                { value: 'warm', label: 'Warm' }
              ]}
              onChange={(v) => setEnv('backgroundTint', v)}
            />
          </SettingRow>
          <SettingRow label="Canvas Grid">
            <Toggle
              value={env.canvasGrid}
              onChange={(v) => setEnv('canvasGrid', v)}
              ariaLabel="Show canvas dot grid"
            />
          </SettingRow>

          {/* ── Typography ── */}
          <SectionHeading>Typography</SectionHeading>
          <SettingRow label="Font">
            <FontPicker value={bodyFont} onChange={handleFontChange} />
          </SettingRow>
          <SettingRow label="Code Font">
            <FontPicker value={monoFont} onChange={setMonoFont} categoryFilter="monospace" />
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
          <SettingRow label="File Tree">
            <SliderInput
              value={env.sidebarFontSize}
              min={11}
              max={16}
              step={1}
              unit="px"
              onChange={(v) => setEnv('sidebarFontSize', v)}
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
                <span
                  className="truncate"
                  style={{
                    color: colors.text.primary,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 12
                  }}
                >
                  {vaultName ?? 'No vault'}
                </span>
                <span
                  className="truncate"
                  title={vaultPath ?? ''}
                  style={{
                    color: colors.text.muted,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 10
                  }}
                >
                  {vaultPath ?? 'Select a vault to get started'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onChangeVault}
              className="settings-button transition-colors flex-shrink-0"
              style={{ color: colors.text.secondary }}
            >
              {vaultPath ? 'Change' : 'Open'}
            </button>
          </div>

          {/* ── machina-native ── */}
          <SectionHeading>machina-native</SectionHeading>
          <div className="settings-vault-card" style={{ alignItems: 'flex-start' }}>
            <div className="flex flex-col min-w-0 gap-2 w-full">
              <span
                style={{
                  color: colors.text.primary,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 12
                }}
              >
                Anthropic API key
              </span>
              {hasKey === null ? (
                <span
                  style={{
                    color: colors.text.muted,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 10
                  }}
                >
                  checking...
                </span>
              ) : hasKey ? (
                <div className="flex items-center justify-between gap-2">
                  <span
                    style={{
                      color: colors.text.muted,
                      fontFamily: typography.fontFamily.mono,
                      fontSize: typography.metadata.size,
                      letterSpacing: typography.metadata.letterSpacing,
                      textTransform: typography.metadata.textTransform
                    }}
                  >
                    Key configured
                  </span>
                  <button
                    type="button"
                    onClick={clearKey}
                    className="settings-button transition-colors flex-shrink-0"
                    style={{ color: colors.text.secondary }}
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-ant-..."
                    className="settings-select"
                    style={{
                      width: '100%',
                      fontFamily: typography.fontFamily.mono,
                      fontSize: 12
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveKey()
                    }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    {keyError && (
                      <span
                        style={{
                          color: colors.claude.error,
                          fontFamily: typography.fontFamily.mono,
                          fontSize: 10
                        }}
                      >
                        {keyError}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveKey()}
                      disabled={!keyDraft.trim()}
                      className="settings-primary-button transition-colors flex-shrink-0 ml-auto"
                      style={{
                        color: keyDraft.trim() ? colors.text.primary : colors.text.muted,
                        opacity: keyDraft.trim() ? 1 : 0.5
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              <span
                style={{
                  color: colors.text.muted,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 10,
                  lineHeight: 1.5
                }}
              >
                Stored encrypted via Electron safeStorage. Override with ANTHROPIC_API_KEY.
              </span>
            </div>
          </div>

          {/* ── Reset ── */}
          <div className="settings-footer">
            <button
              type="button"
              onClick={resetEnv}
              className="settings-button transition-colors"
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
