import { ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcEvent,
  IpcEventData
} from '../shared/ipc-channels'

// Under the KeepAlive panel architecture, each open tab keeps its editor (and its
// per-path event subscriptions) mounted, so listeners on channels like
// `doc:external-change` scale with the number of open tabs. These listeners are
// legitimate and torn down on unmount, but they trip Node's default 10-listener
// warning heuristic. Raise the cap to give headroom while still catching a real
// runaway (unbounded) leak.
ipcRenderer.setMaxListeners(50)

export function typedInvoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcRequest<C> extends void ? [] : [request: IpcRequest<C>]
): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResponse<C>>
}

export function typedOn<E extends IpcEvent>(
  event: E,
  callback: (data: IpcEventData<E>) => void
): () => void {
  const handler = (_e: Electron.IpcRendererEvent, data: IpcEventData<E>): void => callback(data)
  ipcRenderer.on(event, handler)
  return () => ipcRenderer.removeListener(event, handler)
}
