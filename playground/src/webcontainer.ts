import { WebContainer } from '@webcontainer/api'

// WebContainer.boot() may only be called once per page. Guard with a singleton
// promise so React StrictMode's double-mount doesn't boot twice.
let bootPromise: Promise<WebContainer> | null = null

const INITIAL_TREE = {
  'README.md': {
    file: {
      contents:
        '# Playground project\n\nThis is a scratch project running inside WebContainer.\nAsk the agent (left panel) to build something here.\n',
    },
  },
  'package.json': {
    file: {
      contents: JSON.stringify(
        { name: 'playground-project', version: '0.0.0', type: 'module' },
        null,
        2
      ),
    },
  },
  src: {
    directory: {
      'index.js': { file: { contents: "console.log('hello from the playground')\n" } },
    },
  },
}

export async function bootWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot().then(async (wc) => {
      await wc.mount(INITIAL_TREE)
      return wc
    })
  }
  return bootPromise
}
