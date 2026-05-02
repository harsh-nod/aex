# AGENTS.md

## What is AEX?

AEX is a DSL for writing executable contracts that constrain AI agent behavior. Contracts specify allowed tools, denied tools, confirmation gates, checks, and structured returns. The runtime enforces these constraints before any tool executes.

## Architecture

This is a TypeScript monorepo using npm workspaces.

```
packages/
  aex-parser/        # .aex → AST → JSON IR
  aex-validator/     # Semantic validation (undefined refs, unused tools)
  aex-runtime/       # Execution engine, built-in tools, budget enforcement
  aex-cli/           # CLI commands: check, fmt, compile, run, sign, verify, init
  aex-openai-agents/ # OpenAI Agents SDK adapter
  aex-mcp-gateway/   # MCP gateway adapter
  aex-langgraph/     # LangGraph compiler
  aex-vscode/        # VS Code extension (syntax highlighting, snippets)
```

## Build and Test

```bash
npm install
npm run build    # Compiles all TypeScript packages
npm test         # Runs all Vitest test suites
```

Packages must be built in dependency order. The root `build` script handles this.

## Key Conventions

- All source is TypeScript with strict mode
- No runtime dependencies beyond Node built-ins unless discussed
- Built-in tools (`file.read`, `file.write`, `tests.run`, `git.diff`, `git.apply`) validate all inputs for command injection and path traversal
- Budget enforcement counts both `do` (tool) and `make` (model) steps against the same pool
- The parser is line-oriented: each statement occupies one line, `make` instructions follow as `- ` prefixed lines
- Checks use pattern matching (`has`, `does not include`, `touches only`, `is valid diff`)

## Testing

Tests live alongside packages in `test/` directories. Use `vitest` patterns:

```typescript
import { describe, expect, it } from "vitest";
```

Always test both success and blocked paths for new runtime features.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting process. The runtime is the trust boundary — all enforcement happens there, not in the parser or CLI.
