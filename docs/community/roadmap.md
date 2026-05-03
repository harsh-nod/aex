# Roadmap

## Maturity Levels

| Label | Meaning |
|-------|---------|
| **Stable** | API is unlikely to change. Covered by tests and used in production workflows. |
| **Alpha** | Functional and tested, but the API may change before v1.0. |
| **Experimental** | Works end-to-end but may have rough edges. Feedback welcome. |
| **Planned** | Designed but not yet implemented. |

## Implemented in Repo

> All `@aex-lang/*` packages are **published on npm** (v0.0.4). APIs are **not yet stable** — expect breaking changes before v1.0.

1. **Runtime** <small>(Alpha)</small>
   - [x] Built-in checks (`patch touches only`, diff linting)
   - [x] Tool registry (`file.write`, `tests.run`, `git.diff`, `git.apply`)
   - [x] Command injection and path traversal prevention
   - [x] JSON IR compilation
2. **Adapters** <small>(Alpha)</small>
   - [x] OpenAI Agents SDK (`@aex-lang/openai-agents`)
   - [x] MCP gateway (`@aex-lang/mcp-gateway`)
   - [x] LangGraph compiler (`@aex-lang/langgraph`)
3. **Developer experience** <small>(Alpha)</small>
   - [x] `aex fmt` auto-formatter
   - [x] CLI diagnostics with error codes
   - [x] VS Code extension (syntax highlighting, snippets)
   - [x] Interactive playground on docs site
4. **Security** <small>(Experimental)</small>
   - [x] Threat-model reference implementation
   - [x] Signed contracts (`aex sign` / `aex verify`)
   - [x] Timing-safe HMAC verification
5. **Model handlers** <small>(Experimental)</small>
   - [x] Built-in OpenAI handler (`AEX_MODEL=openai`)
   - [x] Built-in Anthropic handler (`AEX_MODEL=anthropic`)
   - [x] Custom handler support (`--model-handler ./path.ts`)
   - [x] Budget enforcement at runtime (cap `do`/`make` invocations)
6. **Control flow** <small>(Alpha)</small>
   - [x] `if` conditional branching with indentation-based blocks
   - [x] `for` loop iteration over lists
   - [x] Nested control flow (if inside for, etc.)
7. **Remote tool registries** <small>(Experimental)</small>
   - [x] `aex run --registry <url>` fetches tool definitions from HTTP endpoints
   - [x] Remote tools execute via POST with JSON args/response
8. **Policy inheritance & composition** <small>(Alpha)</small>
   - [x] `extends` field in policies (file path or inline object)
   - [x] `composePolicies()` merges allow/deny/confirmation/budget
   - [x] Budget takes the minimum across composed policies
9. **Structured logging & OpenTelemetry** <small>(Experimental)</small>
   - [x] `createStructuredLogger()` with timestamps, traceId, spanId
   - [x] `--log-json` flag for JSON event output
   - [x] `--otlp-endpoint` flag exports traces in OTLP format
   - [x] `exportToOTLP()` API for programmatic export
10. **CI & publishing** <small>(Alpha)</small>
    - [x] `setup-aex` GitHub Action (`action/action.yml`)
    - [x] npm publish config (`publishConfig`, `exports`, `repository` on all packages)
    - [x] `scripts/prepublish.sh` rewrites `file:` deps to versioned refs
11. **Policy files & merge semantics** <small>(Alpha)</small>
    - [x] `policy workspace v0` keyword for ambient security boundaries
    - [x] `aex init --policy` scaffolds `.aex/policy.aex`
    - [x] Merge semantics: allow = intersection, deny = union, confirm = union, budget = min
    - [x] `aex effective` previews merged permissions before running
    - [x] Parser-level validation: policy files reject `need`, `do`, `make`, `check`, `return`
12. **MCP proxy** <small>(Alpha)</small>
    - [x] `aex proxy -- <cmd>` gates MCP tool calls against policy
    - [x] Auto-discovers `.aex/policy.aex`
    - [x] Budget enforcement, confirmation gates, allow/deny filtering
    - [x] Structured JSON audit logging to stderr
    - [x] `tools/list` response filtering
13. **Claude Code hook enforcement** <small>(Alpha)</small>
    - [x] `aex gate` PreToolUse hook gates built-in tools (Read, Write, Bash, etc.)
    - [x] Tool name mapping: Claude Code PascalCase → AEX dotted capabilities
    - [x] Budget state persistence across hook invocations
    - [x] `allow` keyword for policy files, `AEX120`/`AEX121` diagnostics
    - [x] `task` keyword as alternative to `agent`
   - [x] Fail-closed by default (denies all when no policy found)
14. **Draft → Review → Run workflow** <small>(Alpha)</small>
    - [x] `aex draft` generates task contracts from natural language prompts
    - [x] `aex review` shows human-readable contract summary with effective permissions
    - [x] `aex review --run` prompts for approval then executes through runtime
    - [x] `aex classify` classifies prompts as exploratory/contract_recommended/contract_required
    - [x] `.aex/runs/` directory for generated one-off contracts
    - [x] Audit log output (`.audit.jsonl`) for executed contracts
    - [x] `aex run` auto-discovers `.aex/policy.aex` and supports `.aex` policy files
    - [x] LLM-powered contract generation with validation loop and retry

## Up Next

- Stable API guarantees (v1.0 milestone)
- Independent security audit

## Not Yet Done

- No stable API guarantees
- No independent security audit

Contributions are welcome — open an issue if you'd like to tackle an item or propose a new milestone.
