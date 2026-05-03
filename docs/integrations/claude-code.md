# Claude Code

AEX provides three ways to enforce policies with [Claude Code](https://docs.anthropic.com/en/docs/claude-code):

1. **`aex gate`** (recommended) — PreToolUse hook that gates every built-in tool call (Read, Write, Bash, etc.) against your policy
2. **`aex proxy`** — MCP proxy that gates tool calls from upstream MCP servers
3. **Both together** — full coverage of built-in and MCP tools

> **Important:** AEX only guards tool calls routed through it. `aex gate` covers Claude Code's built-in tools, `aex proxy` covers MCP tools. Use both for complete enforcement.

## Built-in Tool Enforcement (`aex gate`)

`aex gate` is a Claude Code `PreToolUse` hook. It intercepts every tool call — including built-in tools like Read, Write, Edit, Bash, Glob, and Grep — and evaluates them against your AEX policy.

### 1. Create a policy

```bash
aex init --policy
```

### 2. Configure the hook

Add to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "command": "aex gate"
      }
    ]
  }
}
```

### Tool name mapping

Claude Code uses PascalCase tool names. `aex gate` maps them to AEX capabilities:

| Claude Code Tool | AEX Capability |
|------------------|----------------|
| Read | file.read |
| Write, Edit, MultiEdit | file.write |
| Glob, Grep, LS | file.read |
| Bash | shell.exec |
| WebFetch | network.fetch |
| WebSearch | network.search |
| NotebookRead | file.read |
| NotebookEdit | file.write |
| Agent | agent.spawn |

Write your policy using the AEX capability names:

```aex
policy workspace v0

goal "Default security boundary for this repository."

allow file.read, file.write, tests.run, shell.exec
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

With this policy, `WebFetch` and `WebSearch` are blocked (they map to `network.*`), `Write` requires confirmation (maps to `file.write`), and all calls are capped at 100.

### How it works

For each tool call, Claude Code sends JSON on stdin:

```json
{
  "session_id": "abc-123",
  "tool_name": "Write",
  "tool_input": { "file_path": "/src/foo.ts", "content": "..." }
}
```

`aex gate` responds with a permission decision:

- **Allow:** `{ "permissionDecision": "allow" }`
- **Deny:** `{ "permissionDecision": "deny", "reason": "..." }`
- **Confirm:** `{ "permissionDecision": "ask", "message": "..." }` — prompts the user

## MCP Tool Enforcement (`aex proxy`)

For tools provided by MCP servers, use `aex proxy` to gate every call:

```json
{
  "mcpServers": {
    "tools": {
      "command": "aex",
      "args": ["proxy", "--", "npx", "-y", "your-mcp-server"]
    }
  }
}
```

The proxy auto-discovers `.aex/policy.aex`. To also apply a task contract:

```json
{
  "mcpServers": {
    "tools": {
      "command": "aex",
      "args": [
        "proxy",
        "--contract", "tasks/fix-test.aex",
        "--", "npx", "-y", "your-mcp-server"
      ]
    }
  }
}
```

The proxy filters `tools/list` responses, gates `tools/call` requests, enforces budgets and confirmations, and logs every decision as structured JSON to stderr.

## Full Coverage Setup

For complete enforcement over both built-in and MCP tools:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "command": "aex gate"
      }
    ]
  },
  "mcpServers": {
    "tools": {
      "command": "aex",
      "args": ["proxy", "--", "npx", "-y", "your-mcp-server"]
    }
  }
}
```

### Preview effective permissions

```bash
# Policy only
aex effective

