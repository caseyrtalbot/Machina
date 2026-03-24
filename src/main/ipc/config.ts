import StoreModule from 'electron-store'
import { typedHandle } from '../typed-ipc'

// electron-store v11+ is ESM-only; when bundled as CJS the default
// export lands on .default.  Handle both cases for safety.
const Store = (StoreModule as { default?: typeof StoreModule }).default ?? StoreModule
const appStore = new Store({ name: 'machina-settings' })

export function registerConfigIpc(): void {
  typedHandle('config:read', async (args) => {
    if (args.scope === 'app') return appStore.get(args.key, null)
    return null
  })

  typedHandle('config:write', async (args) => {
    if (args.scope === 'app') appStore.set(args.key, args.value)
  })
}
