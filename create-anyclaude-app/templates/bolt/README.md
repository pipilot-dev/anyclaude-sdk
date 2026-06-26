# anyclaude bolt

An **in-browser AI IDE** — chat builds a web app, real files + a real shell run in a [WebContainer](https://webcontainers.io) in your tab, and a live preview updates as you go. No backend. Built on [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk) + [`anyclaude-react`](https://www.npmjs.com/package/anyclaude-react).

```bash
npm install
npm run dev
```

Open the app, set an **LLM endpoint + model + API key** in the top bar, then ask the agent to build something. It edits files in the container; hit **Refresh preview** to see the result.

## How it works

- `WebContainer.boot()` + a tiny zero-dependency Node static server (`src/starter.ts`) give an instant dev server (no `npm install` wait).
- The agent runs **in the browser** via `query()` from `anyclaude-sdk/query`, against a `WebContainerWorkspace` — so its `bash` / file tools operate on the real container.
- `useWebContainerPreview({ wc })` (from `anyclaude-react`) boots the dev server, waits for the container's `server-ready` event, and hands back the forwarded URL for the `<iframe>`.
- `<ChatPanel run={…} />` renders the conversation.

## Important: the LLM endpoint must allow CORS

The agent calls the LLM **from the browser**, so the endpoint needs permissive CORS. OpenAI and Anthropic's public APIs work; many gateways (and keyless ones like Kilo) do **not**. If you need a non-CORS or key-protected model, run the agent server-side instead — see the [Deploy](https://anyclaude-docs.puter.site/deploy.html) guide (serverless + the "survivor", or `clientTools` for server-brain/browser-hands), or the `claude-code-router` example to put any model behind an Anthropic-compatible endpoint.

## Cross-origin isolation

WebContainer requires COOP/COEP headers. `vite.config.ts` sets them for dev; set the same on your production host (or use [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) on static hosts that can't send headers).

## Make it your own

- Swap the starter for a Vite/Next project in `src/starter.ts` (expect an `npm install` wait; point the preview hook's `command`/`args` at your dev script).
- Add the IDE panels: `import { Terminal, CodeEditor } from 'anyclaude-react/ide'` and `FileExplorer` from `anyclaude-react`.
- Delegate file/bash tools to the container explicitly with `createWebContainerClientTools(wc)` if you move the loop server-side.
