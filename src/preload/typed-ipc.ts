import { ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcEvent,
  IpcEventData
} from '../shared/ipc-channels'

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
