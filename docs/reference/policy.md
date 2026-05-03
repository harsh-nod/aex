# Policy Reference

Policies define ambient security boundaries that apply to an entire session or repository. When a policy and a task contract are both active, the runtime enforces the most restrictive combination.

## AEX Policy Files

The recommended way to define policies is with `.aex` policy files. Create one with `aex init --policy`:

```aex
policy workspace v0

goal "Default security boundary for this repository."

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

### Syntax

Policy files use the same keywords as task contracts, with these differences:

| Keyword | Meaning in policy |
|---------|-------------------|
| `policy <name> <version>` | Header (replaces `task`/`agent`) |
| `goal` | Human-readable description of the boundary |
| `allow` | Tools available to any task running under this policy (use `allow` in policies, `use` in tasks) |
| `deny` | Tools blocked regardless of what a task requests |
| `confirm before` | Tools requiring human approval |
| `budget calls=N` | Maximum tool invocations per session |

Policy files must **not** contain `need`, `do`, `make`, `check`, or `return` — those belong in task contracts.

### Directory Convention

```
repo/
  .aex/
    policy.aex          # ambient authority boundary (auto-discovered)
    runs/               # generated one-off contracts
      fix-test.aex
      fix-test.audit.jsonl
  tasks/
    fix-test.aex        # reusable checked-in task contracts
    review-pr.aex
```

The CLI auto-discovers `.aex/policy.aex` in the working directory. `tasks/` holds reusable contracts checked into the repo. `.aex/runs/` holds generated one-off contracts from `aex draft` along with their audit logs.

## Merge Semantics

When a policy and a task contract are both active, effective permissions follow this rule:

| Field | Merge rule | Rationale |
|-------|-----------|-----------|
| **allow** | Intersection | A tool must be allowed by *both* policy and task |
| **deny** | Union | A tool denied by *either* is blocked |
| **confirm** | Union | A tool requiring confirmation in *either* must be confirmed |
| **budget** | Minimum | The stricter limit wins |

Preview the effective permissions before running:

```bash
aex effective --contract tasks/fix-test.aex
```

```
Policy:   .aex/policy.aex
Contract: tasks/fix-test.aex

Allowed:
  file.read
  file.write
  tests.run

Denied:
  network.*
  secrets.read

Confirmation required:
  file.write

Budget:
  calls=20
```

## JSON Policy Files

For `aex run --policy`, you can also pass a JSON policy file:

```json
{
  "allow": ["file.read:/workspace/**", "tests.run"],
  "deny": ["file.read:/secrets/**", "network.*"],
  "require_confirmation": ["file.write"],
  "budget": {
    "calls": 20
  }
}
```

### JSON Fields

- `allow`: Capabilities or fully-qualified tool paths granted at runtime.
- `deny`: Capabilities explicitly blocked even if the contract requests them.
- `require_confirmation`: Tools that need a human approval gate.
- `budget`: Numeric limits enforced during execution. `calls` sets the maximum number of `do`/`make` steps that may run; the runtime stops once the limit is hit.

### JSON Schema

The repository ships a JSON Schema for policy files at [schemas/policy.schema.json](https://github.com/harsh-nod/aex/blob/main/schemas/policy.schema.json). The CLI validates policies against this schema automatically when you pass `--policy` to `aex run`.

## Enforcement

The runtime emits audit log events documenting every decision: allowed tool calls, denied requests, confirmations, and budget consumption.

```json
{"event":"tool.denied","tool":"network.fetch","reason":"denied by policy: network.*"}
{"event":"tool.allowed","tool":"file.read","step":1}
{"event":"confirm.required","tool":"file.write"}
{"event":"budget.exhausted","calls_used":100,"budget":100}
```

### Claude Code Hook Enforcement

When using `aex gate` as a Claude Code `PreToolUse` hook, Claude Code's built-in tool names are mapped to AEX capabilities:

| Claude Code Tool | AEX Capability |
|------------------|----------------|
| Read, Glob, Grep, LS | file.read |
| Write, Edit, MultiEdit | file.write |
| Bash | shell.exec |
| WebFetch | network.fetch |
| WebSearch | network.search |
| Agent | agent.spawn |

Write your policy using the AEX capability names. See the [Claude Code integration guide](/integrations/claude-code) for setup.

### MCP Proxy Enforcement

When using `aex proxy`, the policy is enforced on every MCP tool call between your client (Claude Code, Codex) and upstream servers:

```bash
aex proxy -- npx -y your-mcp-server
```

The proxy auto-discovers `.aex/policy.aex` and gates `tools/call` requests against the effective permissions. See the [Claude Code](/integrations/claude-code) and [Codex](/integrations/codex) integration guides for setup details.

## Keywords: `allow` vs `use`

- In **policy** files, use `allow` to declare the ambient tool permissions.
- In **task** files, use `use` to request tools for that specific task.
- `use` in a policy file works as an alias for `allow` for backward compatibility.
- `allow` in a task file is an error (AEX121) — tasks request tools, policies grant them.
