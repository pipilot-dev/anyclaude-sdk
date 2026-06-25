# Security Policy

## Supported versions

We patch security issues on the latest minor of each package.

| Package | Supported |
|---|---|
| `anyclaude-sdk` | latest `0.4.x` |
| `anyclaude-react` | latest `0.2.x` |

## Reporting a vulnerability

**Do not open a public issue for security reports.**

Please report privately via GitHub's
[private vulnerability reporting](https://github.com/pipilot-dev/anyclaude-sdk/security/advisories/new),
or email **anye.happiness@swisslinkedu.com** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal repro is ideal),
- affected package and version.

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation
as soon as practical, crediting you in the advisory unless you prefer otherwise.

## Security model (please read before reporting)

anyclaude-sdk can run the agent loop in two places, and the trust boundary
differs. Reports that ignore this model are usually not vulnerabilities.

### Browser / `createAgentClient` mode (agent runs in the tab)

When `query()` runs in the browser, the browser **builds** the LLM request, so
its full contents are visible to the user in DevTools by design. This is a
property of the medium, not a bug:

- The request **payload and response shape are public.** They follow the
  documented OpenAI/Anthropic-compatible format.
- Your **system prompt, tool instructions, and retrieved context are visible**
  if assembled in the browser. To keep them private, run the agent server-side
  (see below).
- **Never ship secrets to the browser.** In no-backend mode this means
  "bring your own key" — the key belongs to the user, not to you. Do not embed a
  provider key you want to keep private in a browser bundle.

Client-side obfuscation/encryption of the payload is **not** a security boundary
and such reports will be closed: the decryptor and key ship in the same bundle.

### Server / endpoint mode (agent runs in a function)

When `query()` runs server-side and the browser talks to it via
`createEndpointClient`:

- The system prompt, tool instructions, and retrieved context live in the
  server→LLM request and never reach the browser.
- Use `projectMessages(stream, { preset: 'public' })` to additionally strip
  reasoning, raw tool output / RAG, and model identity from the streamed
  messages.
- Authenticate and rate-limit the endpoint (e.g. a Supabase JWT + RLS). Treat
  the request schema as public and design accordingly.

### In scope

- Auth/authz bypass on server-side execution paths
- Secret leakage that the SDK causes outside the documented "BYO key" browser model
- Injection, path traversal, or sandbox escape in tools running on a server/sandbox
- Supply-chain issues in published artifacts

### Out of scope

- Payload/response visibility in browser mode (by design — see above)
- Prompt-extraction via model output (e.g. "print your system prompt") — a
  model-behavior concern, mitigated with instruction hardening + output
  filtering, not a transport vulnerability
- Tool *names* being visible through usage when descriptions are hidden
