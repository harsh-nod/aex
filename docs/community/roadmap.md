# Roadmap

## Implemented in Repo

> All `@aex-lang/*` packages are **published on npm** (v0.0.3). APIs are **not yet stable** — expect breaking changes before v1.0.

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
11. **Policy files & merge semantics**
    - [x] `policy workspace v0` keyword for ambient security boundaries
    - [x] `aex init --policy` scaffolds `.aex/policy.aex`
    - [x] Merge semantics: allow = intersection, deny = union, confirm = union, budget = min
    - [x] `aex effective` previews merged permissions before running
    - [x] Parser-level validation: policy files reject `need`, `do`, `make`, `check`, `return`
12. **MCP proxy**
    - [x] `aex proxy -- <cmd>` gates MCP tool calls against policy
    - [x] Auto-discovers `.aex/policy.aex`
    - [x] Budget enforcement, confirmation gates, allow/deny filtering
    - [x] Structured JSON audit logging to stderr
    - [x] `tools/list` response filtering
13. **Claude Code hook enforcement**
    - [x] `aex gate` PreToolUse hook gates built-in tools (Read, Write, Bash, etc.)
    - [x] Tool name mapping: Claude Code PascalCase → AEX dotted capabilities
    - [x] Budget state persistence across hook invocations
    - [x] `allow` keyword for policy files, `AEX120`/`AEX121` diagnostics
    - [x] `task` keyword as alternative to `agent`

## Up Next

- Stable API guarantees (v1.0 milestone)
- Independent security audit

## Not Yet Done

- No stable API guarantees
- No independent security audit

Contributions are welcome — open an issue if you'd like to tackle an item or propose a new milestone.
