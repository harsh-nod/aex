# Claude Code

AEX provides two ways to enforce contracts with [Claude Code](https://docs.anthropic.com/en/docs/claude-code):

1. **MCP Proxy** (recommended) — `aex proxy` sits between Claude Code and upstream MCP servers, gating every tool call against your policy
2. **Hooks** — `aex check` runs as a pre-flight validation hook

## MCP Proxy Setup

The proxy intercepts every tool call, enforces allow/deny lists, budgets, and confirmation gates, and emits structured audit logs.

### 1. Create a policy

```bash
aex init --policy
```

This scaffolds `.aex/policy.aex`:

```aex
policy workspace v0

goal "Default security boundary for this repository."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

### 2. Preview effective permissions

```bash
aex effective
```

Output:

```
Policy:   .aex/policy.aex

Allowed:
  file.read
  file.write
  tests.run
  git.*

Denied:
  network.*
  secrets.read

Confirmation required:
  file.write

Budget:
  calls=100
```

To see how a task contract narrows the policy:

```bash
aex effective --contract tasks/fix-test.aex
```

### 3. Configure Claude Code to use the proxy

In your `.claude/settings.json`, point your MCP server through `aex proxy`:

```json
{
  "mcpServers": {
    "tools": {
      "command": "aex",
      "args": ["proxy", "--upstream", "your-mcp-server", "--auto-confirm"]
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
        "--upstream", "your-mcp-server",
        "--contract", "tasks/fix-test.aex"
      ]
    }
  }
}
```

### What the proxy does

- **Filters `tools/list`** — removes tools not in the allow list or in the deny list
- **Gates `tools/call`** — blocks denied tools, unapproved tools, and budget-exceeded calls
- **Enforces confirmation** — blocks tools requiring confirmation (pass `--auto-confirm` to bypass)
- **Emits audit logs** — every decision is logged as structured JSON to stderr

## Hooks (Static Validation)

For lighter-weight validation without proxying, use `aex check` as a Claude Code hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "aex check .aex/policy.aex"
          }
        ]
      }
    ]
  }
}
```

Note: `aex check` performs static validation only — it does not intercept or block tool calls at runtime. Use the MCP proxy for runtime enforcement.

## Pairing with CLAUDE.md

| Aspect | CLAUDE.md | AEX Policy |
|--------|-----------|------------|
| Format | Free-form markdown | Structured DSL |
| Enforcement | Best-effort (model follows instructions) | Deterministic via `aex proxy` |
| Scope | Session-wide guidance | Session-wide (policy) or per-task (contract) |
| Audit | No built-in logging | Every tool call logged as structured JSON |

Use both together: `CLAUDE.md` for project-wide conventions, AEX policy for enforcing permission boundaries.

## See Also

- [Language Overview](/language/overview) — AEX policy and task syntax
- [Codex Integration](/integrations/codex) — same proxy approach for OpenAI Codex CLI
- [CLI Reference](/reference/cli) — full list of CLI flags
