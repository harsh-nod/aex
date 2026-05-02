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

## See Also

- [Language Overview](/language/overview) — AEX policy and task syntax
- [Claude Code Integration](/integrations/claude-code) — same proxy approach for Claude Code
- [CLI Reference](/reference/cli) — full list of CLI flags
