# Roadmap

## Shipped

1. **Runtime parity with production agents**
   - [x] Built-in checks (`patch touches only`, diff linting)
   - [x] Tool registry (`file.write`, `tests.run`, `git.diff`, `git.apply`)
   - [x] JSON IR execution in adapters
2. **Adapter ecosystem**
   - [x] OpenAI Agents SDK (`@aex-lang/openai-agents`)
   - [x] MCP gateway (`@aex-lang/mcp-gateway`)
   - [x] LangGraph compiler (`@aex-lang/langgraph`)
3. **Developer experience**
   - [x] `aex fmt` auto-formatter
   - [x] CLI diagnostics with error codes
   - [x] VS Code extension (syntax highlighting, snippets, hover docs)
   - [x] Interactive playground on docs site
4. **Security & governance**
   - [x] Threat-model reference implementation
   - [x] Signed contracts and provenance metadata
   - [x] Command injection and path traversal prevention
   - [x] Timing-safe signature verification

## Up Next

- Loops and conditional branching in the DSL (`if`, `for`)
- `aex run` support for remote tool registries
- Policy inheritance and composition across contracts
- Structured logging and OpenTelemetry export from `aex run`
- npm package publishing for all adapters

Contributions are welcome — open an issue if you'd like to tackle an item or propose a new milestone.
