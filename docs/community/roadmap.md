# Roadmap

## Implemented in Repo

> These features exist in the source code but packages are **not yet published to npm** and APIs are **not yet stable**.

1. **Runtime**
   - [x] Built-in checks (`patch touches only`, diff linting)
   - [x] Tool registry (`file.write`, `tests.run`, `git.diff`, `git.apply`)
   - [x] Command injection and path traversal prevention
   - [x] JSON IR compilation
2. **Adapters**
   - [x] OpenAI Agents SDK (`@aex-lang/openai-agents`)
   - [x] MCP gateway (`@aex-lang/mcp-gateway`)
   - [x] LangGraph compiler (`@aex-lang/langgraph`)
3. **Developer experience**
   - [x] `aex fmt` auto-formatter
   - [x] CLI diagnostics with error codes
   - [x] VS Code extension (syntax highlighting, snippets)
   - [x] Interactive playground on docs site
4. **Security**
   - [x] Threat-model reference implementation
   - [x] Signed contracts (`aex sign` / `aex verify`)
   - [x] Timing-safe HMAC verification

## Up Next

- Publish `@aex-lang/*` packages to npm
- Loops and conditional branching in the DSL (`if`, `for`)
- `aex run` support for remote tool registries
- Policy inheritance and composition across contracts
- Structured logging and OpenTelemetry export
- `aex-lang/setup-aex` GitHub Action for CI
- Budget enforcement at runtime (cap `do`/`make` invocations)
- Model handler integrations (OpenAI, Anthropic) for `make` steps

## Not Yet Done

- npm packages are not published
- No stable API guarantees
- No independent security audit
- `make` steps require a user-provided model handler

Contributions are welcome — open an issue if you'd like to tackle an item or propose a new milestone.
