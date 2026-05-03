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

## Pairing with CLAUDE.md

| Aspect | CLAUDE.md | AEX Policy |
|--------|-----------|------------|
| Format | Free-form markdown | Structured DSL |
| Enforcement | Best-effort (model follows instructions) | Deterministic via `aex gate` / `aex proxy` |
| Scope | Session-wide guidance | Session-wide (policy) or per-task (contract) |
| Audit | No built-in logging | Every tool call logged as structured JSON |

Use both together: `CLAUDE.md` for project-wide conventions, AEX policy for enforcing permission boundaries.

## See Also

- [Language Overview](/language/overview) — AEX policy and task syntax
- [Codex Integration](/integrations/codex) — same proxy approach for OpenAI Codex CLI
- [CLI Reference](/reference/cli) — `aex gate`, `aex proxy`, and other commands
