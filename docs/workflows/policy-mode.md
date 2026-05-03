# Policy-Only Mode

Constrain what your agent can do without writing a task contract. A policy defines the ambient security boundary — allowed tools, denied tools, confirmation gates, and budget limits — enforced at runtime.

## 1. Create a Policy

```bash
aex init --policy
```

This creates `.aex/policy.aex`:

```aex
policy workspace v0

goal "Default security boundary for this repository."

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

Edit it to match your repo. Each line does one thing:

- **`allow`** — tools the agent can use (supports wildcards like `git.*`)
- **`deny`** — tools that are always blocked, even if allowed elsewhere
- **`confirm before`** — tools that require human approval before each call
- **`budget`** — maximum number of tool calls per session

## 2. Enforce Built-in Tools (Claude Code)

Add the `aex gate` hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": ".*", "command": "aex gate" }
    ]
  }
}
```

`aex gate` maps Claude Code tools to AEX capabilities and gates them against your policy:

| Claude Code Tool | AEX Capability |
|---|---|
| Read | file.read |
| Write, Edit | file.write |
| Bash | shell.exec |
| Agent | agent.spawn |

When a tool is denied, Claude Code sees the block:

```json
{"event": "tool.blocked", "tool": "shell.exec", "reason": "deny_list"}
```

## 3. Enforce MCP Tools

For MCP servers, use `aex proxy`:

```bash
aex proxy -- npx -y your-mcp-server
```

The proxy auto-discovers `.aex/policy.aex` and gates every tool call. To use both `aex gate` and `aex proxy` together:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": ".*", "command": "aex gate" }
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

This gives full coverage: built-in tools gated by the hook, MCP tools gated by the proxy.

## 4. Test It

Start Claude Code in your repo and try something denied:

```
You: "Fetch the latest news from the web"
Claude: [attempts network.fetch]
→ Blocked by policy: deny network.*
```

Try something that needs confirmation:

```
You: "Write a fix to src/foo.ts"
Claude: [attempts file.write]
→ Confirmation required: confirm before file.write
```

The policy enforces boundaries without you writing any contract.

## What's Enforced

- **Allow/deny gating** — tool calls outside the allow list or on the deny list are blocked
- **Confirmation gates** — matching tools halt until approved
- **Budget limits** — execution stops when the call count is exceeded
- **Wildcard matching** — `network.*` matches `network.fetch`, `network.post`, etc.

## When to Upgrade to Contracts

Policy-only mode is enough for exploration and simple tasks. When you need structured steps, output checks, or reproducible workflows, add a task contract:

```bash
aex draft "fix the failing test in src/foo.ts" --model anthropic
aex review .aex/runs/fix-failing-test.aex --run
```

The contract narrows permissions further (effective = policy ∩ task) and adds `do`, `make`, `check`, and `return` steps.

## See Also

- [Draft, Review, and Run](/workflows/draft-review-run) — generate and execute contracts
- [Claude Code Integration](/integrations/claude-code) — full hook and proxy setup
- [Policy Reference](/reference/policy) — all policy keywords and merge semantics
