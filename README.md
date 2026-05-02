# AEX

> **Executable contracts for AI agents.** Prompts are not permissions.

AEX is a tiny, readable contract format that constrains what an AI agent may do, what it must check, and what requires human approval. Install the CLI, add `.aex` files to your repo, and your existing agent stack gains an enforceable contract layer.

AEX has two file types:

- **Policy** (`policy workspace v0`) — ambient security boundary for an entire session or repo
- **Task** (`agent fix_test v0`) — specific execution contract for a single task

When both are active, the effective permissions are the most restrictive combination.

```aex
agent fix_test v0

goal "Fix the failing test with the smallest safe change."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior
  - do not touch unrelated files

check patch is valid diff
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed

return {
  status: "fixed",
  patch: patch,
  test: final
}
```

And the policy that governs it:

```aex
policy workspace v0

goal "Default security boundary for this repository."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

## Why AEX?

- **Readable:** Learn the format from one file.
- **Enforceable:** Tool use, checks, and human approvals are encoded and auditable.
- **Portable:** Works alongside OpenAI Agents SDK, MCP, LangGraph, GitHub Actions, and any custom runtime.
- **Diffable:** Task contracts live as text files, reviewable like code.

## Install

```bash
npm install -g @aex-lang/cli
```

Or run without installing:

```bash
npx @aex-lang/cli check tasks/fix-test.aex
```

All `@aex-lang/*` packages are published on npm. To install individual packages:

```bash
npm install @aex-lang/parser @aex-lang/runtime
```

## Quickstart

```bash
# Create a policy boundary for your repo
aex init --policy

# Create a task contract
aex init --task fix-test

# Validate both
aex check .aex/policy.aex
aex check tasks/fix-test.aex

# See effective permissions
aex effective --contract tasks/fix-test.aex

# Run with enforcement
aex run tasks/fix-test.aex --inputs inputs.json --auto-confirm

# Enforce with Claude Code (built-in tools via hook)
# In .claude/settings.json: { "hooks": { "PreToolUse": [{ "matcher": ".*", "command": "aex gate" }] } }

# Enforce MCP tools via proxy
aex proxy -- npx -y your-mcp-server
```

The runtime enforces the intersection of policy and task permissions:

- tool calls outside the allowed set are blocked
- confirmation gates halt execution until approved
- call budgets stop execution when the limit is exceeded
- `aex gate` gates Claude Code built-in tools (Read, Write, Bash, etc.)
- `aex proxy` gates MCP tool calls against your `.aex/policy.aex`

`aex fmt` keeps contracts deterministic (use `--check` in CI), and `aex sign`/`aex verify` attach HMAC-backed provenance metadata for governance workflows.

## Works with

- Claude Code (via `aex proxy`)
- Codex CLI (via `aex proxy`)
- MCP servers
- OpenAI Agents SDK
- LangGraph
- GitHub Actions
- VS Code (syntax highlighting + snippets)

## Status

AEX is pre-release software (v0.0.3). All packages are published on npm under the `@aex-lang` scope. Expect API changes before v1.0.

## Documentation

The documentation site is published via GitHub Pages: once Actions completes, visit https://harsh-nod.github.io/aex for the latest guides.

## Contributing

We welcome pull requests for examples, adapters, checks, docs, and tooling. See [docs/community/contributing.md](docs/community/contributing.md) once the contribution guide is published.

---

**Prompts are not permissions.** Keep your agent. Add a contract.
