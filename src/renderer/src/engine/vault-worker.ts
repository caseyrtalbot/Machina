import { createWorkerHelpers } from './vault-worker-helpers'

type WorkerInMessage =
  | { type: 'load'; files: Array<{ path: string; content: string }> }
  | { type: 'update'; path: string; content: string }
  | { type: 'remove'; path: string }

const { addFile, removeFile, buildResult, clearAll } = createWorkerHelpers()

function postResult(msgType: 'loaded' | 'updated'): void {
  self.postMessage({ type: msgType, ...buildResult() })
}

self.onmessage = (e: MessageEvent<WorkerInMessage>): void => {
  const msg = e.data
  switch (msg.type) {
    case 'load':
      clearAll()
      for (const file of msg.files) addFile(file.path, file.content)
      postResult('loaded')
      break
    case 'update':
      removeFile(msg.path)
      addFile(msg.path, msg.content)
      postResult('updated')
      break
    case 'remove':
      removeFile(msg.path)
      postResult('updated')
      break
  }
}
