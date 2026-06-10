// Guarded electron-updater bootstrap.
//
// Auto-updates only activate when a real feed is configured:
//   - `app-update.yml` exists in process.resourcesPath (written by electron-builder
//     when electron-builder.yml has a `publish` block), or
//   - MACHINA_UPDATE_FEED_URL is set (generic-provider override for testing).
// Dev builds and credential-less packaged builds no-op — electron-updater is not
// even imported. Signing/notarization setup is documented in electron-builder.yml.

import { existsSync } from 'fs'
import { join } from 'path'

export interface AutoUpdateEnv {
  isPackaged: boolean
  resourcesPath: string
  feedUrl: string | undefined
}

export type AutoUpdateMode =
  | { kind: 'disabled'; reason: 'dev-build' | 'no-feed-configured' }
  | { kind: 'feed-url'; url: string }
  | { kind: 'builder-config' }

export function resolveAutoUpdateMode(
  env: AutoUpdateEnv,
  fileExists: (path: string) => boolean = existsSync
): AutoUpdateMode {
  if (!env.isPackaged) {
    return { kind: 'disabled', reason: 'dev-build' }
  }

  const url = env.feedUrl?.trim()
  if (url) {
    return { kind: 'feed-url', url }
  }

  if (fileExists(join(env.resourcesPath, 'app-update.yml'))) {
    return { kind: 'builder-config' }
  }

  return { kind: 'disabled', reason: 'no-feed-configured' }
}

export async function initAutoUpdates(env: AutoUpdateEnv): Promise<void> {
  const mode = resolveAutoUpdateMode(env)
  if (mode.kind === 'disabled') {
    return
  }

  const { autoUpdater } = await import('electron-updater')
  autoUpdater.on('error', (err) => {
    console.error('[auto-update] update failed', err)
  })

  if (mode.kind === 'feed-url') {
    autoUpdater.setFeedURL({ provider: 'generic', url: mode.url })
  }

  await autoUpdater.checkForUpdatesAndNotify()
}
