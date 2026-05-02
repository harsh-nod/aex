# Contributing to AEX

Thanks for your interest in contributing to AEX.

## Getting Started

```bash
git clone https://github.com/harsh-nod/aex.git
cd aex
npm install
npm run build
npm test
```

All 8 test suites should pass before you start.

## Development Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `npm test` to verify all tests pass
4. Run `npm run build` to verify TypeScript compilation
5. Open a pull request against `main`

## Project Structure

```
packages/
  aex-parser/       # Parser and compiler (.aex → AST → JSON IR)
  aex-validator/    # Semantic validation
  aex-runtime/      # Local execution engine with built-in tools
  aex-cli/          # CLI (aex check, fmt, compile, run, sign, verify)
  aex-openai-agents/ # OpenAI Agents SDK adapter
  aex-mcp-gateway/  # MCP gateway adapter
  aex-langgraph/    # LangGraph compiler
  aex-vscode/       # VS Code extension
```

## Code Style

- TypeScript strict mode
- Prettier for formatting
- ESLint for linting
- No new runtime dependencies without discussion

## Tests

```bash
npm test              # Run all tests
npm run test:cli      # CLI tests only
```

Tests use Vitest. Add tests for new features and bug fixes.

## What to Work On

Check [open issues](https://github.com/harsh-nod/aex/issues) or the [roadmap](https://harsh-nod.github.io/aex/community/roadmap) for ideas. Open an issue first if you're planning a large change.
