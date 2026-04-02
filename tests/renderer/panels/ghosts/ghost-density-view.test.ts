// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Structural tests verifying GhostPanel uses the density view layout:
 * - Compact rows (GhostRow) instead of stacked cards (GhostCard)
 * - Frequency bars proportional to reference count
 * - Hover-reveal action icons (create, graph, references, dismiss)
 * - Glass context popup for reference details
 * - groupByFrequency sections
 * - useGhostEmerge for file creation (not inline)
 */

const ROOT = resolve(__dirname, '../../../../src/renderer/src')

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8')
}

describe('GhostPanel density view structure', () => {
  const source = readSource('panels/ghosts/GhostPanel.tsx')

  it('exports GhostPanel as named export', () => {
    expect(source).toContain('export function GhostPanel()')
  })

  it('imports groupByFrequency from ghost-sections', () => {
    expect(source).toContain('groupByFrequency')
    expect(source).toContain('ghost-sections')
  })

  it('renders frequency sections with section labels', () => {
    expect(source).toContain('section.label')
    expect(source).toContain('sections.map')
  })

  it('has GhostRow component (not GhostCard)', () => {
    expect(source).toContain('function GhostRow(')
    expect(source).not.toContain('function GhostCard(')
  })

  it('renders proportional frequency bar in each row', () => {
    // barWidth computed from referenceCount / maxCount
    expect(source).toContain('barWidth')
    expect(source).toContain('referenceCount / maxCount')
  })

  it('has hover-reveal action icons', () => {
    expect(source).toContain('function ActionIcon(')
    expect(source).toContain('Create note')
    expect(source).toContain('Show in graph')
    expect(source).toContain('See references')
    expect(source).toContain('Dismiss')
  })

  it('has ContextPopup for reference details', () => {
    expect(source).toContain('function ContextPopup(')
    expect(source).toContain('role="dialog"')
  })

  it('has inline SVG icon components', () => {
    expect(source).toContain('function IconPlus()')
    expect(source).toContain('function IconGraph()')
    expect(source).toContain('function IconThinking()')
    expect(source).toContain('function IconDismiss()')
  })

  it('displays large count header', () => {
    expect(source).toContain('Unresolved References')
    expect(source).toContain('totalCount')
  })

  it('uses useGhostEmerge for file creation', () => {
    expect(source).toContain('useGhostEmerge')
    expect(source).toContain('emerge(')
  })

  it('does not inline file creation logic', () => {
    expect(source).not.toContain('serializeArtifact')
    expect(source).not.toContain('inferFolder')
    expect(source).not.toContain('window.api.fs.writeFile')
    expect(source).not.toContain('window.api.fs.fileExists')
  })

  it('has EmptyState component', () => {
    expect(source).toContain('function EmptyState(')
    expect(source).toContain('All references resolved')
  })

  it('shows count per row that hides on hover', () => {
    expect(source).toContain('ghost.referenceCount')
    // Count opacity toggles on hover
    expect(source).toMatch(/opacity.*hovered/)
  })
})
