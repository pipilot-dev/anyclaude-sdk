# anyclaude-sdk tool-use compatibility matrix

> Offline self-check (no network). Live results require provider endpoints + keys —
> run `node scripts/compat-matrix.mjs ./compat.config.json` (keys via `env:NAME`), or
> set the `COMPAT_CONFIG_JSON` + provider-key secrets in the CI workflow.

Built-in model profiles (which dialects each is tried with):

| Model id | Profile | Inline dialects |
|---|---|---|
| `gpt-4o` | `openai` | _(native)_ |
| `claude-sonnet-4-6` | `anthropic` | _(native)_ |
| `qwen2.5-coder:7b` | `qwen` | hermes, xml-function, json-fence |
| `deepseek-chat` | `deepseek` | json-fence, hermes, xml-function |
| `kimi-k2` | `moonshot` | hermes, json-fence |
| `glm-4` | `zhipu` | xml-function, hermes, json-fence |
| `mistral-large` | `mistral` | json-fence, hermes, xml-function |
| `llama3.1:70b` | `llama` | json-fence, hermes, xml-function |
| `unknown-model` | `generic` | xml-function, hermes, json-fence |
