import type { ContentBlockParam, DocumentBlock, ImageBlock, TextBlock } from '../types/index.js'
import type { FileReadLimits, Tool, ToolContext } from './types.js'
import {
  DEFAULT_FILE_READ_LIMITS,
  bytesToBase64,
  detectImageFormatFromBytes,
  extOf,
  formatBytes,
  hasBinaryExtension,
  imageMediaType,
  isImageExtension,
  isNotebookExtension,
  isPdfExtension,
  looksBinary,
  roughTokenCount,
} from './fileTypes.js'
import { processImage } from './imageProcessor.js'

const DESCRIPTION = `Reads a file from the workspace filesystem.

- \`path\` may be absolute or relative to the workspace root.
- Text files are returned with line numbers (cat -n style). Use \`offset\`/\`limit\` (1-based lines) to read a slice of large files.
- Image files (png/jpg/jpeg/gif/webp/bmp) are returned as a viewable image block, downsampled if large.
- PDF files are returned as a document block for the model to read directly.
- Jupyter notebooks (.ipynb) are rendered as cells with their outputs.
- Reads are capped by size and token count; very large text files must be read with offset/limit or searched with grep.`

const PARAMS = {
  type: 'object' as const,
  properties: {
    path: { type: 'string', description: 'Path to the file to read.' },
    offset: { type: 'number', description: 'Line number to start reading from (1-based, text files).' },
    limit: { type: 'number', description: 'Maximum number of lines to read (text files).' },
    pages: { type: 'string', description: 'PDF page range hint, e.g. "1-5,8" (informational only).' },
  },
  required: ['path'],
}

function limitsOf(ctx: ToolContext): FileReadLimits {
  return { ...DEFAULT_FILE_READ_LIMITS, ...(ctx.limits ?? {}) }
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}

const NOT_FOUND = (path: string): string =>
  `Error: file not found: ${path}. Check the path is correct and relative to the workspace root, or use list_files/glob to locate it.`

// ---------------------------------------------------------------------------
// Notebook rendering
// ---------------------------------------------------------------------------

interface NotebookCell {
  cell_type?: string
  source?: string | string[]
  outputs?: NotebookOutput[]
}
interface NotebookOutput {
  output_type?: string
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
}

const CELL_OUTPUT_CAP = 10_000

function joinSource(src: string | string[] | undefined): string {
  if (!src) return ''
  return Array.isArray(src) ? src.join('') : src
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? text.slice(0, cap) + `\n… [output truncated, ${text.length - cap} more chars]` : text
}

function renderOutput(out: NotebookOutput): string {
  switch (out.output_type) {
    case 'stream':
      return truncate(joinSource(out.text), CELL_OUTPUT_CAP)
    case 'execute_result':
    case 'display_data': {
      const text = joinSource(out.data?.['text/plain'] as string | string[] | undefined)
      const hasImg =
        typeof out.data?.['image/png'] === 'string' || typeof out.data?.['image/jpeg'] === 'string'
      const parts = [text ? truncate(text, CELL_OUTPUT_CAP) : '', hasImg ? '[image output]' : '']
      return parts.filter(Boolean).join('\n')
    }
    case 'error':
      return truncate(`${out.ename ?? 'Error'}: ${out.evalue ?? ''}\n${(out.traceback ?? []).join('\n')}`, CELL_OUTPUT_CAP)
    default:
      return ''
  }
}

