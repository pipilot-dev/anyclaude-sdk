import type { Tool } from './types.js'

const DESCRIPTION = `Searches the web and returns the top results (title, URL, snippet).

- Takes a \`query\` and an optional \`num_results\` (default 5).
- Powered by the Jina Reader over DuckDuckGo's HTML endpoint, so it works in the
  browser without CORS issues and returns clean, parseable results.
- Use this to find pages; follow up with \`web_fetch\` to read a specific result.`

/** Jina Reader prefix — renders a target URL to clean Markdown. */
const JINA_READER = 'https://r.jina.ai/'
/** DuckDuckGo's no-JS HTML results endpoint. */
const DDG_HTML = 'https://html.duckduckgo.com/html/?q='

const DEFAULT_RESULTS = 5
const MAX_RESULTS = 20

export type SearchResult = { title: string; url: string; snippet: string }

export const webSearch: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'web_search',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
          num_results: {
            type: 'number',
            description: `How many results to return (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS}).`,
          },
        },
        required: ['query'],
      },
    },
  },
  async run(input, ctx) {
    const query = String(input.query ?? '').trim()
    if (!query) return { content: 'Error: `query` is required.', isError: true }

    const n = clampResults(input.num_results)

    // Route the DuckDuckGo HTML results page through the Jina Reader.
    const target = DDG_HTML + encodeURIComponent(query)
    const readerUrl = JINA_READER + target

    let res: Response
    try {
      res = await fetch(readerUrl, {
        signal: ctx.signal,
        redirect: 'follow',
        headers: { accept: 'text/plain, text/markdown, */*', 'x-retain-images': 'none' },
      })
    } catch (err) {
      return {
        content: `Error searching for "${query}" via Jina/DuckDuckGo: ${
          err instanceof Error ? err.message : String(err)
        }`,
        isError: true,
      }
    }

    if (!res.ok) {
      return {
        content: `Error: search backend returned HTTP ${res.status} ${res.statusText}.`,
        isError: true,
      }
    }

    const markdown = await res.text().catch(() => '')
    const results = parseDuckDuckGoResults(markdown).slice(0, n)

    if (!results.length) {
      return {
        content: `No results found for "${query}".`,
      }
    }

    const rendered = results
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`
      )
      .join('\n\n')

    return { content: `Search results for "${query}" (top ${results.length}):\n\n${rendered}` }
  },
}

function clampResults(raw: unknown): number {
  const v = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_RESULTS
  return Math.min(Math.floor(v), MAX_RESULTS)
}

/**
 * Parse the Jina-rendered DuckDuckGo HTML results page (Markdown) into
 * structured results.
 *
 * Each result renders as a block:
 *   ## [Title](//duckduckgo.com/l/?uddg=<real-url>&rut=…)
 *   [![Image N](favicon)](…redirect…)[www.example.com](…redirect…)
 *   [Snippet text with **bold** terms…](…redirect…)
 *
 * We split on the `##` headings, take the title + decoded real URL from the
 * heading link, and pick the longest prose link text in the block as the
 * snippet (the bare-domain and favicon links are skipped). Falls back to a
 * generic link scan if the page isn't heading-structured.
 */
export function parseDuckDuckGoResults(markdown: string): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()

  // Split into per-result blocks on the `##` result headings.
  const blocks = markdown.split(/^\s*##\s+/m).slice(1)
  for (const block of blocks) {
    const head = block.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (!head) continue
    const title = cleanText(head[1])
    const url = decodeDdgUrl(head[2].trim())
    if (!title || !url || !isResultUrl(url) || seen.has(url)) continue

    // Snippet = the longest prose link text in the block (has spaces, not the
    // title, not an image, not a bare domain/url).
    let snippet = ''
    const linkRe = /\[([^\]]+)\]\([^)]+\)/g
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(block)) !== null) {
      const t = cleanText(m[1])
      if (!t || t === title || t.startsWith('!')) continue
      if (!/\s/.test(t)) continue // bare domain / url fragment
      if (t.length > snippet.length) snippet = t
    }

    seen.add(url)
    out.push({ title, url, snippet: snippet.slice(0, 300) })
  }

  if (out.length) return out
  return parseGenericLinks(markdown, seen)
}

/** Fallback: scan every markdown link when the page isn't heading-structured. */
function parseGenericLinks(markdown: string, seen: Set<string>): SearchResult[] {
  const out: SearchResult[] = []
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(markdown)) !== null) {
    const title = cleanText(m[1])
    if (!title || title.startsWith('!')) continue
    const url = decodeDdgUrl(m[2].trim())
    if (!url || !isResultUrl(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ title, url, snippet: '' })
  }
  return out
}

/** Decode DuckDuckGo's `/l/?uddg=` redirect wrapper to the real URL. */
function decodeDdgUrl(raw: string): string {
  let url = raw
  if (url.startsWith('//')) url = 'https:' + url
  try {
    const u = new URL(url, 'https://duckduckgo.com')
    if (u.pathname.startsWith('/l/') || u.hostname.endsWith('duckduckgo.com')) {
      const uddg = u.searchParams.get('uddg')
      if (uddg) return decodeURIComponent(uddg)
    }
    return u.toString()
  } catch {
    return url
  }
}

/** Keep only http(s) result links; drop DDG nav/ad/internal anchors. */
function isResultUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  if (/duckduckgo\.com\/(?!l\/)/i.test(url)) return false // nav/settings links
  if (/(^|\.)duckduckgo\.com$/i.test(safeHost(url)) && !/\/l\//.test(url)) return false
  return true
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function extractSnippet(text: string): string {
  // Take the first non-empty, non-link paragraph as the snippet.
  const lines = text.split('\n')
  for (const line of lines) {
    const t = cleanText(line)
    if (t && !t.startsWith('[') && t.length > 20) return t.slice(0, 300)
  }
  return ''
}

function cleanText(s: string): string {
  return s
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
