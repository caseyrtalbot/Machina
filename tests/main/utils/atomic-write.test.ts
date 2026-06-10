// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWrite } from '../../../src/main/utils/atomic-write'

const TMP_PREFIX = 'te-write-'

async function listStagedTmpFiles(): Promise<readonly string[]> {
  const entries = await readdir(tmpdir())
  return entries.filter((name) => name.startsWith(TMP_PREFIX))
}

describe('atomicWrite', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atomic-write-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes content readable at the destination', async () => {
    const dest = join(dir, 'note.md')
    await atomicWrite(dest, '# hello')
    expect(await readFile(dest, 'utf-8')).toBe('# hello')
  })

  it('replaces existing content atomically', async () => {
    const dest = join(dir, 'note.md')
    await writeFile(dest, 'old', 'utf-8')
    await atomicWrite(dest, 'new')
    expect(await readFile(dest, 'utf-8')).toBe('new')
  })

  it('unlinks the staged temp file when the rename fails', async () => {
    const before = await listStagedTmpFiles()

    // Destination parent is a regular file → rename fails (ENOTDIR).
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'x', 'utf-8')
    await expect(atomicWrite(join(blocker, 'note.md'), 'content')).rejects.toThrow()

    const after = await listStagedTmpFiles()
    const leaked = after.filter((name) => !before.includes(name))
    expect(leaked).toEqual([])
  })
})