function renderNotebook(text: string): string {
  let nb: { cells?: NotebookCell[] }
  try {
    nb = JSON.parse(text)
  } catch {
    return 'Error: notebook is not valid JSON.'
  }
  const cells = nb.cells ?? []
  const out: string[] = []
  cells.forEach((cell, i) => {
    const kind = cell.cell_type ?? 'unknown'
    out.push(`#%% [cell ${i + 1}] (${kind})`)
    const source = joinSource(cell.source)
    if (source) out.push(source)
    if (kind === 'code' && cell.outputs?.length) {
      const rendered = cell.outputs.map(renderOutput).filter(Boolean).join('\n')
      if (rendered) out.push('# --- output ---\n' + rendered)
    }
    out.push('')
  })
  return out.join('\n').trimEnd() || '(empty notebook)'
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const readFile: Tool = {
  def: { type: 'function', function: { name: 'read_file', description: DESCRIPTION, parameters: PARAMS } },
  // read_file is already self-bounded by size/token caps; never spill its
  // output to a file (that would be circular — the model reads files with this).
  maxResultChars: Infinity,

  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }
    const limits = limitsOf(ctx)
    const ext = extOf(path)
    const name = baseName(path)

    // ---- Image ----
    if (isImageExtension(path)) {
      const bytes = await ctx.fs.readBinary(path)
      if (!bytes) return { content: NOT_FOUND(path), isError: true }
      ctx.readFiles.add(path)
      const media = detectImageFormatFromBytes(bytes) ?? imageMediaType(ext)
      const img = await processImage(bytes, media, limits.maxImageBytes)
      const dims = img.width && img.height ? `${img.width}x${img.height}, ` : ''
      const meta = `Image: ${name} (${dims}${formatBytes(bytes.length)}${img.media_type !== media ? `, re-encoded as ${img.media_type}` : ''}).${img.note ? ' ' + img.note : ''}`
      const blocks: ContentBlockParam[] = [
        { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } } as ImageBlock,
        { type: 'text', text: meta } as TextBlock,
      ]
      return { content: blocks }
    }

    // ---- PDF ----
    if (isPdfExtension(path)) {
      const bytes = await ctx.fs.readBinary(path)
      if (!bytes) return { content: NOT_FOUND(path), isError: true }
      ctx.readFiles.add(path)
      const large = bytes.length > 3 * 1024 * 1024
      const pagesNote = typeof input.pages === 'string' && input.pages.trim()
        ? ` Requested pages "${input.pages}" — page-range extraction is not performed client-side; the full document is provided.`
        : ''
      const doc: DocumentBlock = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: bytesToBase64(bytes) },
        title: name,
      }
      const note: TextBlock = {
        type: 'text',
        text: `PDF: ${name} (${formatBytes(bytes.length)}).${large ? ' Large file.' : ''}${pagesNote} The full document is attached for the model to read.`,
      }
      return { content: [doc, note] }
    }

    // ---- Notebook ----
    if (isNotebookExtension(path)) {
      const text = await ctx.fs.readFile(path)
      if (text === null) return { content: NOT_FOUND(path), isError: true }
      ctx.readFiles.add(path)
      return { content: renderNotebook(text) }
    }

    // ---- Binary by extension ----
    if (hasBinaryExtension(path)) {
      return {
        content: `Error: cannot read binary file ${name} (${ext || 'unknown type'}) as text. Use the bash tool or a dedicated tool if you need its contents.`,
        isError: true,
      }
    }

    // ---- Text (with binary sniff) ----
    const bytes = await ctx.fs.readBinary(path)
    if (bytes === null) return { content: NOT_FOUND(path), isError: true }

    if (looksBinary(bytes)) {
      return {
        content: `Error: ${name} appears to be a binary file (contains NUL bytes) and cannot be read as text. Use the bash tool if needed.`,
        isError: true,
      }
    }

    if (bytes.length > limits.maxSizeBytes) {
      return {
        content: `Error: file ${name} is ${formatBytes(bytes.length)}, exceeding the ${formatBytes(limits.maxSizeBytes)} read limit. Read a slice with offset/limit, or search with grep instead of reading the whole file.`,
        isError: true,
      }
    }

    const text = await ctx.fs.readFile(path)
    if (text === null) return { content: NOT_FOUND(path), isError: true }
    ctx.readFiles.add(path)
    if (text === '') return { content: '(file is empty)' }

    const lines = text.split('\n')
    const offset = typeof input.offset === 'number' && input.offset > 0 ? Math.floor(input.offset) : 1
    const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.floor(input.limit) : lines.length
    const start = offset - 1
    const slice = lines.slice(start, start + limit)

    // cat -n style: right-aligned line number, tab, content.
    const lastNum = start + slice.length
    const width = String(lastNum).length
    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(width, ' ')}\t${line}`)
      .join('\n')

    const tokens = roughTokenCount(numbered)
    if (tokens > limits.maxTokens) {
      return {
        content: `Error: the requested content is ~${tokens} tokens, exceeding the ${limits.maxTokens}-token cap. Narrow the read with offset/limit, or search with grep.`,
        isError: true,
      }
    }

    const shownEnd = start + slice.length
    const note =
      shownEnd < lines.length || start > 0
        ? `\n\n[showing lines ${offset}-${shownEnd} of ${lines.length}]`
        : ''
    return { content: numbered + note }
  },
}
