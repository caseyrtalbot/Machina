import { createWorkerController } from './vault-worker-helpers'
import type { WorkerInMessage } from './vault-worker-helpers'

const controller = createWorkerController((msg) => self.postMessage(msg))

self.onmessage = (e: MessageEvent<WorkerInMessage>): void => {
  controller.handleMessage(e.data)
}
