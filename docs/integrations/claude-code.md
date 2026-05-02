# Claude Code

AEX contracts pair with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to declare what a task is allowed to do. You can validate contracts statically with `aex check`, run full enforcement via `aex run`, or wire either into Claude Code hooks as a pre-flight gate.

## How It Works

Claude Code supports **hooks** — shell commands that run before or after tool calls. You can wire `aex check` into a hook to validate that a contract is well-formed before each tool call. For full runtime enforcement (tool blocking, budget limits, confirmation gates), use `aex run` separately.

## Setup

### 1. Create a contract

```aex
agent code_review v0

goal "Review code changes without modifying files."

use git.diff, git.status, file.read
deny file.write, network.*, secrets.read

need repo_path: str

do git.diff() -> changes
do git.status() -> status

make review: markdown from changes, status with:
  - summarize what changed
  - flag potential issues
  - do not suggest rewrites longer than 10 lines

check review has "Summary"

return review
```

### 2. Add a validation hook

In your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "aex check tasks/code-review.aex"
          }
        ]
      }
    ]
  }
}
```

This runs `aex check` before every tool call, validating that the contract is well-formed. Note: `aex check` performs static validation (syntax, semantics, permission consistency) — it does not intercept or block Claude Code's own tool calls at runtime.

### 3. Run with policy enforcement

For full runtime enforcement with budget limits and confirmation gates:

```bash
aex run tasks/code-review.aex \
  --inputs tasks/code-review.inputs.json \
  --policy tasks/code-review.policy.json \
  --log-json
```

## Pairing with CLAUDE.md

`CLAUDE.md` provides natural-language guidance that Claude follows voluntarily. AEX contracts declare permissions in a structured DSL that `aex run` enforces deterministically.

| Aspect | CLAUDE.md | AEX Contract |
|--------|-----------|--------------|
| Format | Free-form markdown | Structured DSL |
| Enforcement | Best-effort (model follows instructions) | Deterministic when run via `aex run` |
| Scope | Session-wide guidance | Per-task permissions |
| Audit | No built-in logging | Every step logged as structured JSON |

Use both together: `CLAUDE.md` for project-wide conventions, AEX for declaring and enforcing task-level permissions via `aex run`.

## Structured Logging

Pass `--log-json` or `--otlp-endpoint` to get machine-readable audit trails:

```bash
aex run tasks/review.aex --log-json 2>audit.json
```

The JSON output includes traceId and spanId fields compatible with OpenTelemetry collectors.

## See Also

- [AGENTS.md Integration](/integrations/agents-md) — how AGENTS.md and AEX complement each other
- [CLI Reference](/reference/cli) — full list of CLI flags
- [Policy Reference](/reference/policy) — runtime policy enforcement rules
