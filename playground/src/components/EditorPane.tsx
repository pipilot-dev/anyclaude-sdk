import { useEffect, useRef, useState } from 'react'
import type { WebContainer } from '@webcontainer/api'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'

export function EditorPane(props: { wc: WebContainer; path: string | null; onSaved: () => void }) {
  const { wc, path } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          javascript({ typescript: true, jsx: true }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setDirty(true)
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])

  // Load the selected file's content into the editor.
  useEffect(() => {
    if (!path || !viewRef.current) return
    let cancelled = false
    wc.fs
      .readFile(path, 'utf-8')
      .then((contents) => {
        if (cancelled || !viewRef.current) return
        viewRef.current.dispatch({
          changes: { from: 0, to: viewRef.current.state.doc.length, insert: contents },
        })
        setDirty(false)
        setStatus('')
      })
      .catch(() => setStatus('(binary or unreadable file)'))
    return () => {
      cancelled = true
    }
  }, [wc, path])

  async function save() {
    if (!path || !viewRef.current) return
    await wc.fs.writeFile(path, viewRef.current.state.doc.toString())
    setDirty(false)
    setStatus('saved')
    props.onSaved()
    setTimeout(() => setStatus(''), 1200)
  }

  return (
    <div
      className="editor"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="editor-head">
        <span className="editor-path">{path ?? 'No file selected'}</span>
        <span className="editor-status">{dirty ? '● unsaved' : status}</span>
        <button onClick={() => void save()} disabled={!path || !dirty}>
          Save
        </button>
      </div>
      <div className="editor-host" ref={hostRef} />
    </div>
  )
}
