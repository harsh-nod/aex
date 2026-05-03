# Codex CLI

AEX provides two ways to enforce contracts with [OpenAI Codex CLI](https://github.com/openai/codex):

1. **MCP Proxy** (recommended) — `aex proxy` sits between Codex and upstream MCP servers, gating every tool call against your policy
2. **Static validation** — `aex check` validates contracts before a Codex run

## MCP Proxy Setup

### 1. Create a policy

```bash
aex init --policy
```

This scaffolds `.aex/policy.aex`:

```aex
policy workspace v0

goal "Default security boundary for this repository."

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

### 2. Preview effective permissions

```bash
aex effective
```

To see how a task contract narrows the policy:

```bash
aex effective --contract tasks/fix-bug.aex
```

### 3. Run with the proxy

Start the proxy between Codex and your MCP server:

```bash
aex proxy --auto-confirm -- npx -y your-mcp-server
```

The proxy auto-discovers `.aex/policy.aex`. To also apply a task contract:

```bash
aex proxy --contract tasks/fix-bug.aex -- npx -y your-mcp-server
```

### What the proxy does

- **Filters `tools/list`** — removes tools not in the allow list or in the deny list
- **Gates `tools/call`** — blocks denied tools, unapproved tools, and budget-exceeded calls
- **Enforces confirmation** — blocks tools requiring confirmation (pass `--auto-confirm` to bypass)
- **Emits audit logs** — every decision is logged as structured JSON to stderr

## Static Validation

Validate contracts before running:

```bash
# Validate contract syntax and semantics
aex check tasks/fix-bug.aex

# Validate policy file
aex check .aex/policy.aex
```

### CI Integration

Validate contracts on every push to catch permission drift:

```yaml
- name: Validate AEX contracts
  run: |
    npx @aex-lang/cli check tasks/*.aex
    npx @aex-lang/cli check .aex/policy.aex
    npx @aex-lang/cli fmt tasks/*.aex --check
```

## Merge Semantics

When a policy and task contract are both active, effective permissions are the most restrictive combination:

- **Allow** = policy allow &cap; task use (intersection)
- **Deny** = policy deny &cup; task deny (union)
- **Confirm** = policy confirm &cup; task confirm (union)
- **Budget** = min(policy budget, task budget)

## Audit Trail

The proxy emits structured JSON to stderr for every decision. Each event includes timestamps for correlation:

```bash
aex proxy 2>audit.json -- npx -y your-mcp-server
```

For `aex run`, pass `--log-json` or `--otlp-endpoint` for structured logs with OpenTelemetry-compatible trace IDs.

## Contract Mode

For tasks that modify code, use the draft → review → run workflow:

```bash
# Generate a contract from a prompt
aex draft "fix the failing test in src/foo.ts" --model openai

# Review it
aex review .aex/runs/20260502-fix-test.aex

# Approve and execute
aex review .aex/runs/20260502-fix-test.aex --run --model openai
```

Or ask Codex to write the contract directly, then validate and run:

```bash
aex check .aex/runs/fix-test.aex
aex review .aex/runs/fix-test.aex --run
```

The runtime enforces tool permissions, checks, confirmations, and budgets. The model generates artifacts inside bounded `make` steps — it cannot directly write files or call tools outside the contract.

## Session Checkpoints

The proxy's meta-tools let Codex checkpoint and resume sessions across conversations.

### Save Progress

Mid-session, Codex can save the current state:

```
Codex: calls aex.checkpoint({ name: "fix-auth", description: "Identified the bug" })
```

This writes the audit log, budget state, and tool call history to `.aex/checkpoints/fix-auth/`.

### Resume Later

In a new session, Codex can resume:

```
Codex: calls aex.resume({ name: "fix-auth" })
```

The proxy restores the budget counter and returns the session context (what tools were called, what was accomplished) so Codex can continue without repeating work.

### Discover Contracts

Codex can list available task contracts and checkpoints:

```
Codex: calls aex.list_tasks()
Codex: calls aex.run_task({ task: "tasks/fix-test.aex" })
```

Meta-tools are automatically available when using `aex proxy`. See the [Meta-Tools Reference](/reference/meta-tools) for full details.

## Troubleshooting

### Proxy not intercepting calls

Make sure the upstream command comes after `--`:

```bash
# Correct
aex proxy -- npx -y your-mcp-server

# Wrong — proxy tries to parse npx as a flag
aex proxy npx -y your-mcp-server
```

### Policy not found

The proxy auto-discovers `.aex/policy.aex` in the working directory. If your policy is elsewhere:

```bash
aex proxy --policy path/to/policy.aex -- npx -y your-mcp-server
```

### Tools missing from Codex

The proxy filters `tools/list` responses, removing tools that are denied or not allowed. If a tool disappears, check your policy's `allow` and `deny` lists:

```bash
aex effective
```

### Budget resets

Budget is tracked per proxy session. Restarting the proxy resets the counter. Use [checkpoints](/workflows/checkpoint-resume) to persist budget state across sessions.

## See Also

- [Language Overview](/language/overview) — AEX policy and task syntax
- [Claude Code Integration](/integrations/claude-code) — same proxy approach for Claude Code
- [CLI Reference](/reference/cli) — full list of CLI flags
- [Policy-Only Mode](/workflows/policy-mode) — step-by-step setup walkthrough
