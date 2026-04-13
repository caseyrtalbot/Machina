// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ArtifactMaterializer } from '../../src/main/services/artifact-materializer'
import type { AgentArtifactDraft } from '../../src/shared/agent-artifact-types'

function createTestVault(): string {
  const base = join(tmpdir(), `te-prop-${Date.now()}-${randomUUID().slice(0, 8)}`)
  mkdirSync(base, { recursive: true })
  return base
}

function makeDraft(title: string): AgentArtifactDraft {
  return {
    kind: 'compiled-article',
    title,
    body: `Content for ${title}`,
    origin: 'agent',
    sources: ['Source']
  }
}

type Action =
  | { type: 'materialize'; title: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'materialize-fail'; title: string }

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant('materialize' as const),
    title: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[^a-zA-Z0-9 ]/g, 'x'))
  }),
  fc.constant({ type: 'undo' as const }),
  fc.constant({ type: 'redo' as const }),
  fc.record({
    type: fc.constant('materialize-fail' as const),
    title: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[^a-zA-Z0-9 ]/g, 'x'))
  })
)

describe('ArtifactMaterializer property tests', () => {
  it('no orphaned files and no missing references after random action sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 20 }), async (actions) => {
        const vault = createTestVault()
        const mat = new ArtifactMaterializer({ registerExternalWrite: vi.fn() })
        const outputDir = 'compiled/'

        // Track what the "canvas" thinks exists (simulated)
        const canvasRefs = new Set<string>()
        const undoStack: Array<{ paths: string[]; refs: string[] }> = []
        let undoIndex = -1

        for (const action of actions) {
          try {
            switch (action.type) {
              case 'materialize': {
                const draft = makeDraft(action.title)
                const result = await mat.materialize(draft, vault, outputDir)
                // Truncate redo history
                undoStack.length = undoIndex + 1
                undoStack.push({ paths: [result.absolutePath], refs: [result.absolutePath] })
                undoIndex++
                canvasRefs.add(result.absolutePath)
                break
              }
              case 'materialize-fail': {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const origWrite = (mat as any)['_atomicWrite']
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(mat as any)['_atomicWrite'] = async () => {
                  throw new Error('injected failure')
                }
                try {
                  const draft = makeDraft(action.title)
                  await mat.materializeBatch([draft], vault, outputDir)
                } catch {
                  // Expected failure
                } finally {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ;(mat as any)['_atomicWrite'] = origWrite
                }
                break
              }
              case 'undo': {
                if (undoIndex >= 0) {
                  const entry = undoStack[undoIndex]
                  await mat.unmaterialize(entry.paths)
                  for (const ref of entry.refs) canvasRefs.delete(ref)
                  undoIndex--
                }
                break
              }
              case 'redo': {
                if (undoIndex < undoStack.length - 1) {
                  undoIndex++
                  const entry = undoStack[undoIndex]
                  for (const p of entry.paths) {
                    const draft = makeDraft('redo')
                    await mat.rematerialize(draft, p)
                    canvasRefs.add(p)
                  }
                }
                break
              }
            }
          } catch {
            // Some actions may legitimately fail
          }
        }

        // Invariant (a): no orphaned files
        const compiledDir = join(vault, 'compiled')
        const filesOnDisk = existsSync(compiledDir)
          ? readdirSync(compiledDir).map((f) => join(compiledDir, f))
          : []
        for (const file of filesOnDisk) {
          expect(canvasRefs.has(file)).toBe(true)
        }

        // Invariant (b): no missing references
        for (const ref of canvasRefs) {
          expect(existsSync(ref)).toBe(true)
        }

        rmSync(vault, { recursive: true, force: true })
      }),
      { numRuns: 50 }
    )
  })
})
