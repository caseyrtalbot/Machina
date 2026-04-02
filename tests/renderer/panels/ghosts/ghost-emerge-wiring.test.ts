import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// @vitest-environment node

/**
 * Structural tests verifying GhostPanel and GraphDetailDrawer use the
 * useGhostEmerge hook instead of inline ghost-creation logic.
 *
 * The actual emerge behavior is tested in hooks/__tests__/useGhostEmerge.test.ts.
 * These tests verify the wiring: that the components delegate to the hook
 * and no longer contain the old inline implementation.
 */

const ROOT = resolve(__dirname, '../../../../src/renderer/src')

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8')
}

describe('GhostPanel useGhostEmerge wiring', () => {
  const source = readSource('panels/ghosts/GhostPanel.tsx')

  it('imports useGhostEmerge', () => {
    expect(source).toContain('useGhostEmerge')
  })

  it('does not import serializeArtifact', () => {
    expect(source).not.toContain('serializeArtifact')
  })

  it('does not import inferFolder', () => {
    expect(source).not.toContain('inferFolder')
  })

  it('does not import useEditorStore', () => {
    expect(source).not.toContain('useEditorStore')
  })

  it('calls emerge() not inline file creation', () => {
    // Should use emerge() from the hook
    expect(source).toContain('emerge(')
    // Should not directly write files
    expect(source).not.toContain('window.api.fs.writeFile')
  })

  it('uses isEmerging instead of creating state', () => {
    expect(source).toContain('isEmerging')
    // The old local 'creating' state should be gone
    // (check for the useState pattern, not the word in JSX text)
    expect(source).not.toMatch(/useState.*creating/)
  })
})

describe('GraphDetailDrawer useGhostEmerge wiring', () => {
  const source = readSource('panels/graph/GraphDetailDrawer.tsx')

  it('imports useGhostEmerge', () => {
    expect(source).toContain('useGhostEmerge')
  })

  it('does not import serializeArtifact', () => {
    expect(source).not.toContain('serializeArtifact')
  })

  it('does not import inferFolder from ghost-index', () => {
    expect(source).not.toContain('inferFolder')
  })

  it('does not build an Artifact object inline for ghost creation', () => {
    // The old GhostDrawerContent built an Artifact literal inline.
    // Now it delegates to emerge(). The Artifact type import may remain
    // for other uses, but the inline construction pattern is gone.
    expect(source).not.toContain("signal: 'untested'")
  })

  it('calls emerge() not inline file creation', () => {
    expect(source).toContain('emerge(')
    expect(source).not.toContain('window.api.fs.writeFile')
    expect(source).not.toContain('window.api.fs.fileExists')
  })

  it('uses isEmerging instead of creating state in GhostDrawerContent', () => {
    expect(source).toContain('isEmerging')
  })
})
