import { useEffect, useState } from 'react'

export interface FileEntry {
  name: string
  isDir: boolean
}

export interface FileExplorerProps {
  /** List a directory's immediate children. Adapt any FS (WebContainer, SDK FileSystem, …). */
  list: (dir: string) => Promise<FileEntry[]>
  /** Root directory to show. Default '/'. */
  root?: string
  /** Currently-open file path (highlighted). */
  openPath?: string | null
  onOpen: (path: string) => void
  /** Bump to force a re-read (e.g. after the agent writes files). */
  refreshKey?: number
  className?: string
  title?: string
  /** Directory names to skip. Default: node_modules, .git, .bcs. */
  ignore?: string[]
}

type Node = FileEntry & { path: string }

/** A collapsible file tree over any filesystem (provide a `list(dir)` adapter). */
export function FileExplorer({ list, root = '/', openPath, onOpen, refreshKey = 0, className, title = 'Files', ignore }: FileExplorerProps) {
  const [nodes, setNodes] = useState<Node[]>([])
  const ignoreSet = new Set(ignore ?? ['node_modules', '.git', '.bcs'])

  useEffect(() => {
    let cancelled = false
    list(root)
      .then((entries) => {
        if (cancelled) return
        const mapped = entries
          .filter((e) => !ignoreSet.has(e.name))
          .map((e) => ({ ...e, path: root === '/' ? `/${e.name}` : `${root}/${e.name}` }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
        setNodes(mapped)
      })
      .catch(() => setNodes([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, refreshKey])

  return (
    <div className={`ac-explorer${className ? ' ' + className : ''}`}>
      <div className="ac-explorer-head">{title}</div>
      <div className="ac-tree">
        {nodes.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} list={list} openPath={openPath ?? null} onOpen={onOpen} ignore={ignoreSet} refreshKey={refreshKey} />
        ))}
      </div>
    </div>
  )
}

function TreeNode({ node, depth, list, openPath, onOpen, ignore, refreshKey }: { node: Node; depth: number; list: (d: string) => Promise<FileEntry[]>; openPath: string | null; onOpen: (p: string) => void; ignore: Set<string>; refreshKey: number }) {
  const [open, setOpen] = useState(depth < 1)
  const [children, setChildren] = useState<Node[] | null>(null)
  const pad = { paddingLeft: 6 + depth * 12 }

  useEffect(() => {
    if (!node.isDir || !open) return
    let cancelled = false
    list(node.path)
      .then((entries) => {
        if (cancelled) return
        setChildren(
          entries
            .filter((e) => !ignore.has(e.name))
            .map((e) => ({ ...e, path: `${node.path}/${e.name}` }))
            .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
        )
      })
      .catch(() => setChildren([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node.path, refreshKey])

  if (node.isDir) {
    return (
      <div>
        <div className="ac-tree-row ac-dir" style={pad} onClick={() => setOpen((o) => !o)}>
          <span className="ac-tree-caret">{open ? '▾' : '▸'}</span> {node.name}
        </div>
        {open && children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} list={list} openPath={openPath} onOpen={onOpen} ignore={ignore} refreshKey={refreshKey} />)}
      </div>
    )
  }
  return (
    <div className={'ac-tree-row ac-file' + (openPath === node.path ? ' ac-active' : '')} style={pad} onClick={() => onOpen(node.path)}>
      {node.name}
    </div>
  )
}
