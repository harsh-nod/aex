# Roadmap

This roadmap outlines the near-term priorities for AEX adoption.

1. **Runtime parity with production agents**
   - Confirm additional built-in checks (`patch touches only`, diff linting)
   - Expand tool registry (structured `file.write`, `tests.run`, `git.*`)
   - Ship JSON IR execution in more adapters
2. **Adapter ecosystem**
   - OpenAI Agents SDK beta (`@aex/openai-agents`)
   - MCP gateway for server-side policies (`@aex/mcp-gateway`)
   - LangGraph compiler
3. **Developer experience**
   - `aex fmt` auto-formatter
   - richer CLI diagnostics with error codes
   - VS Code extension (syntax highlighting, snippets, hover docs)
4. **Security & governance**
   - threat-model reference implementation demos
   - signed task contracts and provenance metadata
   - compatibility tests across runtimes

Contributions are welcome—open an issue if you’d like to tackle an item or propose a new milestone.
