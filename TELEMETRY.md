# Telemetry

`anyclaude-sdk` collects **anonymous, aggregate** usage telemetry to answer one question: *are people adopting the SDK, and which parts?* It is designed so that it **cannot** collect anything identifying, and it's off with a single switch.

## TL;DR — opt out

Any one of these disables it completely:

```bash
ANYCLAUDE_TELEMETRY=0       # or =false / =off
DO_NOT_TRACK=1              # the cross-tool standard
# also auto-disabled whenever CI is set
```

In code:
```ts
query({ /* … */, disableTelemetry: true })        // or telemetry: { disabled: true }
```

In the browser:
```js
localStorage.setItem('anyclaude_telemetry', '0')  // or: globalThis.__ANYCLAUDE_NO_TELEMETRY__ = true
```

It is also a **no-op unless a collector URL is configured** (`ANYCLAUDE_TELEMETRY_URL` or `telemetry: { url }`). With no endpoint, nothing is ever sent.

## What is sent (one event per `query()` run)

| Field | Example | Why |
|---|---|---|
| `event` | `"run"` | the only event type |
| `sdk_version` | `"0.7.0"` | adoption by version |
| `runtime` | `browser` / `node` / `bun` / `webcontainer` | where it runs |
| `install` | random UUID | de-dupe runs; **not** tied to machine, user, or IP. Per-origin in the browser, per-process elsewhere |
| `model_family` | `openai` / `anthropic` / `qwen` / `deepseek` / `generic` | a coarse bucket from the model id — **never the model id, endpoint, or key** |
| feature booleans | `survivor: true`, `mcp: false`, … | which capabilities are used: `client_workspace_tools`, `client_tools`, `survivor`, `mcp`, `team`, `background`, `auto_compact`, `skills`, `sessions`, `partial_messages`, `resumed` |

That's the entire schema. The transport is fire-and-forget (`keepalive`), never blocks the agent, and swallows its own errors.

## What is NEVER sent

Enforced in code (`src/telemetry.ts` whitelists prop keys and value types) and re-validated by the collector:

- repository URLs / git remotes
- project or package names
- file paths or directory names
- source code or file contents
- prompts, messages, tool arguments, or LLM responses
- API keys, tokens, endpoints, or base URLs
- IP-derived location, machine ids, usernames, or any PII

Anything not in the allowlist above is dropped before the request is built.

## Where it goes

To the collector **you** configure — there is no default endpoint baked in. A reference collector that keeps only aggregate counters is in [`examples/telemetry-collector`](./examples/telemetry-collector). You host it; you see counts, not people.

## Why opt-out (not opt-in)

This is the model used by Next.js, Astro, and Nuxt: on by default, fully anonymous, prominently documented, and trivially disabled (including the `DO_NOT_TRACK` standard). If you'd rather it be opt-in for your fork/deployment, set no `ANYCLAUDE_TELEMETRY_URL` and enable it only where you want.
