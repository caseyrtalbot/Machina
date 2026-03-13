import { useState } from 'react'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import { colors } from '../../design/tokens'
import { ARTIFACT_TYPES } from '@shared/types'
import type { ArtifactType } from '@shared/types'

// ---- Helper components ----

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className="flex-1 text-xs truncate"
        style={{ color: colors.text.secondary }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-20 accent-violet-500"
      />
      <span
        className="w-10 text-right text-xs tabular-nums"
        style={{ color: colors.text.muted }}
      >
        {value}
      </span>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs" style={{ color: colors.text.secondary }}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative w-8 h-4 rounded-full transition-colors duration-150 focus:outline-none"
        style={{
          backgroundColor: checked ? colors.accent.default : colors.border.default
        }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-150"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </button>
    </div>
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
      className="flex items-center gap-1.5 w-full py-1.5 text-left focus:outline-none"
    >
      <span
        className="text-xs transition-transform duration-150"
        style={{
          color: colors.text.muted,
          display: 'inline-block',
          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)'
        }}
      >
        ▶
      </span>
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: colors.text.muted }}
      >
        {title}
      </span>
    </button>
  )
}

// ---- Main panel ----

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
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans)
  const setShowOrphans = useGraphSettingsStore((s) => s.setShowOrphans)
  const showExistingOnly = useGraphSettingsStore((s) => s.showExistingOnly)
  const setShowExistingOnly = useGraphSettingsStore((s) => s.setShowExistingOnly)

  // Groups
  const groups = useGraphSettingsStore((s) => s.groups)
  const setGroupVisible = useGraphSettingsStore((s) => s.setGroupVisible)
  const setGroupColor = useGraphSettingsStore((s) => s.setGroupColor)

  // Display
  const baseNodeSize = useGraphSettingsStore((s) => s.baseNodeSize)
  const setBaseNodeSize = useGraphSettingsStore((s) => s.setBaseNodeSize)
  const linkOpacity = useGraphSettingsStore((s) => s.linkOpacity)
  const setLinkOpacity = useGraphSettingsStore((s) => s.setLinkOpacity)
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness)
  const setLinkThickness = useGraphSettingsStore((s) => s.setLinkThickness)
  const showArrows = useGraphSettingsStore((s) => s.showArrows)
  const setShowArrows = useGraphSettingsStore((s) => s.setShowArrows)
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold)
  const setTextFadeThreshold = useGraphSettingsStore((s) => s.setTextFadeThreshold)
  const showMinimap = useGraphSettingsStore((s) => s.showMinimap)
  const setShowMinimap = useGraphSettingsStore((s) => s.setShowMinimap)

  // Forces
  const centerForce = useGraphSettingsStore((s) => s.centerForce)
  const setCenterForce = useGraphSettingsStore((s) => s.setCenterForce)
  const repelForce = useGraphSettingsStore((s) => s.repelForce)
  const setRepelForce = useGraphSettingsStore((s) => s.setRepelForce)
  const linkForce = useGraphSettingsStore((s) => s.linkForce)
  const setLinkForce = useGraphSettingsStore((s) => s.setLinkForce)
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance)
  const setLinkDistance = useGraphSettingsStore((s) => s.setLinkDistance)

  // Animation
  const isAnimating = useGraphSettingsStore((s) => s.isAnimating)
  const setIsAnimating = useGraphSettingsStore((s) => s.setIsAnimating)

  if (!isOpen) return null

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden"
      style={{
        width: 260,
        backgroundColor: colors.bg.surface,
        borderLeft: `1px solid ${colors.border.default}`
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: `1px solid ${colors.border.default}` }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: colors.text.primary }}
        >
          Graph Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded hover:opacity-70 transition-opacity focus:outline-none"
          style={{ color: colors.text.muted }}
          aria-label="Close graph settings"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-2">

        {/* Filters section */}
        <SectionHeader
          title="Filters"
          isOpen={openSections.filters}
          onToggle={() => toggleSection('filters')}
        />
        {openSections.filters && (
          <div className="pb-3">
            <ToggleRow
              label="Show orphans"
              checked={showOrphans}
              onChange={setShowOrphans}
            />
            <ToggleRow
              label="Show existing only"
              checked={showExistingOnly}
              onChange={setShowExistingOnly}
            />
          </div>
        )}

        <div
          className="my-1"
          style={{ height: 1, backgroundColor: colors.border.default }}
        />

        {/* Groups section */}
        <SectionHeader
          title="Groups"
          isOpen={openSections.groups}
          onToggle={() => toggleSection('groups')}
        />
        {openSections.groups && (
          <div className="pb-3">
            {ARTIFACT_TYPES.map((type: ArtifactType) => {
              const group = groups[type]
              return (
                <div key={type} className="flex items-center justify-between py-1">
                  <span className="text-xs capitalize" style={{ color: colors.text.secondary }}>
                    {type}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={group.color}
                      onChange={(e) => setGroupColor(type, e.target.value)}
                      className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                      title={`${type} color`}
                    />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={group.visible}
                      onClick={() => setGroupVisible(type, !group.visible)}
                      className="text-xs px-1.5 py-0.5 rounded transition-colors duration-150 focus:outline-none"
                      style={{
                        backgroundColor: group.visible ? colors.accent.muted : colors.border.default,
                        color: group.visible ? colors.accent.default : colors.text.muted
                      }}
                    >
                      {group.visible ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div
          className="my-1"
          style={{ height: 1, backgroundColor: colors.border.default }}
        />

        {/* Display section */}
        <SectionHeader
          title="Display"
          isOpen={openSections.display}
          onToggle={() => toggleSection('display')}
        />
        {openSections.display && (
          <div className="pb-3">
            <SliderRow
              label="Node size"
              value={baseNodeSize}
              min={1}
              max={20}
              step={1}
              onChange={setBaseNodeSize}
            />
            <SliderRow
              label="Link opacity"
              value={linkOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={setLinkOpacity}
            />
            <SliderRow
              label="Link thickness"
              value={linkThickness}
              min={0.5}
              max={5}
              step={0.5}
              onChange={setLinkThickness}
            />
            <ToggleRow
              label="Show arrows"
              checked={showArrows}
              onChange={setShowArrows}
            />
            <SliderRow
              label="Text fade"
              value={textFadeThreshold}
              min={0.5}
              max={4}
              step={0.1}
              onChange={setTextFadeThreshold}
            />
            <ToggleRow
              label="Show minimap"
              checked={showMinimap}
              onChange={setShowMinimap}
            />
          </div>
        )}

        <div
          className="my-1"
          style={{ height: 1, backgroundColor: colors.border.default }}
        />

        {/* Forces section */}
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
              max={1}
              step={0.05}
              onChange={setCenterForce}
            />
            <SliderRow
              label="Repel force"
              value={repelForce}
              min={-500}
              max={0}
              step={10}
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
              min={10}
              max={200}
              step={5}
              onChange={setLinkDistance}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderTop: `1px solid ${colors.border.default}` }}
      >
        <button
          type="button"
          onClick={() => setIsAnimating(!isAnimating)}
          className="w-full py-2 rounded text-xs font-semibold transition-colors duration-150 focus:outline-none"
          style={{
            backgroundColor: isAnimating ? colors.accent.muted : colors.border.default,
            color: isAnimating ? colors.accent.default : colors.text.secondary
          }}
        >
          {isAnimating ? 'Stop Animation' : 'Start Animation'}
        </button>
      </div>
    </div>
  )
}
