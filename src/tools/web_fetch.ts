import type { Tool } from './types.js'

const DESCRIPTION = `Fetches content from a URL and returns it as clean, readable text.

- Takes a \`url\` and an optional \`prompt\` describing what to extract.
- Powered by the Jina Reader (https://r.jina.ai/), which renders the page and returns LLM-ready Markdown — so JavaScript-heavy pages work and there are no CORS restrictions in the browser.
- This tool is read-only and does not modify files.
- The output may be truncated if the page is very large.`

/** Jina Reader endpoint. GET https://r.jina.ai/<target-url> → clean Markdown. */
const JINA_READER = 'https://r.jina.ai/'

const MAX_OUTPUT = 50_000

export const webFetch: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Fully-formed URL to fetch.' },
          prompt: {
            type: 'string',
            description: 'What information to extract from the page (for your own focus).',
          },
        },
        required: ['url'],
      },
    },
  },
  async run(input, ctx) {
    let url = String(input.url ?? '').trim()
    if (!url) return { content: 'Error: `url` is required.', isError: true }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    // Route through Jina Reader: https://r.jina.ai/<target-url>.
    const readerUrl = JINA_READER + url

    let res: Response
    try {
      res = await fetch(readerUrl, {
        signal: ctx.signal,
        redirect: 'follow',
        headers: {
          accept: 'text/plain, text/markdown, */*',
          // Ask the reader to skip inline images so the text stays compact.
          'x-retain-images': 'none',
        },
      })
    } catch (err) {
      return {
        content: `Error fetching ${url} via Jina Reader: ${
          err instanceof Error ? err.message : String(err)
        }`,
        isError: true,
      }
    }

    if (!res.ok) {
      return {
        content: `Error: Jina Reader returned HTTP ${res.status} ${res.statusText} for ${url}.`,
        isError: true,
      }
    }

    let body: string
    try {
      body = await res.text()
    } catch (err) {
      return { content: `Error reading content of ${url}: ${(err as Error).message}`, isError: true }
    }

    let text = body.trim()
    let note = ''
    if (text.length > MAX_OUTPUT) {
      text = text.slice(0, MAX_OUTPUT)
      note = `\n\n[truncated to ${MAX_OUTPUT} characters]`
    }

    return { content: `Fetched ${url} (via r.jina.ai):\n\n${text}${note}` }
  },
}
