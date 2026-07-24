import { useCallback } from 'react'
import { useGraphViewStore } from '@renderer/store/graph-view-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import type { ForceParams } from './graph-types'
import { DEFAULT_FORCE_PARAMS } from './graph-types'

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue?: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, displayValue, onChange }: SliderProps) {
  return (
    <div className="te-graph-slider-row">
      <div className="te-graph-slider-row__head">
        <span className="te-graph-settings__label">{label}</span>
        <span className="te-graph-slider-row__value">
          {displayValue ?? value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="graph-slider"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="te-graph-toggle">
      <span className="te-graph-settings__label">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className="te-graph-toggle__track"
        data-checked={checked}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span className="te-graph-toggle__knob" />
      </button>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="te-graph-section">
      <div className="te-graph-section__title">{title}</div>
      <div className="te-graph-section__body">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GraphSettingsPanel
// ---------------------------------------------------------------------------

interface GraphSettingsPanelProps {
  onForceParamsChange: (params: Partial<ForceParams>) => void
  onReheat: () => void
}

export function GraphSettingsPanel({ onForceParamsChange, onReheat }: GraphSettingsPanelProps) {
  const showLabels = useGraphViewStore((s) => s.showLabels)
  const showGhostNodes = useGraphViewStore((s) => s.showGhostNodes)
  const showEdges = useGraphViewStore((s) => s.showEdges)
  const showOrphanNodes = useGraphViewStore((s) => s.showOrphanNodes)
  const nodeScale = useGraphViewStore((s) => s.nodeScale)
  const labelScale = useGraphViewStore((s) => s.labelScale)
  const forceParams = useGraphViewStore((s) => s.forceParams)
  const nodeCount = useGraphViewStore((s) => s.nodeCount)
  const edgeCount = useGraphViewStore((s) => s.edgeCount)
  const alpha = useGraphViewStore((s) => s.alpha)
  const settled = useGraphViewStore((s) => s.settled)

  const setShowLabels = useGraphViewStore((s) => s.setShowLabels)
  const setShowGhostNodes = useGraphViewStore((s) => s.setShowGhostNodes)
  const setShowEdges = useGraphViewStore((s) => s.setShowEdges)
  const setShowOrphanNodes = useGraphViewStore((s) => s.setShowOrphanNodes)
  const setNodeScale = useGraphViewStore((s) => s.setNodeScale)
  const setLabelScale = useGraphViewStore((s) => s.setLabelScale)
  const setForceParams = useGraphViewStore((s) => s.setForceParams)
  const resetForceParams = useGraphViewStore((s) => s.resetForceParams)

  const edgeBrightness = useSettingsStore((s) => s.edgeBrightness)
  const nodeBrightness = useSettingsStore((s) => s.nodeBrightness)
  const setEdgeBrightness = useSettingsStore((s) => s.setEdgeBrightness)
  const setNodeBrightness = useSettingsStore((s) => s.setNodeBrightness)

  const handleForceChange = useCallback(
    (key: keyof ForceParams, value: number) => {
      const update = { [key]: value }
      setForceParams(update)
      onForceParamsChange(update)
    },
    [setForceParams, onForceParamsChange]
  )

  const handleReset = useCallback(() => {
    resetForceParams()
    onForceParamsChange(DEFAULT_FORCE_PARAMS)
  }, [resetForceParams, onForceParamsChange])

  return (
    <div className="te-graph-settings">
      {/* Stats bar */}
      <div className="te-graph-settings__stats">
        <span>{nodeCount} nodes</span>
        <span>{edgeCount} edges</span>
        <span
          className="te-graph-settings__status-dot"
          data-settled={settled}
          title={settled ? 'Settled' : `Simulating (${(alpha * 100).toFixed(0)}%)`}
        />
      </div>

      {/* Display */}
      <Section title="Display">
        <Toggle label="Labels" checked={showLabels} onChange={setShowLabels} />
        <Toggle label="Edges" checked={showEdges} onChange={setShowEdges} />
        <Toggle label="Ghost nodes" checked={showGhostNodes} onChange={setShowGhostNodes} />
        <Toggle label="Orphan nodes" checked={showOrphanNodes} onChange={setShowOrphanNodes} />
        <Slider
          label="Node size"
          value={nodeScale}
          min={0.3}
          max={3}
          step={0.1}
          onChange={setNodeScale}
        />
        <Slider
          label="Label size"
          value={labelScale}
          min={0.5}
          max={2}
          step={0.1}
          onChange={setLabelScale}
        />
        <Slider
          label="Edge brightness"
          value={edgeBrightness}
          min={0.2}
          max={2}
          step={0.1}
          displayValue={`${edgeBrightness.toFixed(1)}x`}
          onChange={setEdgeBrightness}
        />
        <Slider
          label="Node brightness"
          value={nodeBrightness}
          min={0.2}
          max={2}
          step={0.1}
          displayValue={`${nodeBrightness.toFixed(1)}x`}
          onChange={setNodeBrightness}
        />
      </Section>

      {/* Forces */}
      <Section title="Forces">
        <Slider
          label="Center force"
          value={forceParams.centerStrength}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => handleForceChange('centerStrength', v)}
        />
        <Slider
          label="Repel force"
          value={Math.abs(forceParams.repelStrength)}
          min={0}
          max={1000}
          step={10}
          displayValue={Math.abs(forceParams.repelStrength).toFixed(0)}
          onChange={(v) => handleForceChange('repelStrength', -v)}
        />
        <Slider
          label="Link strength"
          value={forceParams.linkStrength}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => handleForceChange('linkStrength', v)}
        />
        <Slider
          label="Link distance"
          value={forceParams.linkDistance}
          min={30}
          max={500}
          step={10}
          displayValue={forceParams.linkDistance.toFixed(0)}
          onChange={(v) => handleForceChange('linkDistance', v)}
        />
        <Slider
          label="Damping"
          value={forceParams.velocityDecay}
          min={0.05}
          max={0.95}
          step={0.05}
          onChange={(v) => handleForceChange('velocityDecay', v)}
        />
      </Section>

      {/* Actions */}
      <div className="te-graph-settings__actions">
        <button onClick={onReheat} className="te-graph-settings__btn">
          Reheat
        </button>
        <button onClick={handleReset} className="te-graph-settings__btn">
          Reset
        </button>
      </div>
    </div>
  )
}
