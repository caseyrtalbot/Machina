import { ipcMain } from 'electron'
import Store from 'electron-store'

const appStore = new Store({ name: 'thought-engine-settings' })

export function registerConfigIpc(): void {
  ipcMain.handle('config:read', async (_e, args: { scope: string; key: string }) => {
    if (args.scope === 'app') return appStore.get(args.key, null)
    return null
  })
  ipcMain.handle(
    'config:write',
    async (_e, args: { scope: string; key: string; value: unknown }) => {
      if (args.scope === 'app') appStore.set(args.key, args.value)
    }
  )
}
