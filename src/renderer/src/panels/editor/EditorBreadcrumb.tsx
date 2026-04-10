interface BreadcrumbSegment {
  readonly name: string
  readonly path: string
  readonly isFile: boolean
}

export function parseBreadcrumb(filePath: string, vaultPath: string): readonly BreadcrumbSegment[] {
  const relative = filePath.startsWith(vaultPath)
    ? filePath.slice(vaultPath.length).replace(/^\//, '')
    : filePath

  const parts = relative.split('/').filter(Boolean)

  return parts.map((part, index): BreadcrumbSegment => {
    const isLast = index === parts.length - 1
    const builtPath = parts.slice(0, index + 1).join('/')
    return {
      name: isLast ? part.replace(/\.md$/, '') : part,
      path: builtPath,
      isFile: isLast && part.endsWith('.md')
    }
  })
}
