import { describe, it, expect, vi } from 'vitest'
import { commitSectionEdit } from '../section-projection'

const FILE = `---
sections:
  card1: Alpha
  card2: Beta
---
## Alpha
old body

## Beta
beta body
`

describe('commitSectionEdit', () => {
  it('writes a file with only the target section changed', async () => {
    const readFile = vi.fn().mockResolvedValue(FILE)
    const writeDocument = vi.fn().mockResolvedValue(undefined)

    const r = await commitSectionEdit('/f.md', 'card1', 'new body\n', {
      readFile,
      writeDocument
    })
    expect(r.ok).toBe(true)
    expect(writeDocument).toHaveBeenCalledOnce()
    const written = (writeDocument.mock.calls[0] as unknown[])[1] as string
    expect(written).toContain('## Alpha\nnew body')
    expect(written).toContain('## Beta\nbeta body')
    expect(written).not.toContain('old body')
  })

  it('returns error on missing section', async () => {
    const readFile = vi.fn().mockResolvedValue(FILE)
    const writeDocument = vi.fn()
    const r = await commitSectionEdit('/f.md', 'ghost', 'x', { readFile, writeDocument })
    expect(r.ok).toBe(false)
    expect(writeDocument).not.toHaveBeenCalled()
  })
})
