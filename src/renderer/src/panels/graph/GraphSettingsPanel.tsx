import { useState } from 'react'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import type { GroupRule } from '../../store/graph-settings-store'

// ---------------------------------------------------------------------------
// Theme constants (deep space / Obsidian graph view)
// ---------------------------------------------------------------------------

const ACCENT = '#7c5cbf'
const ACCENT_BG = 'rgba(124, 92, 191, 0.2)'
const PANEL_BG = 'rgba(20, 20, 30, 0.92)'
const PANEL_BORDER = 'rgba(255, 255, 255, 0.08)'
const INPUT_BG = 'rgba(255, 255, 255, 0.05)'
const INPUT_BORDER = 'rgba(255, 255, 255, 0.1)'
const TEXT_HEADER = 'rgba(255, 255, 255, 0.5)'
const TEXT_LABEL = 'rgba(255, 255, 255, 0.6)'
const TEXT_VALUE = 'rgba(255, 255, 255, 0.4)'
const TRACK_BG = 'rgba(255, 255, 255, 0.15)'
const DIVIDER = 'rgba(255, 255, 255, 0.08)'

// ---------------------------------------------------------------------------
// Shared slider styles injected once via <style>
// ---------------------------------------------------------------------------

const SLIDER_CSS = `
  .te-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 2px;
    background: ${TRACK_BG};
    border-radius: 1px;
    outline: none;
    cursor: pointer;
  }
  .te-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
  .te-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
`

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  formatValue?: (v: number) => string
}

function SliderRow({ label, value, min, max, step, onChange, formatValue }: SliderRowProps) {
  const display = formatValue ? formatValue(value) : String(value)
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: TEXT_LABEL }}>
          {label}
        </span>
        <span className="text-xs tabular-nums" style={{ color: TEXT_VALUE }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="te-slider"
      />
    </div>
  )
}

interface TogglePillProps {
  label: string
  active: boolean
  onToggle: () => void
}

function TogglePill({ label, active, onToggle }: TogglePillProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 focus:outline-none"
      style={{
        backgroundColor: active ? ACCENT_BG : INPUT_BG,
        color: active ? ACCENT : TEXT_VALUE
      }}
    >
      {label}
    </button>
  )
}

interface SectionHeaderProps {
  title: string
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({ title, isOpen, onToggle }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full py-2 text-left focus:outline-none"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="transition-transform duration-150"
        style={{
          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          color: TEXT_HEADER
        }}
      >
        <path d="M3 1L7 5L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span
        className="text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: TEXT_HEADER }}
      >
        {title}
      </span>
    </button>
  )
}

