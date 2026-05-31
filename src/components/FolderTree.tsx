import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { readDirectory } from '@/lib/platform'
import type { TreeNode } from '@/types/fs'

interface FolderTreeProps {
  rootPath: string
  selectedPath: string | null
  onSelect: (path: string) => void
  showHidden?: boolean
}

async function loadChildren(node: TreeNode, showHidden: boolean): Promise<TreeNode[]> {
  const raw = await readDirectory(node.path)
  return raw
    .filter((e) => e.name != null && e.isDirectory)
    .filter((e) => showHidden || !e.name!.startsWith('.'))
    .map((e) => ({
      name: e.name!,
      path: `${node.path}/${e.name}`,
      isDir: true,
      isSymlink: e.isSymlink ?? false,
      modifiedAt: null,
      children: null,
      expanded: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildRootNode(rootPath: string): TreeNode {
  const parts = rootPath.replace(/\\/g, '/').split('/')
  return {
    name: parts[parts.length - 1] || rootPath,
    path: rootPath,
    isDir: true,
    isSymlink: false,
    modifiedAt: null,
    children: null,
    expanded: false,
  }
}

interface NodeProps {
  node: TreeNode
  depth: number
  selectedPath: string | null
  showHidden: boolean
  onSelect: (path: string) => void
  onUpdate: (path: string, updates: Partial<TreeNode>) => void
}

function FolderTreeNode({ node, depth, selectedPath, showHidden, onSelect, onUpdate }: NodeProps) {
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isSelected = selectedPath === node.path

  const expand = useCallback(async () => {
    if (node.children !== null) {
      onUpdate(node.path, { expanded: !node.expanded })
      return
    }
    setLoading(true)
    try {
      const children = await loadChildren(node, showHidden)
      onUpdate(node.path, { children, expanded: true })
    } catch {
      onUpdate(node.path, { children: [], expanded: true })
    } finally {
      setLoading(false)
    }
  }, [node, showHidden, onUpdate])

  const handleClick = useCallback(() => {
    onSelect(node.path)
    expand()
  }, [node.path, onSelect, expand])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(node.path)
        expand()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (!node.expanded) expand()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (node.expanded) onUpdate(node.path, { expanded: false })
      }
    },
    [node, onSelect, expand, onUpdate]
  )

  return (
    <div>
      <div
        ref={ref}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-expanded={node.expanded}
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-sm outline-none select-none',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:ring-1 focus-visible:ring-ring',
          isSelected && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="shrink-0 size-4 flex items-center justify-center">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : node.expanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </span>
        {node.expanded ? (
          <FolderOpen className="size-4 shrink-0 text-blue-400" />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.expanded && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              showHidden={showHidden}
              onSelect={onSelect}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree({
  rootPath,
  selectedPath,
  onSelect,
  showHidden = false,
}: FolderTreeProps) {
  const [root, setRoot] = useState<TreeNode>(() => buildRootNode(rootPath))

  useEffect(() => {
    const newRoot = buildRootNode(rootPath)
    loadChildren(newRoot, showHidden)
      .then((children) => {
        setRoot({ ...newRoot, children, expanded: true })
      })
      .catch(() => {
        setRoot({ ...newRoot, children: [], expanded: true })
      })
  }, [rootPath, showHidden])

  const updateNode = useCallback((path: string, updates: Partial<TreeNode>) => {
    setRoot((prev) => updateNodeInTree(prev, path, updates))
  }, [])

  return (
    <ScrollArea className="h-full">
      <div role="tree" className="py-2 pr-2" aria-label="Folder tree">
        <FolderTreeNode
          node={root}
          depth={0}
          selectedPath={selectedPath}
          showHidden={showHidden}
          onSelect={onSelect}
          onUpdate={updateNode}
        />
      </div>
    </ScrollArea>
  )
}

function updateNodeInTree(node: TreeNode, path: string, updates: Partial<TreeNode>): TreeNode {
  if (node.path === path) return { ...node, ...updates }
  if (!node.children) return node
  return {
    ...node,
    children: node.children.map((child) => updateNodeInTree(child, path, updates)),
  }
}
