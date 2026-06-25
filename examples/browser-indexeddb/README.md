# browser-indexeddb — file tools on your own IndexedDB

A browser-only [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk) demo where the agent loop runs **entirely in the tab** and its built-in file tools (`write_file` / `read_file` / `edit_file` / `list_files` / `glob` / `grep`) execute against **your IndexedDB**, via `DexieFileSystem`. Files the agent writes are durable — they survive reloads — and show up in the file explorer.

```bash
npm install
npm run dev
```

## How it works

The workspace is an IndexedDB filesystem:

```ts
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { DexieFileSystem } from 'anyclaude-sdk/fs'

const fs = new DexieFileSystem('anyclaude-demo-fs')          // ← your IndexedDB database
const workspace = Object.assign(fs, { exec: async () => ({ output: 'no shell', exitCode: 127 }) })

for await (const m of query({ prompt, workspace, llm, disallowedTools: ['bash'] })) render(m)
```

- **Your IndexedDB is the location.** Change the database name to switch stores (e.g. per-user, per-project). `new DexieFileSystem(name, { db })` lets the FS **share a Dexie instance your app already owns**.
- **Durable.** Everything the agent writes persists in IndexedDB and is there after a reload.
- **No shell.** A pure IndexedDB workspace has no `bash` — this example disables it (`disallowedTools: ['bash']`) and tells the model to use the file tools only. For a real shell in the browser, use the WebContainer examples.

## LLM endpoint (read this)

The agent calls the LLM **from the browser**, so you must point it at a **CORS-enabled** OpenAI/Anthropic-compatible endpoint (set it in the in-app "LLM settings" bar; it's saved to `localStorage`).

> **Kilo (`api.kilo.ai`) is server-only — it does not send browser CORS headers**, so it can't be called directly from a tab. To use Kilo with real in-browser execution, run the agent **server-side** and execute tools in the browser via client tools — see the [`vercel-clienttools`](../vercel-clienttools) example (`createWorkspaceClientTools` / `createWebContainerClientTools`).

## Imports

This example imports only the **browser-clean** SDK subpaths (the root barrel pulls in Node built-ins + `comlink`, which breaks browser bundlers):

```ts
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { DexieFileSystem } from 'anyclaude-sdk/fs'
import type { SDKMessage } from 'anyclaude-sdk'      // type-only (erased)
import { ChatPanel, FileExplorer, CodeEditor } from 'anyclaude-react'
```
