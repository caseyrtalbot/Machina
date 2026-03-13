// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FileService } from '../../src/main/services/file-service'

describe('FileService', () => {
  let dir: string
  let svc: FileService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'te-test-'))
    svc = new FileService()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes and reads a file', async () => {
    const path = join(dir, 'test.md')
    await svc.writeFile(path, '# Hello')
    const content = await svc.readFile(path)
    expect(content).toBe('# Hello')
  })

  it('uses atomic writes (no .tmp left behind)', async () => {
    const path = join(dir, 'atomic.md')
    await svc.writeFile(path, 'content')
    expect(existsSync(path)).toBe(true)
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('deletes a file', async () => {
    const path = join(dir, 'delete-me.md')
    await svc.writeFile(path, 'bye')
    await svc.deleteFile(path)
    expect(existsSync(path)).toBe(false)
  })

  it('lists .md files', async () => {
    await svc.writeFile(join(dir, 'a.md'), 'a')
    await svc.writeFile(join(dir, 'b.md'), 'b')
    await svc.writeFile(join(dir, 'c.txt'), 'c')
    const files = await svc.listFiles(dir, '*.md')
    expect(files).toHaveLength(2)
  })

  it('initializes vault directory', async () => {
    await svc.initVault(dir)
    expect(existsSync(join(dir, '.thought-engine', 'config.json'))).toBe(true)
    expect(existsSync(join(dir, '.thought-engine', 'state.json'))).toBe(true)
  })
})
