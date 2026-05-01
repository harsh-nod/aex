# Roadmap

This roadmap outlines the near-term priorities for AEX adoption.

1. **Runtime parity with production agents**
   - [x] Confirm additional built-in checks (`patch touches only`, diff linting)
   - [x] Expand tool registry (structured `file.write`, resilient `tests.run`, `git.*`)
   - [x] Ship JSON IR execution in more adapters
2. **Adapter ecosystem**
   - [x] OpenAI Agents SDK beta (`@aex/openai-agents`)
   - [x] MCP gateway for server-side policies (`@aex/mcp-gateway`)
   - [x] LangGraph compiler (`@aex/langgraph`)
3. **Developer experience**
   - [x] `aex fmt` auto-formatter
   - [x] richer CLI diagnostics with error codes
   - [x] VS Code extension (syntax highlighting, snippets, hover docs)
4. **Security & governance**
   - [x] threat-model reference implementation demos
   - [x] signed task contracts and provenance metadata
   - [x] compatibility tests across runtimes

Contributions are welcome—open an issue if you’d like to tackle an item or propose a new milestone.
