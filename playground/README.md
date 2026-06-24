# browser-claude-sdk · playground

A Vite + React app that exercises the SDK end-to-end in a real browser:

- **Left** — chat panel driving the agent (`query()` over a WebContainer workspace).
- **Right top** — file explorer + CodeMirror editor over the same WebContainer FS.
- **Right bottom** — an xterm terminal wired to an interactive `jsh` shell.

The agent, explorer, editor, and terminal all share **one** booted WebContainer,
so files the agent writes show up in the tree and are runnable in the terminal.

## Run

```bash
cd playground
npm install
npm run dev
```

Open the printed URL. It defaults to the **keyless** endpoint
`https://the3rdacademy.com/api/v1` with model `claude-sonnet-4-6` (both editable
in the top settings row).

Try: *"create an express server in src/server.js, install express, and run it"* —
watch the tool calls stream on the left, the files appear in the explorer, and
run things yourself in the terminal.

## Cross-origin isolation (important)

WebContainer requires the page to be cross-origin isolated. `vite.config.ts`
already sets the required headers on both the dev server and `vite preview`:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If you host the built app elsewhere, your server must send these headers too, or
WebContainer will fail to boot.

## How it's wired

- The SDK is aliased to its source (`@browser-claude-sdk/core` → `../src/index.ts`)
  via `vite.config.ts`; a small plugin remaps the SDK's `./x.js` import
  specifiers to `.ts`, and `node:*` builtins (used only by the Node-only
  `LocalSandbox`) are stubbed since they never run in the browser.
- Each chat message starts one `query()` run; the WebContainer workspace persists
  across messages. `Interrupt` calls `query().interrupt()`.
- Background tasks are enabled (`background: true`), so the agent can use
  `run_in_background` / `task_list` / `task_output`.
