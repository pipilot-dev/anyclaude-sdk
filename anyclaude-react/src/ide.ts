// anyclaude-react/ide — heavy IDE components, split onto a subpath so the root
// barrel stays dependency-light. These are the only components that need the
// optional peers @xterm/* (Terminal) and codemirror/@codemirror/* (CodeEditor).
//
//   import { Terminal, CodeEditor } from 'anyclaude-react/ide'
export { Terminal } from './components/Terminal.js'
export type { TerminalProps, ShellProcess } from './components/Terminal.js'
export { CodeEditor } from './components/CodeEditor.js'
export type { CodeEditorProps } from './components/CodeEditor.js'
