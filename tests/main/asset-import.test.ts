// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importAssetIntoVault, VAULT_ASSETS_DIR } from '../../src/main/utils/asset-import'
import { PathGuard } from '../../src/main/services/path-guard'

let root: string
let vault: string
let outside: string
let guard: PathGuard

beforeEach(async () => {
  // realpath: macOS tmpdir lives behind the /var -> /private/var symlink and
  // the importer canonicalizes every path it returns.
  root = await realpath(await mkdtemp(join(tmpdir(), 'asset-import-')))
  vault = join(root, 'vault')
  outside = join(root, 'outside')
  await mkdir(vault, { recursive: true })
  await mkdir(outside, { recursive: true })
  guard = new PathGuard(vault)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('importAssetIntoVault', () => {
  it('copies an external file into <vault>/assets and returns the vault path', async () => {
    const src = join(outside, 'photo.png')
    await writeFile(src, 'png-bytes')

    const dest = await importAssetIntoVault(src, vault, guard)

    expect(dest).toBe(join(vault, VAULT_ASSETS_DIR, 'photo.png'))
    expect(await readFile(dest, 'utf-8')).toBe('png-bytes')
    // The returned path passes the guard that gates every later read.
    expect(() => guard.assertWithinVault(dest)).not.toThrow()
  })

  it('suffixes the filename instead of clobbering an existing asset', async () => {
    const src = join(outside, 'doc.pdf')
    await writeFile(src, 'second')
    await mkdir(join(vault, VAULT_ASSETS_DIR), { recursive: true })
    await writeFile(join(vault, VAULT_ASSETS_DIR, 'doc.pdf'), 'first')

    const dest = await importAssetIntoVault(src, vault, guard)

    expect(dest).toBe(join(vault, VAULT_ASSETS_DIR, 'doc 2.pdf'))
    expect(await readFile(join(vault, VAULT_ASSETS_DIR, 'doc.pdf'), 'utf-8')).toBe('first')
    expect(await readFile(dest, 'utf-8')).toBe('second')
  })

  it('references in-vault sources in place without copying', async () => {
    const src = join(vault, 'media', 'inside.png')
    await mkdir(join(vault, 'media'), { recursive: true })
    await writeFile(src, 'already here')

    const dest = await importAssetIntoVault(src, vault, guard)

    expect(dest).toBe(src)
    // No assets/ directory was created — nothing was copied.
    await expect(readFile(join(vault, VAULT_ASSETS_DIR, 'inside.png'))).rejects.toThrow()
  })

  it('rejects directories', async () => {
    await expect(importAssetIntoVault(outside, vault, guard)).rejects.toThrow(/not a regular file/)
  })

  it('sanitizes control characters out of the imported name', async () => {
    const src = join(outside, 'weird.png')
    await writeFile(src, 'x')

    const dest = await importAssetIntoVault(src, vault, guard)

    expect(dest).toBe(join(vault, VAULT_ASSETS_DIR, 'we ird.png'))
  })
})
