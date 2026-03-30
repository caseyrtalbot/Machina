import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcEvent,
  IpcEventData
} from '@shared/ipc-channels'

export function typedHandle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(channel, (_event, args) => handler(args))
}

export function typedHandleWithEvent<C extends IpcChannel>(
  channel: C,
  handler: (
    request: IpcRequest<C>,
    event: IpcMainInvokeEvent
  ) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(channel, (event, args) => handler(args, event))
}

export function typedSend<E extends IpcEvent>(
  window: BrowserWindow,
  event: E,
  data: IpcEventData<E>
): void {
  if (!window.isDestroyed()) {
    window.webContents.send(event, data)
  }
}
