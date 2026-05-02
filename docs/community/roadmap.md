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
5. **Model handlers**
   - [x] Built-in OpenAI handler (`AEX_MODEL=openai`)
   - [x] Built-in Anthropic handler (`AEX_MODEL=anthropic`)
   - [x] Custom handler support (`--model-handler ./path.ts`)
   - [x] Budget enforcement at runtime (cap `do`/`make` invocations)
6. **Control flow**
   - [x] `if` conditional branching with indentation-based blocks
   - [x] `for` loop iteration over lists
   - [x] Nested control flow (if inside for, etc.)
7. **Remote tool registries**
   - [x] `aex run --registry <url>` fetches tool definitions from HTTP endpoints
   - [x] Remote tools execute via POST with JSON args/response
8. **Policy inheritance & composition**
   - [x] `extends` field in policies (file path or inline object)
   - [x] `composePolicies()` merges allow/deny/confirmation/budget
   - [x] Budget takes the minimum across composed policies
9. **Structured logging & OpenTelemetry**
   - [x] `createStructuredLogger()` with timestamps, traceId, spanId
   - [x] `--log-json` flag for JSON event output
   - [x] `--otlp-endpoint` flag exports traces in OTLP format
   - [x] `exportToOTLP()` API for programmatic export
10. **CI & publishing**
    - [x] `setup-aex` GitHub Action (`action/action.yml`)
    - [x] npm publish config (`publishConfig`, `exports`, `repository` on all packages)
    - [x] `scripts/prepublish.sh` rewrites `file:` deps to versioned refs

## Up Next

- Publish `@aex-lang/*` packages to npm (requires npm org setup)
- Stable API guarantees (v1.0 milestone)
- Independent security audit

## Not Yet Done

- npm packages are not published (config ready, needs credentials)
- No stable API guarantees
- No independent security audit

Contributions are welcome — open an issue if you'd like to tackle an item or propose a new milestone.
