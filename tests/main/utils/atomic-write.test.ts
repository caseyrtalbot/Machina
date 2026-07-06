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

    // The scan sees the SHARED os.tmpdir(), so a parallel suite's in-flight
    // atomicWrite can stage a te-write-* file between the two snapshots. A
    // real leak persists forever (that is the bug this test guards); a racing
    // suite's staging file disappears within milliseconds. Settle-and-recheck
    // keeps the assertion deterministic under parallel test runs.
    const after = await listStagedTmpFiles()
    let leaked = after.filter((name) => !before.includes(name))
    for (let attempt = 0; attempt < 20 && leaked.length > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      const remaining = await listStagedTmpFiles()
      leaked = leaked.filter((name) => remaining.includes(name))
    }
    expect(leaked).toEqual([])
  })
})
