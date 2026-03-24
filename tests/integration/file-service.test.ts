// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs'
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

  it('skips hidden and build directories when listing all files recursively', async () => {
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(dir, 'build'), { recursive: true })
    mkdirSync(join(dir, 'src'), { recursive: true })

    await svc.writeFile(join(dir, '.hidden', 'secret.ts'), 'secret')
    await svc.writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'pkg')
    await svc.writeFile(join(dir, 'build', 'generated.js'), 'generated')
    await svc.writeFile(join(dir, 'src', 'index.ts'), 'export {}')

    const files = await svc.listAllFilesRecursive(dir)

    expect(files).toEqual([join(dir, 'src', 'index.ts')])
  })

  it('initializes vault directory', async () => {
    await svc.initVault(dir)
    expect(existsSync(join(dir, '.machina', 'config.json'))).toBe(true)
    expect(existsSync(join(dir, '.machina', 'state.json'))).toBe(true)
    expect(existsSync(join(dir, '.machina', 'artifacts', 'sessions'))).toBe(true)
    expect(existsSync(join(dir, '.machina', 'artifacts', 'patterns'))).toBe(true)
    expect(existsSync(join(dir, '.machina', 'artifacts', 'tensions'))).toBe(true)
  })

  it('creates, lists, and updates system artifacts', async () => {
    await svc.initVault(dir)

    const path = await svc.createSystemArtifact(dir, 'session', 'debug-session', '# Debug Session')
    expect(path).toBe(join(dir, '.machina', 'artifacts', 'sessions', 'debug-session.md'))

    let artifacts = await svc.listSystemArtifactFiles(dir)
    expect(artifacts).toEqual([path])

    artifacts = await svc.listSystemArtifactFiles(dir, 'session')
    expect(artifacts).toEqual([path])

    await svc.updateSystemArtifact(path, '# Updated Session')
    const content = await svc.readFile(path)
    expect(content).toBe('# Updated Session')
  })
})
