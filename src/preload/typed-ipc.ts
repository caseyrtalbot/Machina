import { ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcEvent,
  IpcEventData
} from '../shared/ipc-channels'

// The editor dock surface is a singleton (see dock-types.ts), so doc:* event
// listeners no longer scale with open note tabs. The remaining legitimate
// fan-out is canvas split editors (one useDocument per split-open card), which
// can exceed Node's default 10-listener warning heuristic in split-heavy
// sessions. Keep a modest cap as headroom; a count past 50 would still warn
// and would indicate a real leak or an unplanned fan-out (design a module-level
// fan-in subscription at that point instead of raising this further).
// Optional call: unit tests mock electron with a partial ipcRenderer.
ipcRenderer.setMaxListeners?.(50)

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
