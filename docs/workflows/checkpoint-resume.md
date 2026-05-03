# Checkpoint and Resume

Save session state mid-task and resume later — in the same client or a different one. Checkpoints preserve budget counters, tool call history, and audit logs so enforcement continues where you left off.

## What Checkpoints Save

```
.aex/checkpoints/<name>/
  checkpoint.json    # metadata, budget state, tool call history
  audit.jsonl        # all audit events from the session
```

A checkpoint captures:
- **Budget consumed** — how many calls have been used
- **Tool call history** — every tool call and its decision (forward/block)
- **Audit events** — the full structured log up to that point

## 1. Start Work Under the Proxy

Checkpoints are managed by `aex proxy` meta-tools. Start a session with the proxy:

```bash
aex proxy -- npx -y your-mcp-server
```

The proxy auto-discovers `.aex/policy.aex` and exposes four meta-tools alongside your upstream tools:

| Meta-tool | Description |
|---|---|
| `aex.checkpoint` | Save session state to disk |
| `aex.resume` | Load a checkpoint and restore state |
| `aex.list_tasks` | List available contracts and checkpoints |
| `aex.run_task` | Review a contract's permissions |

The agent works normally — reading files, running tests, making changes — all gated by the policy.

## 2. Save a Checkpoint

When the agent reaches a good stopping point, it calls the checkpoint meta-tool:

```
Agent: calls aex.checkpoint({
  name: "fix-auth",
  description: "Read auth files, identified the bug in token validation"
})
```

Response:

```json
{
  "path": ".aex/checkpoints/fix-auth/",
  "message": "Checkpoint \"fix-auth\" saved to .aex/checkpoints/fix-auth/"
}
```

The checkpoint is written to disk. The session can end.

### checkpoint.json

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

## 3. Resume in a New Session

Start a new session (same client or different) and resume:

```
Agent: calls aex.resume({ name: "fix-auth" })
```

Response:

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

The proxy restores the budget counter (5 calls already used, 95 remaining) and the tool call history. The agent gets a summary of what happened before, so it can continue without repeating work.

## Cross-Client Resume

Checkpoints are files on disk. A session started in Claude Code can be resumed in Codex — or any MCP client.

```bash
# Session 1: Claude Code
# Agent works, checkpoints as "fix-auth"

# Session 2: Codex CLI (same repo)
aex proxy -- npx your-mcp-server
# Agent calls aex.resume("fix-auth") and picks up where Claude left off
```

The enforcement state transfers: same policy, same budget counter, same audit trail.

## Discovering Checkpoints

The agent can list available contracts and checkpoints:

```
Agent: calls aex.list_tasks()
```

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

This scans `tasks/*.aex`, `.aex/runs/*.aex`, and `.aex/checkpoints/*/`.

## What Gets Restored — and What Doesn't

**Restored:**
- Budget counter (continues from where it left off)
- Tool call history (full record of what was called and decisions)
- Audit log (all structured events from the session)

**Not restored:**
- Model conversation context — the LLM gets a summary of what happened, not the full conversation history. It uses the checkpoint metadata to understand where it left off.
- File changes — checkpoints don't track file modifications. The files are already on disk in the repo.

> **Note:** Checkpoints are for enforcement continuity, not conversation replay. The agent reads the checkpoint summary and continues working based on the current repo state.

## See Also

- [Meta-Tools Reference](/reference/meta-tools) — full API for all four meta-tools
- [Claude Code Integration](/integrations/claude-code) — session checkpoints in Claude Code
- [Codex Integration](/integrations/codex) — session checkpoints in Codex CLI
