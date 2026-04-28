import { readFile } from 'fs/promises'
import { typedHandle } from '../typed-ipc'
import { ArtifactMaterializer } from '../services/artifact-materializer'
import { getDocumentManager } from './documents'
import { AgentArtifactDraftSchema, type AgentArtifactDraft } from '@shared/agent-artifact-types'
import { teConfigPath } from '../utils/paths'
import type { VaultConfig } from '@shared/types'

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
  try {
    const configPath = teConfigPath(vaultPath)
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as VaultConfig
    if (kind === 'cluster') return config.cluster?.outputDir ?? 'clusters/'
    return config.compile?.outputDir ?? 'compiled/'
  } catch {
    return kind === 'cluster' ? 'clusters/' : 'compiled/'
  }
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
