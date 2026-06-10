// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { resolveAutoUpdateMode, initAutoUpdates } from '../../../src/main/services/auto-update'

const PACKAGED = {
  isPackaged: true,
  resourcesPath: '/Applications/Machina.app/Contents/Resources',
  feedUrl: undefined
}

describe('resolveAutoUpdateMode', () => {
  it('disables in dev builds even when a feed is configured', () => {
    const mode = resolveAutoUpdateMode(
      { ...PACKAGED, isPackaged: false, feedUrl: 'https://updates.example.com' },
      () => true
    )
    expect(mode).toEqual({ kind: 'disabled', reason: 'dev-build' })
  })

  it('uses the env feed URL when set', () => {
    const mode = resolveAutoUpdateMode(
      { ...PACKAGED, feedUrl: 'https://updates.example.com/machina' },
      () => false
    )
    expect(mode).toEqual({ kind: 'feed-url', url: 'https://updates.example.com/machina' })
  })

  it('ignores a whitespace-only env feed URL', () => {
    const mode = resolveAutoUpdateMode({ ...PACKAGED, feedUrl: '   ' }, () => false)
    expect(mode).toEqual({ kind: 'disabled', reason: 'no-feed-configured' })
  })

  it('uses builder config when app-update.yml is bundled', () => {
    const seen: string[] = []
    const mode = resolveAutoUpdateMode(PACKAGED, (path) => {
      seen.push(path)
      return true
    })
    expect(mode).toEqual({ kind: 'builder-config' })
    expect(seen).toEqual([join(PACKAGED.resourcesPath, 'app-update.yml')])
  })

  it('disables when packaged with no feed URL and no app-update.yml', () => {
    const mode = resolveAutoUpdateMode(PACKAGED, () => false)
    expect(mode).toEqual({ kind: 'disabled', reason: 'no-feed-configured' })
  })
})

describe('initAutoUpdates', () => {
  it('no-ops without touching electron-updater when no feed is configured', async () => {
    // electron-updater requires a live electron runtime; importing it here would
    // throw, so resolving cleanly proves the guard short-circuits first.
    await expect(
      initAutoUpdates({ isPackaged: false, resourcesPath: '/tmp', feedUrl: undefined })
    ).resolves.toBeUndefined()
  })
})
