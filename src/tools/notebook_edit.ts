import type { Tool } from './types.js'

const DESCRIPTION = `Edits a cell in a Jupyter notebook (.ipynb file).

- \`cell_id\` is the 0-indexed cell position.
- edit_mode=replace (default): completely replaces the source of the cell at cell_id.
- edit_mode=insert: inserts a new cell at index cell_id (use cell_type to choose code/markdown).
- edit_mode=delete: removes the cell at cell_id.
- New code cells are created with empty outputs and a null execution_count.`

interface NotebookCell {
  cell_type: string
  source: string | string[]
  metadata?: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
  id?: string
}

interface Notebook {
  cells: NotebookCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
  [k: string]: unknown
}

/** Store source as an array of newline-terminated lines (the canonical .ipynb form). */
function toSourceLines(text: string): string[] {
  const parts = text.split('\n')
  return parts.map((line, i) => (i < parts.length - 1 ? line + '\n' : line))
}

export const notebookEdit: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'notebook_edit',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the .ipynb notebook.' },
          cell_id: {
            type: ['number', 'string'],
            description: '0-indexed cell position to edit/insert/delete.',
          },
          new_source: {
            type: 'string',
            description: 'New cell source (ignored for delete).',
          },
          cell_type: {
            type: 'string',
            enum: ['code', 'markdown'],
            description: 'Cell type for replace/insert. Defaults to code.',
          },
          edit_mode: {
            type: 'string',
            enum: ['replace', 'insert', 'delete'],
            description: 'Operation to perform. Defaults to replace.',
          },
        },
        required: ['path', 'new_source'],
      },
    },
  },
  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }

    const editMode = (input.edit_mode as string) ?? 'replace'
    if (!['replace', 'insert', 'delete'].includes(editMode)) {
      return { content: `Error: invalid edit_mode "${editMode}".`, isError: true }
    }

    const raw = await ctx.fs.readFile(path)
    if (raw === null) return { content: `Error: file not found: ${path}`, isError: true }

    let nb: Notebook
    try {
      nb = JSON.parse(raw)
    } catch (err) {
      return { content: `Error: ${path} is not valid JSON: ${(err as Error).message}`, isError: true }
    }
    if (!nb || !Array.isArray(nb.cells)) {
      return { content: `Error: ${path} is not a valid notebook (missing cells array).`, isError: true }
    }

    const index = Number(input.cell_id ?? 0)
    if (!Number.isInteger(index) || index < 0) {
      return { content: `Error: cell_id must be a non-negative integer.`, isError: true }
    }

    const newSource = typeof input.new_source === 'string' ? input.new_source : ''
    const cellType = (input.cell_type as string) ?? 'code'

    if (editMode === 'delete') {
      if (index >= nb.cells.length) {
        return { content: `Error: cell index ${index} out of range (notebook has ${nb.cells.length} cells).`, isError: true }
      }
      nb.cells.splice(index, 1)
    } else if (editMode === 'insert') {
      if (index > nb.cells.length) {
        return { content: `Error: insert index ${index} out of range (notebook has ${nb.cells.length} cells).`, isError: true }
      }
      const cell: NotebookCell = {
        cell_type: cellType,
        metadata: {},
        source: toSourceLines(newSource),
      }
      if (cellType === 'code') {
        cell.outputs = []
        cell.execution_count = null
      }
      nb.cells.splice(index, 0, cell)
    } else {
      // replace
      if (index >= nb.cells.length) {
        return { content: `Error: cell index ${index} out of range (notebook has ${nb.cells.length} cells).`, isError: true }
      }
      const cell = nb.cells[index]
      cell.source = toSourceLines(newSource)
      if (input.cell_type) {
        cell.cell_type = cellType
        if (cellType === 'code' && cell.outputs === undefined) {
          cell.outputs = []
          cell.execution_count = null
        }
      }
    }

    try {
      await ctx.fs.writeFile(path, JSON.stringify(nb, null, 2))
    } catch (err) {
      return { content: `Error writing ${path}: ${(err as Error).message}`, isError: true }
    }

    const verb = editMode === 'delete' ? 'Deleted' : editMode === 'insert' ? 'Inserted' : 'Replaced'
    return { content: `${verb} cell ${index} in ${path}. Notebook now has ${nb.cells.length} cells.` }
  },
}
