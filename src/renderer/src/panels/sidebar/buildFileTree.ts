export type TreeSortMode = 'modified' | 'modified-asc' | 'name' | 'name-desc' | 'type'

interface TreeFileEntry {
  readonly path: string
  readonly modified: string
}

type TreeFileInput = string | TreeFileEntry

export interface FlatTreeNode {
  name: string
  path: string
  parentPath: string
  isDirectory: boolean
  depth: number
  itemCount: number
  modified: string
}

interface IndexedTreeNode extends FlatTreeNode {
  readonly modified: string
  readonly sortType: string
}

interface FileTreeIndex {
  readonly root: string
  readonly nodesByPath: ReadonlyMap<string, IndexedTreeNode>
  readonly childPathsByParent: ReadonlyMap<string, readonly string[]>
}

interface BuildFileTreeOptions {
  readonly sortMode?: TreeSortMode
  readonly getSortType?: (path: string) => string
}

function normalizeRoot(vaultRoot: string): string {
  return vaultRoot.endsWith('/') ? vaultRoot.slice(0, -1) : vaultRoot
}

function defaultSortType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext && ext !== path ? ext : 'file'
}

function ensureChild(
  childPathsByParent: Map<string, string[]>,
  parentPath: string,
  path: string
): void {
  const children = childPathsByParent.get(parentPath)
  if (children) {
    if (!children.includes(path)) children.push(path)
    return
  }
  childPathsByParent.set(parentPath, [path])
}

function compareNodes(a: IndexedTreeNode, b: IndexedTreeNode, sortMode: TreeSortMode): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

  if (a.isDirectory && b.isDirectory) {
    return a.name.localeCompare(b.name)
  }

  if (sortMode === 'modified') {
    return b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name)
  }

  if (sortMode === 'modified-asc') {
    return a.modified.localeCompare(b.modified) || a.name.localeCompare(b.name)
  }

  if (sortMode === 'type') {
    return a.sortType.localeCompare(b.sortType) || a.name.localeCompare(b.name)
  }

  if (sortMode === 'name-desc') {
    return b.name.localeCompare(a.name)
  }

  return a.name.localeCompare(b.name)
}

function normalizeFileEntry(fileEntry: TreeFileInput): TreeFileEntry {
  return typeof fileEntry === 'string' ? { path: fileEntry, modified: '' } : fileEntry
}

export function buildFileTreeIndex(
  fileEntries: readonly TreeFileInput[],
  vaultRoot: string,
  getSortType: (path: string) => string = defaultSortType
): FileTreeIndex {
  const root = normalizeRoot(vaultRoot)
  const childPathsByParent = new Map<string, string[]>()
  const nodesByPath = new Map<string, IndexedTreeNode>()

  for (const rawFileEntry of fileEntries) {
    const fileEntry = normalizeFileEntry(rawFileEntry)
    const relative = fileEntry.path.startsWith(root + '/')
      ? fileEntry.path.slice(root.length + 1)
      : fileEntry.path
    const segments = relative.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let parentPath = root

    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]
      const dirPath = `${parentPath}/${name}`
      if (!nodesByPath.has(dirPath)) {
        nodesByPath.set(dirPath, {
          name,
          path: dirPath,
          parentPath,
          isDirectory: true,
          depth: i,
          itemCount: 0,
          modified: '',
          sortType: 'directory'
        })
      }
      ensureChild(childPathsByParent, parentPath, dirPath)
      parentPath = dirPath
    }

    const name = segments[segments.length - 1]
    const filePath = fileEntry.path
    const existing = nodesByPath.get(filePath)

    nodesByPath.set(filePath, {
      name,
      path: filePath,
      parentPath,
      isDirectory: false,
      depth: segments.length - 1,
      itemCount: 0,
      modified: fileEntry.modified,
      sortType: getSortType(filePath)
    })

    if (!existing) {
      ensureChild(childPathsByParent, parentPath, filePath)
      const parentNode = nodesByPath.get(parentPath)
      if (parentNode) {
        nodesByPath.set(parentPath, { ...parentNode, itemCount: parentNode.itemCount + 1 })
      }
    }
  }

  for (const children of childPathsByParent.values()) {
    children.sort((left, right) => {
      const leftNode = nodesByPath.get(left)
      const rightNode = nodesByPath.get(right)
      if (!leftNode || !rightNode) return 0
      return compareNodes(leftNode, rightNode, 'name')
    })
  }

  return { root, childPathsByParent, nodesByPath }
}

export function buildFileTree(
  fileEntries: readonly TreeFileInput[],
  vaultRoot: string,
  options: BuildFileTreeOptions = {}
): FlatTreeNode[] {
  if (fileEntries.length === 0) {
    return []
  }

  const index = buildFileTreeIndex(fileEntries, vaultRoot, options.getSortType)
  const sortMode = options.sortMode ?? 'name'
  const result: FlatTreeNode[] = []
  const nodesByPath = index.nodesByPath

  function emitChildren(parentPath: string): void {
    const childPaths = [...(index.childPathsByParent.get(parentPath) ?? [])]
    childPaths.sort((left, right) => {
      const leftNode = nodesByPath.get(left)
      const rightNode = nodesByPath.get(right)
      if (!leftNode || !rightNode) return 0
      return compareNodes(leftNode, rightNode, sortMode)
    })

    for (const childPath of childPaths) {
      const node = nodesByPath.get(childPath)
      if (!node) continue

      result.push({
        name: node.name,
        path: node.path,
        parentPath: node.parentPath,
        isDirectory: node.isDirectory,
        depth: node.depth,
        itemCount: node.itemCount,
        modified: node.modified
      })

      if (node.isDirectory) {
        emitChildren(node.path)
      }
    }
  }

  emitChildren(index.root)
  return result
}
