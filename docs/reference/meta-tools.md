# Meta-Tools Reference

The AEX proxy exposes four meta-tools through the MCP protocol. These tools are handled locally by the proxy — they are never forwarded to the upstream MCP server. They bypass policy checks because they manage AEX itself, not application resources.

Meta-tools appear automatically in `tools/list` responses when using `aex proxy`. Any MCP client (Claude Code, Codex, custom clients) discovers them alongside upstream tools.

## `aex.checkpoint`

Save the current session state to disk.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Checkpoint name (alphanumeric, dashes, underscores) |
| `description` | string | no | What was accomplished so far |

**What it saves:**

```
.aex/checkpoints/<name>/
  checkpoint.json    # metadata, budget state, tool call history
  audit.jsonl        # all audit events from the session
```

**Example response:**

```json
{
  "path": ".aex/checkpoints/fix-auth/",
  "message": "Checkpoint \"fix-auth\" saved to .aex/checkpoints/fix-auth/"
}
```

**`checkpoint.json` format:**

```json
{
  "name": "fix-auth",
  "description": "Read auth files, identified the bug in token validation",
  "timestamp": "2026-05-02T15:30:12.345Z",
  "callsUsed": 5,
  "budget": 100,
  "toolHistory": [
    { "tool": "file.read", "timestamp": "2026-05-02T15:28:00Z", "decision": "forward" },
    { "tool": "tests.run", "timestamp": "2026-05-02T15:29:00Z", "decision": "forward" },
    { "tool": "network.fetch", "timestamp": "2026-05-02T15:29:30Z", "decision": "block", "reason": "deny_list" }
  ]
}
```

## `aex.resume`

Load a checkpoint and restore session state. The proxy restores the budget counter and tool call history, so enforcement continues from where you left off.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Checkpoint name to resume |

**Example response:**

```json
{
  "name": "fix-auth",
  "description": "Read auth files, identified the bug in token validation",
  "toolsCalled": ["file.read", "tests.run"],
  "callsUsed": 5,
  "budgetRemaining": 95,
  "auditSummary": [
    { "event": "tool.allowed", "data": { "tool": "file.read" } },
    { "event": "tool.allowed", "data": { "tool": "tests.run" } }
  ]
}
```

The response gives the LLM full context about what happened before the checkpoint, so it can continue the work without repeating steps.

## `aex.list_tasks`

List available task contracts and checkpoints in the repository.

**Input:** None.

**Scans:**
- `tasks/*.aex` — reusable hand-written contracts
- `.aex/runs/*.aex` — generated contracts from `aex draft`
- `.aex/checkpoints/*/` — saved checkpoints

**Example response:**

```json
{
  "tasks": [
    {
      "name": "fix_test",
      "path": "tasks/fix-test.aex",
      "type": "task",
      "goal": "Fix the failing test with the smallest safe change.",
      "tools": ["file.read", "file.write", "tests.run"]
    },
    {
      "name": "fix-auth",
      "path": ".aex/checkpoints/fix-auth/",
      "type": "checkpoint",
      "goal": "Read auth files, identified the bug"
    }
  ]
}
```

## `aex.run_task`

Parse and review a task contract, returning a permissions summary without executing it. This lets the LLM understand what a contract will do and whether it runs under the current policy.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | Path to `.aex` file (relative to working directory) |

**Example response:**

```json
{
  "task": "fix_test",
  "goal": "Fix the failing test with the smallest safe change.",
  "requested": ["file.read", "file.write", "tests.run"],
  "denied": ["network.*", "secrets.read"],
  "effective": {
    "allow": ["file.read", "file.write", "tests.run"],
    "deny": ["network.*", "secrets.read"],
    "confirm": ["file.write"],
    "budget": 20
  },
  "checks": ["patch is valid diff", "patch touches only target_files", "final.passed"],
  "makeSteps": ["make patch: diff from failure, sources"],
  "valid": true,
  "warnings": []
}
```

If the task requests tools not allowed by the current policy, the `warnings` array will flag them.

## Workflow: Checkpoint and Resume

### Session 1 — Start work, checkpoint mid-session

```
User: "Fix the auth bug in src/auth.ts"

Claude: [reads files, runs tests, identifies the bug]
Claude: calls aex.checkpoint({ name: "fix-auth", description: "Identified token validation bug" })
  → checkpoint saved to .aex/checkpoints/fix-auth/

Session ends.
```

### Session 2 — Resume in a new session

```
User: "Resume the auth fix"

Claude: calls aex.resume({ name: "fix-auth" })
  → gets back: description, tools called, budget remaining, audit log
  → proxy restores budget counter (5 calls already used)

Claude: continues from where it left off, writes the fix, runs tests
  → still under the same policy, budget continues from 5
```

### Cross-client Resume

Checkpoints are stored as files. A session started in Claude Code can be resumed in Codex (or any MCP client) — the checkpoint data is the same.

```bash
# Session 1: Claude Code
aex proxy -- npx your-mcp-server

# Session 2: Codex CLI (same repo)
aex proxy -- npx your-mcp-server
# Codex calls aex.resume("fix-auth") and picks up where Claude left off
```

## Workflow: List and Review Contracts

The LLM can discover and review available contracts without the user specifying paths:

```
User: "What tasks are available?"

Claude: calls aex.list_tasks()
  → gets list of tasks, runs, and checkpoints

Claude: calls aex.run_task({ task: "tasks/fix-test.aex" })
  → gets permissions summary, checks, make steps

Claude: "The fix-test contract allows file.read, file.write, and tests.run.
         It requires confirmation before file.write and has 3 checks..."
```

## Setup

Meta-tools are automatically available when using `aex proxy`:

```bash
aex proxy -- npx your-mcp-server
```

No additional configuration is needed. The proxy injects meta-tools into the tool list and handles them before any policy evaluation.
