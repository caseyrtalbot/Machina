import { z } from 'zod'

export const ClusterSectionSchema = z.object({
  cardId: z.string().min(1),
  heading: z.string().min(1),
  body: z.string()
})

export type ClusterSection = z.infer<typeof ClusterSectionSchema>

/** Serialized form carried in file frontmatter: cardId -> current heading text. */
export type SectionMap = Readonly<Record<string, string>>
