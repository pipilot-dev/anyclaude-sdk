# Contributing to anyclaude-sdk

Thanks for your interest in contributing. This guide covers how to set up the
project, the conventions we follow, and how to propose changes.

## Project layout

This is a monorepo containing two published packages plus runnable examples:

| Path | Package / purpose |
|---|---|
| `src/` | `anyclaude-sdk` — the headless agent engine |
| `anyclaude-react/` | `anyclaude-react` — React hooks + UI components |
| `examples/` | Runnable Vite projects (browser + Vercel serverless) |
| `docs-site/` | The documentation site (deployed to Puter) |

## Prerequisites

- Node.js >= 18
- npm (the repo uses npm workspaces-style local installs per package)

## Getting started

```bash
git clone https://github.com/pipilot-dev/anyclaude-sdk.git
cd anyclaude-sdk
npm install            # root SDK
npm run build          # type-check + emit dist/
```

For the React kit:

```bash
cd anyclaude-react
npm install
npm run typecheck      # tsc --noEmit
npm run build          # emit dist/
```

## Before you open a pull request

1. **Type-check passes:** `npx tsc -p tsconfig.json --noEmit` is clean in any
   package you touched (`anyclaude-react/` and each `examples/*` have their own).
2. **Builds succeed:** `npm run build` works for the affected package, and any
   example you changed builds with `npm run build`.
3. **No secrets:** never commit API keys, tokens, or `.env` files. `.env.example`
   files hold placeholders only.
4. **No emojis** in code, docs, or UI — use Lucide / inline SVG icons.
5. Keep changes focused; match the surrounding code style.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add client-side tools
fix(anyclaude-react): tool pill collapsed in flex column
docs: refresh README
chore: release 0.4.0
```

Common scopes: `sdk`, `anyclaude-react`, `examples`, `docs`.

## Releasing (maintainers)

1. Bump the version in the package's `package.json` (semver).
2. Update `CHANGELOG.md`.
3. `npm publish --access public` (runs `prepublishOnly` build).
4. Tag the release on GitHub (`vX.Y.Z` for the SDK,
   `anyclaude-react-vX.Y.Z` for the React kit).

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/pipilot-dev/anyclaude-sdk/issues/new/choose).
For anything security-related, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Code of Conduct

By participating, you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