# Policy + task contract
aex effective --contract tasks/fix-test.aex
```

## `aex proxy` vs `aex run`

| Command | Purpose | When to use |
|---------|---------|-------------|
| `aex gate` | PreToolUse hook — gates Claude Code's built-in tools | Always-on policy enforcement |
| `aex proxy` | MCP proxy — gates upstream MCP tool calls | MCP server enforcement during interactive sessions |
| `aex run` | Execute a specific task contract end-to-end | One-shot contract execution with full audit trail |

`aex gate` and `aex proxy` are real-time enforcement layers. `aex run` parses a contract, runs each step, and exits.

## Contract Mode

For tasks that modify code, use AEX's draft → review → run workflow instead of letting Claude freestyle:

### Pattern 1: Draft with `aex draft`

```bash
aex draft "fix the failing test in src/foo.ts" --model anthropic
aex review .aex/runs/20260502-fix-test.aex --run
```

Claude generates a constrained AEX task contract. You review the contract — tool permissions, checks, confirmations — then AEX executes it with full enforcement.

### Pattern 2: Claude drafts, AEX runs

Ask Claude to write an AEX contract directly:

```
> Draft an AEX task contract that fixes the failing test in src/foo.ts
```

Save Claude's output to `.aex/runs/fix-test.aex`, then:

```bash
aex check .aex/runs/fix-test.aex
aex review .aex/runs/fix-test.aex --run
```

### When to use which mode

| Situation | Mode |
|-----------|------|
| Exploring code, reading files | Exploratory — policy via gate/proxy |
| Fixing bugs, writing code | Contract — `aex draft` + `aex review --run` |
| Deploying, migrating | Contract with strict approvals |

**Key principle:** The model drafts. The human reviews. AEX executes. Claude does not freestyle edits in contract mode.

## Session Checkpoints

The proxy's meta-tools let Claude checkpoint and resume sessions across conversations.

### Save Progress

Mid-session, Claude can save the current state:

```
Claude: calls aex.checkpoint({ name: "fix-auth", description: "Identified the bug" })
```

This writes the audit log, budget state, and tool call history to `.aex/checkpoints/fix-auth/`.

### Resume Later

In a new session, Claude can resume:

```
Claude: calls aex.resume({ name: "fix-auth" })
```

The proxy restores the budget counter and returns the session context (what tools were called, what was accomplished) so Claude can continue without repeating work.

### Discover Contracts

Claude can list available task contracts and checkpoints:

```
Claude: calls aex.list_tasks()
Claude: calls aex.review_task({ task: "tasks/fix-test.aex" })
```

Meta-tools are automatically available when using `aex proxy`. See the [Meta-Tools Reference](/reference/meta-tools) for full details.

## Pairing with CLAUDE.md

| Aspect | CLAUDE.md | AEX Policy |
|--------|-----------|------------|
| Format | Free-form markdown | Structured DSL |
| Enforcement | Best-effort (model follows instructions) | Deterministic via `aex gate` / `aex proxy` |
| Scope | Session-wide guidance | Session-wide (policy) or per-task (contract) |
| Audit | No built-in logging | Every tool call logged as structured JSON |

Use both together: `CLAUDE.md` for project-wide conventions, AEX policy for enforcing permission boundaries.

## Troubleshooting

### Hook not firing

Verify your `.claude/settings.json` is valid JSON and the hook is under `PreToolUse`:

```bash
cat .claude/settings.json | python3 -m json.tool
```

The `matcher` must be `".*"` to catch all tools. Check that `aex` is on your PATH:

```bash
which aex
```

### Policy not found

`aex gate` **fails closed by default** — if no policy is found, all tool calls are denied. Create a policy with `aex init --policy`, or pass one explicitly:

```json
{ "matcher": ".*", "command": "aex gate --policy path/to/policy.aex" }
```

To allow all calls when no policy exists (not recommended), pass `--allow-no-policy`:

```json
{ "matcher": ".*", "command": "aex gate --allow-no-policy" }
```

### Tool blocked unexpectedly

Check which AEX capability the tool maps to:

| If blocked | Maps to | Check your policy for |
|---|---|---|
| Bash | `shell.exec` | `allow shell.exec` |
| WebFetch | `network.fetch` | Not in `deny network.*` |
| Write | `file.write` | `allow file.write`, not `deny file.*` |

Run `aex effective` to see the merged permissions:

```bash
aex effective
```

### Budget exhausted mid-session

The budget resets per session. If you're hitting limits, increase the budget in your policy:

```aex
budget calls=200
```

Or use `aex proxy` with `--auto-confirm` for automated workflows where confirmation prompts would block:

```bash
aex proxy --auto-confirm -- npx your-mcp-server
```

## See Also

- [Language Overview](/language/overview) — AEX policy and task syntax
- [Codex Integration](/integrations/codex) — same proxy approach for OpenAI Codex CLI
- [CLI Reference](/reference/cli) — `aex gate`, `aex proxy`, and other commands
- [Policy-Only Mode](/workflows/policy-mode) — step-by-step setup walkthrough
