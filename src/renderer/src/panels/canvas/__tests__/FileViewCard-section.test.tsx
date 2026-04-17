import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { FileViewCard } from '../FileViewCard'

const FILE = `---
kind: cluster
sections:
  card1: Alpha
  card2: Beta
---
intro

## Alpha
alpha body

## Beta
beta body
`

describe('FileViewCard with section projection', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      fs: { readFile: vi.fn().mockResolvedValue(FILE) },
      on: { filesChangedBatch: () => () => {} }
    }
  })

  it('renders only the section body when metadata.section is set', async () => {
    const node = {
      id: 'n1',
      type: 'file-view' as const,
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      content: '/tmp/vault/clusters/foo.md',
      metadata: {
        filePath: '/tmp/vault/clusters/foo.md',
        section: 'card1',
        sectionMap: { card1: 'Alpha', card2: 'Beta' }
      }
    }
    const { container } = render(<FileViewCard node={node} />)
    await waitFor(() => {
      expect(container.textContent).toContain('alpha body')
      expect(container.textContent).not.toContain('beta body')
    })
  })

  it('renders the whole file when no section is set', async () => {
    const node = {
      id: 'n1',
      type: 'file-view' as const,
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      content: '/tmp/vault/clusters/foo.md',
      metadata: { filePath: '/tmp/vault/clusters/foo.md' }
    }
    const { container } = render(<FileViewCard node={node} />)
    await waitFor(() => {
      expect(container.textContent).toContain('alpha body')
      expect(container.textContent).toContain('beta body')
    })
  })
})
