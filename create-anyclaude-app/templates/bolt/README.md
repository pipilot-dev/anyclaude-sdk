# anyclaude bolt

An **in-browser AI IDE** — chat builds a web app, real files + a real shell run in a [WebContainer](https://webcontainers.io) in your tab, and a live preview updates as you go. No backend. Built on [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk) + [`anyclaude-react`](https://www.npmjs.com/package/anyclaude-react).

```bash
npm install
npm run dev
```

Open the app, set an **LLM endpoint + model + API key** in the top bar, then ask the agent to build something. It edits files in the container; hit **Refresh preview** to see the result.

## How it works

- `WebContainer.boot()` mounts a real **Vite + React** starter (`src/starter.ts`); the IDE runs `npm install` then `npm run dev` and Vite hot-reloads the preview as files change.
- The agent runs **in the browser** via `query()` from `anyclaude-sdk/query`, against a `WebContainerWorkspace` — so its `bash` / file tools operate on the real container.
- `useWebContainerPreview({ wc })` (from `anyclaude-react`) starts the dev server, waits for the container's `server-ready` event, and hands back the forwarded URL for the `<iframe>`.
- The full IDE: `<ChatPanel>` (chat), `<FileExplorer>` + `<CodeEditor>` (browse/edit, writes straight back to the container), and `<Terminal>` (a live `jsh` shell) — all from `anyclaude-react` / `anyclaude-react/ide`.

## Important: the LLM endpoint must allow CORS

The agent calls the LLM **from the browser**, so the endpoint needs permissive CORS. OpenAI and Anthropic's public APIs work; many gateways (and keyless ones like Kilo) do **not**. If you need a non-CORS or key-protected model, run the agent server-side instead — see the [Deploy](https://anyclaude-docs.puter.site/deploy.html) guide (serverless + the "survivor", or `clientTools` for server-brain/browser-hands), or the `claude-code-router` example to put any model behind an Anthropic-compatible endpoint.

## Cross-origin isolation

WebContainer requires COOP/COEP headers. `vite.config.ts` sets them for dev; set the same on your production host (or use [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) on static hosts that can't send headers).

## Make it your own

- Swap the Vite starter in `src/starter.ts` for any framework (Next, SvelteKit, …); point the preview hook's `command`/`args` at its dev script. For an instant, install-free preview, use a zero-dependency Node static server instead.
- The IDE panels come from `anyclaude-react` (`ChatPanel`, `FileExplorer`) and `anyclaude-react/ide` (`Terminal`, `CodeEditor`) — rearrange or restyle freely; everything is restylable via `styles.css`.
- To move the agent loop server-side (for non-CORS / key-protected models), delegate file/bash tools back to the container with `createWebContainerClientTools(wc)` + `useAgent({ endpoint, clientTools })`.
