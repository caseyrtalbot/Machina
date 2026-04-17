import { z } from 'zod'

export const ClusterSectionSchema = z.object({
  cardId: z.string().min(1),
  heading: z.string().min(1),
  body: z.string()
})

export const ClusterDraftSchema = z
  .object({
    kind: z.literal('cluster'),
    title: z.string().min(1),
    prompt: z.string(),
    origin: z.enum(['agent', 'human', 'source']),
    sources: z.array(z.string()).readonly(),
    sections: z.array(ClusterSectionSchema).min(2),
    tags: z.array(z.string()).readonly().optional(),
    suggestedFilename: z.string().optional()
  })
  .refine((d) => new Set(d.sections.map((s) => s.cardId)).size === d.sections.length, {
    message: 'cluster sections must have unique cardIds'
  })

export type ClusterSection = z.infer<typeof ClusterSectionSchema>
export type ClusterDraft = z.infer<typeof ClusterDraftSchema>

/** Serialized form carried in file frontmatter: cardId -> current heading text. */
export type SectionMap = Readonly<Record<string, string>>