function GroupRuleRow({
  rule,
  onUpdate,
  onCycleColor,
  onRemove
}: {
  rule: GroupRule
  onUpdate: (id: string, updates: Partial<Omit<GroupRule, 'id'>>) => void
  onCycleColor: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <input
        type="text"
        value={rule.query}
        onChange={(e) => onUpdate(rule.id, { query: e.target.value })}
        placeholder={'path:"folder" or tag:#name'}
        className="flex-1 min-w-0 px-2 py-1 rounded text-xs focus:outline-none"
        style={{
          backgroundColor: INPUT_BG,
          border: `1px solid ${INPUT_BORDER}`,
          color: '#ffffff'
        }}
      />
      <button
        type="button"
        onClick={() => onCycleColor(rule.id)}
        className="shrink-0 rounded-full cursor-pointer"
        style={{
          width: 12,
          height: 12,
          backgroundColor: rule.color
        }}
        title="Cycle color"
        aria-label={`Cycle color for group rule: ${rule.query || 'empty'}`}
      />
      <button
        type="button"
        onClick={() => onRemove(rule.id)}
        className="shrink-0 text-xs leading-none hover:opacity-70 transition-opacity focus:outline-none"
        style={{ color: TEXT_VALUE }}
        aria-label={`Remove group rule: ${rule.query || 'empty'}`}
      >
        &times;
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface GraphSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function GraphSettingsPanel({ isOpen, onClose }: GraphSettingsPanelProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    filters: true,
    groups: true,
    display: true,
    forces: true
  })

  // Filters
  const graphMode = useGraphSettingsStore((s) => s.graphMode)
  const setGraphMode = useGraphSettingsStore((s) => s.setGraphMode)
  const localGraphDepth = useGraphSettingsStore((s) => s.localGraphDepth)
  const setLocalGraphDepth = useGraphSettingsStore((s) => s.setLocalGraphDepth)
  const searchQuery = useGraphSettingsStore((s) => s.searchQuery)
  const setSearchQuery = useGraphSettingsStore((s) => s.setSearchQuery)
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans)
  const setShowOrphans = useGraphSettingsStore((s) => s.setShowOrphans)
  const showExistingOnly = useGraphSettingsStore((s) => s.showExistingOnly)
  const setShowExistingOnly = useGraphSettingsStore((s) => s.setShowExistingOnly)
  const minEdgeWeight = useGraphSettingsStore((s) => s.minEdgeWeight)
  const setMinEdgeWeight = useGraphSettingsStore((s) => s.setMinEdgeWeight)

  // Groups
  const groupRules = useGraphSettingsStore((s) => s.groupRules)
  const addGroupRule = useGraphSettingsStore((s) => s.addGroupRule)
  const removeGroupRule = useGraphSettingsStore((s) => s.removeGroupRule)
  const updateGroupRule = useGraphSettingsStore((s) => s.updateGroupRule)
  const cycleGroupColor = useGraphSettingsStore((s) => s.cycleGroupColor)

  // Display
  const nodeSizeMultiplier = useGraphSettingsStore((s) => s.nodeSizeMultiplier)
  const setNodeSizeMultiplier = useGraphSettingsStore((s) => s.setNodeSizeMultiplier)
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness)
  const setLinkThickness = useGraphSettingsStore((s) => s.setLinkThickness)
  const showArrows = useGraphSettingsStore((s) => s.showArrows)
  const setShowArrows = useGraphSettingsStore((s) => s.setShowArrows)
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold)
  const setTextFadeThreshold = useGraphSettingsStore((s) => s.setTextFadeThreshold)
  const isAnimating = useGraphSettingsStore((s) => s.isAnimating)
  const setIsAnimating = useGraphSettingsStore((s) => s.setIsAnimating)

  // Forces
  const centerForce = useGraphSettingsStore((s) => s.centerForce)
  const setCenterForce = useGraphSettingsStore((s) => s.setCenterForce)
  const repelForce = useGraphSettingsStore((s) => s.repelForce)
  const setRepelForce = useGraphSettingsStore((s) => s.setRepelForce)
  const linkForce = useGraphSettingsStore((s) => s.linkForce)
  const setLinkForce = useGraphSettingsStore((s) => s.setLinkForce)
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance)
  const setLinkDistance = useGraphSettingsStore((s) => s.setLinkDistance)
  const enableRadial = useGraphSettingsStore((s) => s.enableRadial)
  const setEnableRadial = useGraphSettingsStore((s) => s.setEnableRadial)

  if (!isOpen) return null

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <>
      <style>{SLIDER_CSS}</style>
      <div
        className="absolute right-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden"
        style={{
          width: 280,
          backgroundColor: PANEL_BG,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderLeft: `1px solid ${PANEL_BORDER}`
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${DIVIDER}` }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: TEXT_HEADER }}
          >
            Graph Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-5 h-5 rounded hover:opacity-70 transition-opacity focus:outline-none"
            style={{ color: TEXT_VALUE }}
            aria-label="Close graph settings"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {/* ---- Filters ---- */}
          <SectionHeader
            title="Filters"
            isOpen={openSections.filters}
            onToggle={() => toggleSection('filters')}
          />
          {openSections.filters && (
            <div className="pb-3 space-y-2">
              {/* Graph Mode */}
              <div className="flex gap-2 mb-3">
                <TogglePill
                  label="Global"
                  active={graphMode === 'global'}
                  onToggle={() => setGraphMode('global')}
                />
                <TogglePill
                  label="Local"
                  active={graphMode === 'local'}
                  onToggle={() => setGraphMode('local')}
                />
              </div>

              {graphMode === 'local' && (
                <SliderRow
                  label="Depth"
                  value={localGraphDepth}
                  min={1}
                  max={5}
                  step={1}
                  formatValue={(v) => `${v} hops`}
                  onChange={setLocalGraphDepth}
                />
              )}

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="w-full px-2.5 py-1.5 rounded text-xs focus:outline-none"
                style={{
                  backgroundColor: INPUT_BG,
                  border: `1px solid ${INPUT_BORDER}`,
                  color: '#ffffff'
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                <TogglePill
                  label="Existing only"
                  active={showExistingOnly}
                  onToggle={() => setShowExistingOnly(!showExistingOnly)}
                />
                <TogglePill
                  label="Orphans"
                  active={showOrphans}
                  onToggle={() => setShowOrphans(!showOrphans)}
                />
              </div>
            </div>
          )}

          <div style={{ height: 1, backgroundColor: DIVIDER }} />

          {/* ---- Groups ---- */}
          <SectionHeader
            title="Groups"
            isOpen={openSections.groups}
            onToggle={() => toggleSection('groups')}
          />
          {openSections.groups && (
            <div className="pb-3">
              {groupRules.map((rule) => (
                <GroupRuleRow
                  key={rule.id}
                  rule={rule}
                  onUpdate={updateGroupRule}
                  onCycleColor={cycleGroupColor}
                  onRemove={removeGroupRule}
                />
              ))}
              <button
                type="button"
                onClick={addGroupRule}
                className="mt-2 w-full py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-90 focus:outline-none"
                style={{ backgroundColor: ACCENT, color: '#ffffff' }}
              >
                New group
              </button>
            </div>
          )}

          <div style={{ height: 1, backgroundColor: DIVIDER }} />

          {/* ---- Display ---- */}
          <SectionHeader
            title="Display"
            isOpen={openSections.display}
            onToggle={() => toggleSection('display')}
          />
          {openSections.display && (
            <div className="pb-3">
              {/* Show arrows toggle */}
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs" style={{ color: TEXT_LABEL }}>
                  Show arrows
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showArrows}
                  onClick={() => setShowArrows(!showArrows)}
                  className="relative w-8 h-4 rounded-full transition-colors duration-150 focus:outline-none"
                  style={{ backgroundColor: showArrows ? ACCENT : 'rgba(255,255,255,0.15)' }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-150"
                    style={{ transform: showArrows ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>

              <SliderRow
                label="Text fade threshold"
                value={textFadeThreshold}
                min={0.5}
                max={4}
                step={0.1}
                onChange={setTextFadeThreshold}
              />
              <SliderRow
                label="Node size"
                value={nodeSizeMultiplier}
                min={0.5}
                max={3}
                step={0.1}
                onChange={setNodeSizeMultiplier}
                formatValue={(v) => `${v.toFixed(1)}x`}
              />
              <SliderRow
                label="Link thickness"
                value={linkThickness}
                min={0.3}
                max={2}
                step={0.1}
                onChange={setLinkThickness}
                formatValue={(v) => `${v.toFixed(1)}px`}
              />
              <SliderRow
                label="Min edge weight"
                value={minEdgeWeight}
                min={0.1}
                max={1.0}
                step={0.05}
                onChange={setMinEdgeWeight}
              />

              {/* Animate button */}
              <button
                type="button"
                onClick={() => setIsAnimating(!isAnimating)}
                className="mt-2 w-full py-1.5 rounded text-xs font-medium transition-colors duration-150 focus:outline-none"
                style={{
                  backgroundColor: isAnimating ? ACCENT : INPUT_BG,
                  color: isAnimating ? '#ffffff' : TEXT_LABEL
                }}
              >
                {isAnimating ? 'Stop animation' : 'Start animation'}
              </button>
            </div>
          )}

          <div style={{ height: 1, backgroundColor: DIVIDER }} />

          {/* ---- Forces ---- */}
          <SectionHeader
            title="Forces"
            isOpen={openSections.forces}
            onToggle={() => toggleSection('forces')}
          />
          {openSections.forces && (
            <div className="pb-3">
              <SliderRow
                label="Center force"
                value={centerForce}
                min={0}
                max={0.15}
                step={0.01}
                onChange={setCenterForce}
              />
              <SliderRow
                label="Repel force"
                value={repelForce}
                min={-300}
                max={-10}
                step={5}
                onChange={setRepelForce}
              />
              <SliderRow
                label="Link force"
                value={linkForce}
                min={0}
                max={1}
                step={0.05}
                onChange={setLinkForce}
              />
              <SliderRow
                label="Link distance"
                value={linkDistance}
                min={20}
                max={200}
                step={5}
                onChange={setLinkDistance}
              />
              <div className="flex items-center gap-2 mt-2">
                <TogglePill
                  label="Radial constraint"
                  active={enableRadial}
                  onToggle={() => setEnableRadial(!enableRadial)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
