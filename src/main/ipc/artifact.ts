import { typedHandle } from '../typed-ipc'
import { ArtifactMaterializer } from '../services/artifact-materializer'
import { getDocumentManager } from './documents'
import { AgentArtifactDraftSchema, type AgentArtifactDraft } from '@shared/agent-artifact-types'
import { readVaultConfig } from '../utils/vault-config'

let materializer: ArtifactMaterializer | null = null

function getMaterializer(): ArtifactMaterializer {
  if (!materializer) {
    const docManager = getDocumentManager()
    materializer = new ArtifactMaterializer({
      registerExternalWrite: (path) => docManager.registerExternalWrite(path)
    })
  }
  return materializer
}

async function readOutputDir(vaultPath: string, kind: AgentArtifactDraft['kind']): Promise<string> {
  const config = await readVaultConfig(vaultPath)
  if (kind === 'cluster') return config?.cluster?.outputDir ?? 'clusters/'
  return config?.compile?.outputDir ?? 'compiled/'
}

export function registerArtifactIpc(): void {
  typedHandle('artifact:materialize', async (args) => {
    const draft = AgentArtifactDraftSchema.parse(args.draft)
    const mat = getMaterializer()
    const outputDir = await readOutputDir(args.vaultPath, draft.kind)
    return mat.materialize(draft, args.vaultPath, outputDir)
  })

  typedHandle('artifact:unmaterialize', async (args) => {
    const mat = getMaterializer()
    await mat.unmaterialize(args.paths)
  })
}
