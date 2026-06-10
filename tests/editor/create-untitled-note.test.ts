import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createUntitledNote } from '../../src/renderer/src/store/editor-store'

const mockFs = {
  fileExists: vi.fn(),
  writeFile: vi.fn()
}

beforeEach(() => {
  vi.resetAllMocks()
  // @ts-expect-error test stub
  window.api = { fs: mockFs }
  mockFs.writeFile.mockResolvedValue(undefined)
})

describe('createUntitledNote', () => {
  it('creates Untitled.md when no collision', async () => {
    mockFs.fileExists.mockResolvedValue(false)

    const result = await createUntitledNote('/vault')

    expect(result).toEqual({ path: '/vault/Untitled.md', title: 'Untitled' })
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = mockFs.writeFile.mock.calls[0]
    expect(path).toBe('/vault/Untitled.md')
    expect(content).toContain('title: Untitled\n')
    expect(content).toContain('tags: []')
  })

  it('counter-suffixes on collision instead of reusing the existing file', async () => {
    mockFs.fileExists.mockImplementation((path: string) =>
      Promise.resolve(path === '/vault/Untitled.md' || path === '/vault/Untitled 1.md')
    )

    const result = await createUntitledNote('/vault')

    expect(result).toEqual({ path: '/vault/Untitled 2.md', title: 'Untitled 2' })
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/vault/Untitled 2.md',
      expect.stringContaining('title: Untitled 2\n')
    )
  })
})
