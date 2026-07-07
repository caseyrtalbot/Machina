// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { DocumentManager } from '../document-manager'
import { FileService } from '../file-service'

// These use the REAL FileService against temp files so the binary sniff and
// byte-preservation guarantees are exercised end-to-end, not mocked away.
describe('DocumentManager binary safety (real fs)', () => {
  let dir: string
  let dm: DocumentManager

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dm-binary-'))
    dm = new DocumentManager(new FileService())
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses to open a binary file and never creates a Document or writes it back', async () => {
    // A PNG-ish header: contains a NUL byte in the first bytes.
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x1a, 0x0a, 0xff, 0xfe])
    const path = join(dir, 'logo.png')
    await writeFile(path, original)

    await expect(dm.open(path)).rejects.toThrow(/binary/i)
    expect(dm.documents.has(path)).toBe(false)

    // Flushing must not resurrect or rewrite the file, and the bytes on disk
    // must be byte-identical to what we wrote (the catastrophic failure mode).
    await dm.flushAll()
    const after = await readFile(path)
    expect(after.equals(original)).toBe(true)
  })

  it('opens a UTF-8 text file with generics/JSDoc/backticks byte-for-byte losslessly', async () => {
    // The exact shapes the markdown round-trip destroyed: <T> generics, JSDoc
    // star lines, and backticks inside a regex.
    const source =
      'export const f = (): Promise<Set<number>> => new Set<number>()\n' +
      '/**\n * @param x the thing\n */\n' +
      'const re = /`(?:json)?\\n([\\s\\S]*?)`/\n'
    const path = join(dir, 'sample.ts')
    await writeFile(path, source, 'utf-8')

    const result = await dm.open(path)
    expect(result.content).toBe(source)
    expect(dm.documents.has(path)).toBe(true)
  })
})
