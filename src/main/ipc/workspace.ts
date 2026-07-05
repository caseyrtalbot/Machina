import { typedHandle } from '../typed-ipc'
import { getWorkspaceService } from '../services/workspace-service'

export function registerWorkspaceIpc(): void {
  typedHandle('workspace:open', async (args) => {
    return getWorkspaceService().open(args.path)
  })

  typedHandle('workspace:current', async () => {
    return getWorkspaceService().current()
  })
}
