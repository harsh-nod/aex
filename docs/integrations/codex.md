# Codex CLI

Use AEX contracts to enforce guardrails on [OpenAI Codex CLI](https://github.com/openai/codex) sessions. AEX validates tool permissions before execution, blocks denied actions, and produces audit logs.

## How It Works

Codex CLI runs agents that can read files, write code, and execute commands. AEX contracts define what each task is allowed to do. You validate contracts before the agent runs and enforce policies during execution.

## Setup

### 1. Create a contract

```aex
agent fix_bug v0

goal "Fix the bug described in the issue."

use file.read, file.write, tests.run
deny network.*, secrets.read

need issue_description: str
need target_files: list[file]

do file.read(paths=target_files) -> sources
do tests.run(cmd="npm test") -> baseline

make patch: diff from sources, baseline, issue_description with:
  - fix the described bug
  - do not change unrelated code
  - keep the patch minimal

check patch is valid diff
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd="npm test") -> final

check final.passed

return {
  status: "fixed",
  patch: patch,
  test: final
}
```

### 2. Validate before running

Add a pre-flight check to your workflow:

```bash
# Validate contract syntax and semantics
aex check tasks/fix-bug.aex

# Run with full enforcement
aex run tasks/fix-bug.aex \
  --inputs tasks/fix-bug.inputs.json \
  --policy tasks/fix-bug.policy.json
```

### 3. Use in CI

Validate contracts on every push to catch permission drift:

```yaml
- name: Validate AEX contracts
  run: |
    npx @aex-lang/cli check tasks/*.aex
    npx @aex-lang/cli fmt tasks/*.aex --check
```

## Policy Layering

Codex sessions can combine a base policy (org-wide defaults) with task-specific overrides using policy inheritance:

```json
{
  "extends": "./policies/org-baseline.json",
  "allow": ["file.write:/src/**"],
  "budget": { "calls": 10 }
}
```

The `extends` field loads the base policy and merges permissions. Budget takes the minimum across all layers.

## Audit Trail

Every `aex run` produces structured log events:

```bash
aex run tasks/fix-bug.aex --log-json > audit.json
```

Each event includes timestamps, trace IDs, and span IDs for correlation with OpenTelemetry collectors.

## See Also

- [OpenAI Agents SDK](/integrations/openai-agents) — programmatic adapter for OpenAI agents
- [CLI Reference](/reference/cli) — full list of CLI flags
- [Policy Reference](/reference/policy) — runtime policy enforcement rules
