import { useEffect, useState } from 'react'
import type { WebContainer } from '@webcontainer/api'

type Node = { name: string; path: string; isDir: boolean; children?: Node[] }

const IGNORE = new Set(['node_modules', '.git', '.bcs'])

async function readTree(wc: WebContainer, dir: string): Promise<Node[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<{
      name: string
      isDirectory(): boolean
    }>
  } catch {
    return []
  }
  const nodes: Node[] = []
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    const path = dir === '/' ? `/${e.name}` : `${dir}/${e.name}`
    const isDir = e.isDirectory()
    nodes.push({
      name: e.name,
      path,
      isDir,
      children: isDir ? await readTree(wc, path) : undefined,
    })
  }
  nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return nodes
}

export function FileExplorer(props: {
  wc: WebContainer
  version: number
  openPath: string | null
  onOpen: (p: string) => void
  onRefresh: () => void
}) {
  const { wc, version, openPath } = props
  const [tree, setTree] = useState<Node[]>([])
  const root = wc.workdir || '/home/projects'

  useEffect(() => {
    let cancelled = false
    readTree(wc, root).then((t) => {
      if (!cancelled) setTree(t)
    })
    return () => {
      cancelled = true
    }
  }, [wc, root, version])

  return (
    <div className="explorer">
      <div className="explorer-head">
        <span>Files</span>
        <button onClick={props.onRefresh} title="Refresh">
          ↻
        </button>
      </div>
      <div className="tree">
        {tree.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} openPath={openPath} onOpen={props.onOpen} />
        ))}
      </div>
    </div>
  )
}

function TreeNode(props: {
  node: Node
  depth: number
  openPath: string | null
  onOpen: (p: string) => void
}) {
  const { node, depth, openPath } = props
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: 6 + depth * 12 }

  if (node.isDir) {
    return (
      <div>
        <div className="row dir" style={pad} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} {node.name}
        </div>
        {open &&
          node.children?.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              openPath={openPath}
              onOpen={props.onOpen}
            />
          ))}
      </div>
    )
  }
  return (
    <div
      className={'row file' + (openPath === node.path ? ' active' : '')}
      style={pad}
      onClick={() => props.onOpen(node.path)}
    >
      {node.name}
    </div>
  )
}
