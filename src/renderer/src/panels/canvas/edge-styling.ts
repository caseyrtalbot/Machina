export function getEdgeStrokeDasharray(kind: string | undefined): string | undefined {
  if (kind === 'imports') return '6 4'
  if (kind === 'references') return '2 4'
  if (kind === 'ontology') return '8 6'
  return undefined
}

export function getEdgeStrokeWidth(kind: string | undefined): number {
  if (kind === 'contains') return 1
  if (kind === 'ontology') return 1
  return 1.5
}
