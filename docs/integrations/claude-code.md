# Claude Code

Use AEX contracts to enforce guardrails on [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. AEX validates tool permissions, blocks denied actions, and logs every decision — complementing the guidance you put in `CLAUDE.md` with machine-enforceable policy.

## How It Works

Claude Code supports **hooks** — shell commands that run before or after tool calls. You can wire `aex check` and `aex run` into these hooks to validate contracts automatically.

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

This runs `aex check` before every tool call, catching contract violations before they execute.

### 3. Run with policy enforcement

For full runtime enforcement with budget limits and confirmation gates:

```bash
aex run tasks/code-review.aex \
  --inputs tasks/code-review.inputs.json \
  --policy tasks/code-review.policy.json \
  --log-json
```

## Pairing with CLAUDE.md

`CLAUDE.md` provides natural-language guidance that Claude follows voluntarily. AEX contracts provide machine-enforced constraints that the runtime blocks on violation.

| Aspect | CLAUDE.md | AEX Contract |
|--------|-----------|--------------|
| Format | Free-form markdown | Structured DSL |
| Enforcement | Best-effort (model follows instructions) | Deterministic (runtime blocks violations) |
| Scope | Session-wide guidance | Per-task permissions |
| Audit | No built-in logging | Every step logged as structured JSON |

Use both together: `CLAUDE.md` for project-wide conventions, AEX for security-critical task boundaries.

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
