import { z } from 'zod'
import { ClusterDraftSchema } from './cluster-types'

export const CompiledArticleDraftSchema = z.object({
  kind: z.literal('compiled-article'),
  title: z.string().min(1),
  body: z.string(),
  origin: z.enum(['agent', 'human', 'source']),
  sources: z.array(z.string()).readonly(),
  suggestedFilename: z.string().optional(),
  tags: z.array(z.string()).readonly().optional(),
  frontmatterExtras: z.record(z.string(), z.unknown()).optional()
})

export const AgentArtifactDraftSchema = z.discriminatedUnion('kind', [
  CompiledArticleDraftSchema,
  ClusterDraftSchema
])

export type CompiledArticleDraft = z.infer<typeof CompiledArticleDraftSchema>
export type AgentArtifactDraft = z.infer<typeof AgentArtifactDraftSchema>

export interface MaterializeResult {
  readonly vaultRelativePath: string
  readonly absolutePath: string
  readonly artifactId: string
}
