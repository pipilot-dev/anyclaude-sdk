#!/usr/bin/env node
// Public adoption report — "which public repos use anyclaude-sdk, and what kind
// of projects are they?" — assembled ENTIRELY from public data (GitHub code
// search + repo metadata + npm download stats). Nothing is collected from
// anyone's machine; this is the legitimate, no-liability way to track adoption.
//
// Usage:
//   GITHUB_TOKEN=ghp_... node scripts/adoption-report.mjs            # markdown
//   GITHUB_TOKEN=ghp_... node scripts/adoption-report.mjs --json > adoption.json
//
// The token only needs public read scope. GitHub code search is rate-limited
// (~10 req/min) — this stays well under.

const PACKAGES = ['anyclaude-sdk', 'anyclaude-react', 'create-anyclaude-app']
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const asJson = process.argv.includes('--json')

if (!token) {
  console.error('Set GITHUB_TOKEN (public read scope) to run the GitHub portion.')
}

const GH = 'https://api.github.com'
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'anyclaude-adoption-report',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
}

async function gh(path) {
  const res = await fetch(GH + path, { headers })
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset')
    throw new Error(`GitHub 403 (rate limit?); resets at ${reset ? new Date(+reset * 1000).toISOString() : '?'}`)
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`)
  return res.json()
}

// Coarse "kind of project" from public signals only.
function classify(repo) {
  const t = (repo.topics || []).join(' ')
  const hay = `${repo.name} ${repo.description || ''} ${t} ${repo.language || ''}`.toLowerCase()
  if (/\b(ide|editor|bolt|workbench|playground)\b/.test(hay)) return 'in-browser IDE / playground'
  if (/\b(router|proxy|gateway|claude-code)\b/.test(hay)) return 'router / gateway'
  if (/\b(chat|assistant|bot|agent)\b/.test(hay)) return 'chat / agent app'
  if (/\b(vscode|extension|cli)\b/.test(hay)) return 'tool / extension'
  if (/\b(starter|template|example|demo|boilerplate)\b/.test(hay)) return 'template / example'
  return repo.language ? `${repo.language} project` : 'unclassified'
}

async function npmWeekly(pkg) {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg}`)
    if (!res.ok) return null
    return (await res.json()).downloads ?? null
  } catch {
    return null
  }
}

async function repoDetails(fullName, cache) {
  if (cache.has(fullName)) return cache.get(fullName)
  try {
    const r = await gh(`/repos/${fullName}`)
    const d = {
      full_name: r.full_name,
      private: r.private,
      stars: r.stargazers_count,
      language: r.language,
      description: r.description,
      topics: r.topics || [],
      pushed_at: r.pushed_at,
      html_url: r.html_url,
    }
    d.kind = classify(d)
    cache.set(fullName, d)
    return d
  } catch {
    return null
  }
}

async function main() {
  const npm = {}
  for (const p of PACKAGES) npm[p] = await npmWeekly(p)

  const repos = new Map()
  const cache = new Map()
  if (token) {
    for (const pkg of PACKAGES) {
      try {
        // Public repos whose package.json references the package.
        const q = encodeURIComponent(`"${pkg}" in:file filename:package.json`)
        const data = await gh(`/search/code?q=${q}&per_page=50`)
        for (const item of data.items || []) {
          const full = item.repository?.full_name
          if (!full || repos.has(full)) continue
          const d = await repoDetails(full, cache)
          if (d && !d.private) repos.set(full, d)
        }
      } catch (e) {
        console.error(`! code search for ${pkg}: ${e.message}`)
      }
    }
  }

  const list = [...repos.values()].sort((a, b) => (b.stars || 0) - (a.stars || 0))
  const report = {
    generated_at: new Date().toISOString(),
    npm_weekly_downloads: npm,
    public_dependent_repos: list.length,
    kinds: list.reduce((acc, r) => ((acc[r.kind] = (acc[r.kind] || 0) + 1), acc), {}),
    repos: list,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`# anyclaude adoption report — ${report.generated_at.slice(0, 10)}\n`)
  console.log('## npm weekly downloads')
  for (const [p, n] of Object.entries(npm)) console.log(`- ${p}: ${n ?? 'n/a'}`)
  console.log(`\n## Public repos referencing the packages (package.json): ${list.length}`)
  if (!token) console.log('_(set GITHUB_TOKEN to populate this section)_')
  if (Object.keys(report.kinds).length) {
    console.log('\n### By kind')
    for (const [k, n] of Object.entries(report.kinds).sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${n}`)
  }
  if (list.length) {
    console.log('\n| Repo | ★ | Kind | Language | Last push |')
    console.log('|---|---|---|---|---|')
    for (const r of list.slice(0, 50)) {
      console.log(`| [${r.full_name}](${r.html_url}) | ${r.stars} | ${r.kind} | ${r.language || '—'} | ${(r.pushed_at || '').slice(0, 10)} |`)
    }
  }
  console.log('\n> Public data only (GitHub code search + npm). No data collected from any user machine.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
