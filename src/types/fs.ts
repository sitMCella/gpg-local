export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  modifiedAt: number | null
}

export interface TreeNode extends FsEntry {
  children: TreeNode[] | null
  expanded: boolean
}
