import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'

export interface CodeEditorProps {
  /** The document text (controlled). */
  value: string
  onChange?: (value: string) => void
  /** Language for highlighting. Currently 'javascript'/'typescript' supported out of the box. */
  language?: string
  readOnly?: boolean
  className?: string
  /** Extra CodeMirror extensions to append. */
  extensions?: Extension[]
}

/**
 * A CodeMirror 6 editor. Controlled via `value`/`onChange`. Requires the optional
 * peer deps `codemirror` + `@codemirror/*`.
 */
export function CodeEditor({ value, onChange, language = 'typescript', readOnly = false, className, extensions = [] }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const langExt = language === 'javascript' ? javascript({ jsx: true }) : javascript({ typescript: true, jsx: true })
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          langExt,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && onChange) onChange(u.state.doc.toString())
          }),
          EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
          ...extensions,
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Sync external value changes into the editor (without clobbering local edits).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className={`ac-editor-host${className ? ' ' + className : ''}`} ref={hostRef} />
}
