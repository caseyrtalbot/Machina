import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useVaultStore } from '../store/vault-store'
import { useClaudeStatusStore } from '../store/claude-status-store'
import { colors, borderRadius, typography, transitions, floatingPanel } from '../design/tokens'
import { EMBEDDING_MODEL_DOWNLOAD_MB } from '@shared/engine/embeddings'
import { FontPicker } from './FontPicker'
import { Modal } from './overlay/Modal'

interface EmbeddingsStatus {
  enabled: boolean
  state: 'off' | 'loading-model' | 'indexing' | 'ready' | 'error'
  docCount: number
  error?: string
}

function describeEmbeddings(status: EmbeddingsStatus): string {
  switch (status.state) {
    case 'loading-model':
      return `downloading model (~${EMBEDDING_MODEL_DOWNLOAD_MB} MB)…`
    case 'indexing':
      return 'embedding notes…'
    case 'ready':
      return `${status.docCount} docs embedded`
    case 'error':
      return `error: ${status.error ?? 'unknown'}`
    case 'off':
      return 'off'
  }
}

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
          transition: `left ${transitions.hover}, background-color ${transitions.hover}`
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
      className="settings-select text-xs"
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
  const defaultEditorMode = useSettingsStore((s) => s.defaultEditorMode)
  const autosaveInterval = useSettingsStore((s) => s.autosaveInterval)
  const spellCheck = useSettingsStore((s) => s.spellCheck)
  const setDefaultEditorMode = useSettingsStore((s) => s.setDefaultEditorMode)
  const setAutosaveInterval = useSettingsStore((s) => s.setAutosaveInterval)
  const setSpellCheck = useSettingsStore((s) => s.setSpellCheck)
  const semanticSearch = useSettingsStore((s) => s.semanticSearch)
  const setSemanticSearch = useSettingsStore((s) => s.setSemanticSearch)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  // Live embedder status (model download / indexing progress) while the
  // modal is open and the opt-in is on. Off = zero embeddings IPC.
  const [embedStatus, setEmbedStatus] = useState<EmbeddingsStatus | null>(null)
  useEffect(() => {
    if (!isOpen || !semanticSearch) return
    let cancelled = false
    const refresh = (): void => {
      void window.api.embeddings
        .status()
        .then((status) => {
          if (!cancelled) setEmbedStatus(status)
        })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isOpen, semanticSearch])

  const handleSemanticSearch = (value: boolean): void => {
    setSemanticSearch(value)
    void window.api.embeddings.setEnabled(value).catch(() => {})
  }

  const handleFontChange = (name: string) => {
    setDisplayFont(name)
    setBodyFont(name)
  }

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

  type McpStatus = Awaited<ReturnType<typeof window.api.mcp.status>>
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    void window.api.mcp
      .status()
      .then((s) => {
        setMcpStatus(s)
        setMcpUrlCopied(false)
      })
      .catch(() => setMcpStatus(null))
  }, [isOpen])

  const copyMcpConnectCommand = async (): Promise<void> => {
    if (!mcpStatus?.url || !mcpStatus.token) return
    await navigator.clipboard.writeText(
      `claude mcp add --transport http --header "Authorization: Bearer ${mcpStatus.token}" machina ${mcpStatus.url}`
    )
    setMcpUrlCopied(true)
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      keepMounted
      ariaLabelledBy="settings-dialog-title"
      initialFocusRef={closeRef}
      style={{ transition: `opacity ${transitions.modalFade}` }}
      panelClassName="settings-shell relative flex flex-col"
      panelStyle={{
        width: 'min(560px, calc(100vw - 64px))',
        maxHeight: 'min(720px, calc(100vh - 96px))',
        backgroundColor: colors.bg.base,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: borderRadius.container,
        boxShadow: floatingPanel.shadow,
        transform: isOpen ? 'scale(1)' : 'scale(0.98)',
        transition: `transform ${transitions.surface}`
      }}
    >
      {/* Header */}
      <div
        className="settings-header flex items-center justify-between px-4 py-3 flex-shrink-0"
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
        {/* ── Typography ── */}
        <SectionHeading>Typography</SectionHeading>
        <SettingRow label="Font">
          <FontPicker value={bodyFont} onChange={handleFontChange} />
        </SettingRow>
        <SettingRow label="Code Font">
          <FontPicker value={monoFont} onChange={setMonoFont} categoryFilter="monospace" />
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

        {/* ── Search ── */}
        <SectionHeading>Search</SectionHeading>
        <SettingRow label="Semantic Search">
          <Toggle
            value={semanticSearch}
            onChange={handleSemanticSearch}
            ariaLabel="Semantic search"
          />
        </SettingRow>
        <p
          style={{
            margin: '2px 0 10px',
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: 10,
            lineHeight: 1.5
          }}
        >
          Meaning-based results merged into search, computed fully on-device. First enable downloads
          a one-time ~{EMBEDDING_MODEL_DOWNLOAD_MB} MB model.
          {semanticSearch && embedStatus ? ` Status: ${describeEmbeddings(embedStatus)}.` : ''}
        </p>

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

        {/* ── MCP server ── */}
        <SectionHeading>MCP Server</SectionHeading>
        <div className="settings-vault-card" style={{ alignItems: 'flex-start' }}>
          <div className="flex flex-col min-w-0 gap-2 w-full">
            <div className="flex items-center justify-between gap-2">
              <span
                style={{
                  color: colors.text.primary,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 12
                }}
              >
                Local MCP endpoint
              </span>
              <span
                style={{
                  color: mcpStatus?.running ? colors.accent.default : colors.text.muted,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: typography.metadata.size,
                  letterSpacing: typography.metadata.letterSpacing,
                  textTransform: typography.metadata.textTransform
                }}
              >
                {mcpStatus === null
                  ? 'checking...'
                  : mcpStatus.running
                    ? `Running · ${mcpStatus.toolCount} tools`
                    : 'Not running'}
              </span>
            </div>
            {mcpStatus?.running && mcpStatus.url ? (
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate"
                  title={mcpStatus.url}
                  style={{
                    color: colors.text.secondary,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 11
                  }}
                >
                  {mcpStatus.url}
                </span>
                <button
                  type="button"
                  onClick={() => void copyMcpConnectCommand()}
                  className="settings-button transition-colors flex-shrink-0"
                  style={{ color: colors.text.secondary }}
                >
                  {mcpUrlCopied ? 'Copied' : 'Copy connect command'}
                </button>
              </div>
            ) : null}
            <span
              style={{
                color: colors.text.muted,
                fontFamily: typography.fontFamily.mono,
                fontSize: 10,
                lineHeight: 1.5
              }}
            >
              {mcpStatus?.running
                ? 'Connect external agents with the copied command; it includes a bearer token that rotates each launch. Writes require in-app approval.'
                : 'Starts when a vault is open. Serves vault search, graph, and gated writes to external MCP clients.'}
            </span>
          </div>
        </div>

        {/* ── Reset ── */}
        <div className="settings-footer gap-2">
          <button
            type="button"
            onClick={() => {
              onClose()
              useClaudeStatusStore.getState().openOnboarding()
            }}
            className="settings-button transition-colors"
            style={{ color: colors.text.muted }}
          >
            Run Setup
          </button>
          <button
            type="button"
            onClick={() => void window.api.app.revealLogs()}
            className="settings-button transition-colors"
            style={{ color: colors.text.muted }}
          >
            Reveal Logs
          </button>
        </div>
      </div>
    </Modal>
  )
}
