import { describe, expect, it } from 'vitest'
import { createCanvasNode } from '../canvas-types'
import type { CanvasMutationPlan } from '../canvas-mutation-types'
import { validateCanvasMutationOps } from '../canvas-mutation-validation'

describe('validateCanvasMutationOps', () => {
  it('accepts valid add-node payloads', () => {
    const node = createCanvasNode('text', { x: 10, y: 20 }, { content: 'Pinned note' })
    const ops: CanvasMutationPlan['ops'] = [{ type: 'add-node', node }]

    expect(validateCanvasMutationOps(ops, [])).toBeNull()
  })

  it('rejects add-node payloads without numeric position and size fields', () => {
    const ops = [
      {
        type: 'add-node',
        node: {
          id: 'bad-node',
          type: 'text',
          position: {},
          size: {},
          content: 'Pinned note',
          metadata: {}
        }
      }
    ] as unknown as CanvasMutationPlan['ops']

    expect(validateCanvasMutationOps(ops, [])).toBe(
      'add-node: node.position.x must be a finite number'
    )
  })

  it('rejects add-node payloads missing persisted CanvasNode fields', () => {
    const ops = [
      {
        type: 'add-node',
        node: {
          id: 'bad-node',
          type: 'text',
          position: { x: 0, y: 0 },
          size: { width: 240, height: 80 }
        }
      }
    ] as unknown as CanvasMutationPlan['ops']

    expect(validateCanvasMutationOps(ops, [])).toBe('add-node: node.content must be a string')
  })
})
