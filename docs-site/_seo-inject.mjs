// Inject favicon + SEO/Open Graph/Twitter meta into every docs page.
// Idempotent: skips a file that already has a canonical link. Pulls each page's
// own <title> and <meta description> so tags are per-page accurate.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const BASE = 'https://anyclaude-docs.puter.site/'
const OG = BASE + 'og.png'
const KEYWORDS =
  'anyclaude-sdk, Claude Code, AI agent SDK, agent tool loop, LLM agents, OpenAI compatible, Anthropic, MCP, sub-agents, browser AI, WebContainer, Node, Bun, tool use'

const files = readdirSync('.').filter((f) => f.endsWith('.html') && !f.startsWith('_'))

const pick = (html, re) => (html.match(re)?.[1] ?? '').trim()

for (const file of files) {
  let html = readFileSync(file, 'utf8')
  if (html.includes('rel="canonical"')) {
    // refresh nothing; already injected
    continue
  }
  const title = pick(html, /<title>([\s\S]*?)<\/title>/)
  const desc = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/)
  const url = BASE + file
  const isHome = file === 'index.html'

  const block = `  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="mask-icon" href="favicon.svg" color="#4dd0e1" />
  <meta name="theme-color" content="#0b0e14" />
  <meta name="robots" content="index, follow" />
  <meta name="author" content="Hans Ade" />
  <meta name="keywords" content="${KEYWORDS}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="anyclaude-sdk" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${OG}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${OG}" />`

  const ld = isHome
    ? `\n  <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'anyclaude-sdk',
        description: desc,
        url: BASE,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Browser, Node.js, Bun',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/licenses/MIT',
        author: { '@type': 'Person', name: 'Hans Ade' },
        sameAs: [
          'https://github.com/pipilot-dev/anyclaude-sdk',
          'https://www.npmjs.com/package/anyclaude-sdk',
        ],
      })}</script>`
    : ''

  // Insert right after the description meta (or after <title> as fallback).
  const anchor = html.match(/<meta\s+name="description"[^>]*>/)?.[0] ?? html.match(/<\/title>/)?.[0]
  html = html.replace(anchor, anchor + '\n' + block + ld)
  writeFileSync(file, html)
  console.log(`${file}: title="${title.slice(0, 40)}…" injected${ld ? ' + JSON-LD' : ''}`)
}
