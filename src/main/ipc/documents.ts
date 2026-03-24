import type { BrowserWindow } from 'electron'
import { DocumentManager } from '../services/document-manager'
import { FileService } from '../services/file-service'
import { typedHandle, typedSend } from '../typed-ipc'

const fileService = new FileService()
const documentManager = new DocumentManager(fileService)

export function getDocumentManager(): DocumentManager {
  return documentManager
}

export function registerDocumentIpc(mainWindow: BrowserWindow): void {
  // Wire document events to IPC broadcasts
  documentManager.onEvent((event) => {
    typedSend(mainWindow, `doc:${event.type}` as 'doc:external-change', event as never)
  })

  typedHandle('doc:open', async (args) => {
    return documentManager.open(args.path)
  })

  typedHandle('doc:close', async (args) => {
    await documentManager.close(args.path)
  })

  typedHandle('doc:update', (args) => {
    const version = documentManager.update(args.path, args.content)
    return { version }
  })

  typedHandle('doc:save', async (args) => {
    await documentManager.save(args.path)
  })

  typedHandle('doc:get-content', (args) => {
    return documentManager.getContent(args.path)
  })
}
