# Integrations

AEX wraps around the agent infrastructure you already use. Adapters and gateways translate `.aex` contracts into runtime enforcement.

## Agent platforms

- [Claude Code](claude-code.md) — `aex gate` for built-in tools, `aex proxy` for MCP, contract mode for enforced execution
- [Codex CLI](codex.md) — MCP proxy and contract mode for OpenAI Codex CLI

## SDKs & runtimes

- [MCP Gateway](mcp.md) — `@aex-lang/mcp-gateway` for programmatic MCP enforcement
- [OpenAI Agents SDK](openai-agents.md) — `@aex-lang/openai-agents` guardrail wrapper
- [LangGraph](langgraph.md) — compile contracts into LangGraph plans

## CI & governance

- [GitHub Actions](github-actions.md) — validate contracts on every push
- [AGENTS.md](agents-md.md) — pair AEX enforcement with AGENTS.md conventions
