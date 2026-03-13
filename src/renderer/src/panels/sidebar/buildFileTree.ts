export interface FlatTreeNode {
  name: string
  path: string
  parentPath: string
  isDirectory: boolean
  depth: number
  itemCount: number
}

interface DirEntry {
  name: string
  path: string
  parentPath: string
  depth: number
}

interface FileEntry {
  name: string
  path: string
  parentPath: string
  depth: number
}

export function buildFileTree(filePaths: string[], vaultRoot: string): FlatTreeNode[] {
  if (filePaths.length === 0) {
    return []
  }

  // Normalize vault root: strip trailing slash for consistent prefix stripping
  const root = vaultRoot.endsWith('/') ? vaultRoot.slice(0, -1) : vaultRoot

  // Collect phase: register all directories and files
  const dirs = new Map<string, DirEntry>()
  const files: FileEntry[] = []

  for (const filePath of filePaths) {
    // Strip vault root prefix to get relative path segments
    const relative = filePath.startsWith(root + '/') ? filePath.slice(root.length + 1) : filePath
    const segments = relative.split('/')

    // Register intermediate directories
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      const dirPath = root + '/' + segments.slice(0, i + 1).join('/')
      const parentPath = i === 0 ? root : root + '/' + segments.slice(0, i).join('/')

      if (!dirs.has(dirPath)) {
        dirs.set(dirPath, {
          name: segment,
          path: dirPath,
          parentPath,
          depth: i
        })
      }
    }

    // Register file
    const fileName = segments[segments.length - 1]
    const depth = segments.length - 1
    const fileParentPath =
      segments.length === 1 ? root : root + '/' + segments.slice(0, -1).join('/')

    files.push({
      name: fileName,
      path: filePath,
      parentPath: fileParentPath,
      depth
    })
  }

  // Count phase: count direct file children per directory path
  const itemCounts = new Map<string, number>()
  for (const file of files) {
    const count = itemCounts.get(file.parentPath) ?? 0
    itemCounts.set(file.parentPath, count + 1)
  }

  // Emit phase: depth-first, dirs before files, sorted alphabetically within groups
  const result: FlatTreeNode[] = []

  function emitChildren(parentPath: string): void {
    // Collect child dirs at this parent
    const childDirs = [...dirs.values()]
      .filter((d) => d.parentPath === parentPath)
      .sort((a, b) => a.name.localeCompare(b.name))

    // Collect child files at this parent
    const childFiles = files
      .filter((f) => f.parentPath === parentPath)
      .sort((a, b) => a.name.localeCompare(b.name))

    // Emit dirs first (each followed by recursive children), then files
    for (const dir of childDirs) {
      result.push({
        name: dir.name,
        path: dir.path,
        parentPath: dir.parentPath,
        isDirectory: true,
        depth: dir.depth,
        itemCount: itemCounts.get(dir.path) ?? 0
      })
      emitChildren(dir.path)
    }

    for (const file of childFiles) {
      result.push({
        name: file.name,
        path: file.path,
        parentPath: file.parentPath,
        isDirectory: false,
        depth: file.depth,
        itemCount: 0
      })
    }
  }

  emitChildren(root)

  return result
}
