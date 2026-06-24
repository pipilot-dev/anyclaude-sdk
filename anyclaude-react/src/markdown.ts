// Tiny, dependency-free, XSS-safe markdown → React renderer. Text goes through
// React text nodes (auto-escaped) — we never use dangerouslySetInnerHTML. Handles
// the common cases (headings, lists, blockquote, fenced + inline code, bold,
// italic, links). Consumers can pass their own renderer to <MarkdownMessage>.
import { createElement, Fragment, type ReactNode } from 'react'

let _k = 0
const key = () => 'md' + ++_k

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // order matters: code first (so ** inside `code` isn't parsed), then link, bold, italic
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      nodes.push(createElement('code', { key: key(), className: 'ac-code-inline' }, tok.slice(1, -1)))
    } else if (tok.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      nodes.push(createElement('a', { key: key(), className: 'ac-link', href: lm[2], target: '_blank', rel: 'noreferrer' }, lm[1]))
    } else if (tok.startsWith('**')) {
      nodes.push(createElement('strong', { key: key() }, tok.slice(2, -2)))
    } else {
      nodes.push(createElement('em', { key: key() }, tok.slice(1, -1)))
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Render markdown text to React nodes. */
export function renderMarkdown(src: string): ReactNode {
  const lines = (src ?? '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = () => {
    if (!list) return
    const items = list.items.map((it) => createElement('li', { key: key() }, inline(it)))
    out.push(createElement(list.ordered ? 'ol' : 'ul', { key: key(), className: 'ac-list' }, items))
    list = null
  }

  while (i < lines.length) {
    const line = lines[i]
    // fenced code block
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      flushList()
      const lang = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      out.push(
        createElement(
          'pre',
          { key: key(), className: 'ac-code-block', 'data-lang': lang || undefined },
          createElement('code', null, body.join('\n'))
        )
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flushList()
      out.push(createElement('h' + h[1].length, { key: key(), className: 'ac-h' }, inline(h[2])))
      i++
      continue
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      const ordered = /\d+\./.test(li[1])
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push(li[2])
      i++
      continue
    }
    const bq = /^>\s?(.*)$/.exec(line)
    if (bq) {
      flushList()
      out.push(createElement('blockquote', { key: key(), className: 'ac-quote' }, inline(bq[1])))
      i++
      continue
    }
    if (line.trim() === '') {
      flushList()
      i++
      continue
    }
    // paragraph — merge consecutive non-blank, non-special lines
    flushList()
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```|>\s?|\s*([-*]|\d+\.)\s)/.test(lines[i])
    ) {
      para.push(lines[i++])
    }
    out.push(createElement('p', { key: key(), className: 'ac-p' }, inline(para.join(' '))))
  }
  flushList()
  return createElement(Fragment, null, out)
}
