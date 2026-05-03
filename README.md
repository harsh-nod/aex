# AEX — The Agent Contract Layer

[![npm version](https://img.shields.io/npm/v/@aex-lang/cli.svg)](https://www.npmjs.com/package/@aex-lang/cli)

> Policies. Contracts. Checkpoints. One format, enforced at runtime.

AEX is a readable contract format that constrains what an AI agent may do, what it must check, and what requires human approval. Install the CLI, add `.aex` files to your repo, and your existing agent stack gains an enforceable contract layer with session persistence.

## How It Works

```
aex draft → aex review → aex run → aex checkpoint → aex resume
```

The model drafts. The human reviews. AEX enforces. Sessions persist.

## Three Layers

```
repo/
  .aex/
    policy.aex          ← always-on repo guardrails
    checkpoints/        ← saved session state
    runs/               ← generated one-off contracts
  tasks/
    fix-test.aex        ← reusable checked-in workflows
```

- **Policy** (`policy workspace v0`) — ambient security boundary for a session or repo
- **Task** (`task fix_test v0`) — specific execution contract for a single task
- **Checkpoint** — saved session state (audit log, budget, tool history) for cross-session continuity

When policy and task are both active, effective permissions are the most restrictive combination: allow is intersected, deny is unioned, budget takes the minimum.

```aex
task fix_test v0

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

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

## Why AEX?

- **Draft → Review → Run:** Generate contracts from natural language. Review permissions before executing. The model proposes, AEX enforces.
- **Runtime Enforcement:** Tool calls, file scopes, diff checks, confirmations, and budgets are enforced at runtime — not by asking the model nicely.
- **Session Checkpoints:** Save mid-session progress. Resume in any MCP client. Cross-client, cross-session continuity.
- **Readable & Diffable:** Contracts are text files. Diff them, review them in PRs, reformat with `aex fmt`.
- **Works With Your Stack:** Claude Code, Codex CLI, MCP servers, OpenAI Agents SDK, LangGraph, GitHub Actions.

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

# Generate a contract from natural language
aex draft "fix the failing test in src/foo.ts" --model anthropic

# Review what it will do
aex review .aex/runs/fix-failing-test.aex

# Approve and execute
aex review .aex/runs/fix-failing-test.aex --run

# Or write contracts by hand
aex init --task fix-test
aex check tasks/fix-test.aex
aex effective --contract tasks/fix-test.aex
aex run tasks/fix-test.aex --inputs inputs.json --auto-confirm
```

## Enforcement

```bash
# Gate Claude Code built-in tools via hook
# .claude/settings.json: { "hooks": { "PreToolUse": [{ "matcher": ".*", "command": "aex gate" }] } }

# Gate MCP tools via proxy (with meta-tools: checkpoint, resume, list, review)
aex proxy -- npx -y your-mcp-server
```

The runtime enforces the intersection of policy and task permissions:

- Tool calls outside the allowed set are blocked
- Confirmation gates halt execution until approved
- Call budgets stop execution when the limit is exceeded
- `aex gate` gates Claude Code built-in tools (Read, Write, Bash, etc.)
- `aex proxy` gates MCP tool calls and exposes meta-tools for checkpoint/resume

## MCP Meta-Tools

The proxy exposes four meta-tools through the MCP protocol:

| Tool | Description |
|------|-------------|
| `aex.checkpoint` | Save session state to disk |
| `aex.resume` | Load a checkpoint and restore state |
| `aex.list_tasks` | List available contracts and checkpoints |
| `aex.review_task` | Review a contract's permissions |

Meta-tools are handled locally by the proxy — never forwarded to upstream. They enable cross-session, cross-client workflows.

## Works With

- Claude Code (via `aex gate` + `aex proxy`)
- Codex CLI (via `aex proxy`)
- MCP servers
- OpenAI Agents SDK
- LangGraph
- GitHub Actions
- VS Code (syntax highlighting + snippets)

## Status

AEX is pre-release software (v0.0.3). All packages are published on npm under the `@aex-lang` scope. Expect API changes before v1.0.

## Documentation

Full documentation at [harsh-nod.github.io/aex](https://harsh-nod.github.io/aex).

## Contributing

We welcome pull requests for examples, adapters, checks, docs, and tooling. See [docs/community/contributing.md](docs/community/contributing.md).

---

**Prompts are not permissions. Plans are not contracts.** Keep your agent. Add a contract.
