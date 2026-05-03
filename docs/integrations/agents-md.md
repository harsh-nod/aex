# AGENTS.md

AEX complements, not replaces, `AGENTS.md`. Keep AGENTS.md for repository-wide guidance and architecture notes. Use `.aex` contracts for specific automated tasks with enforceable policies.

## Comparison

| | AGENTS.md | AEX |
| --- | --- | --- |
| **Scope** | Whole repository | One task |
| **Nature** | Human-readable guidance | Executable policy |
| **Content** | Conventions, architecture, test commands | Allowed tools, steps, checks, approvals |
| **Enforcement** | Aspirational (depends on model compliance) | Enforced (runtime blocks violations) |
| **Format** | Free-form Markdown | Structured DSL |

## The Pattern

Use both together. AGENTS.md sets the context; `.aex` contracts enforce the boundaries.

**AGENTS.md** — repository-wide guidance:

```markdown
# AGENTS.md

## Architecture
This is a Node.js monorepo using npm workspaces.

## Testing
Run `npm test` before committing. All tests must pass.

## Security
Never commit .env files. Do not access external APIs during tests.
```

**tasks/fix-test.aex** — task-specific enforcement:

```aex
task fix_test v0

goal "Fix the failing test with the smallest safe change."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior

check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed
return { status: "fixed", patch: patch }
```

**policies/ci.policy.json** — runtime authority boundaries:

```json
{
  "allow": ["file.read", "file.write:src/**", "tests.run"],
  "deny": ["network.*", "secrets.*"],
  "require_confirmation": ["file.write"],
  "budget": { "calls": 20 }
}
```

## Repository Layout

```
repo/
  AGENTS.md                        # repo-wide guidance for agents
  tasks/
    fix-test.aex                   # task: fix a failing test
    review-pr.aex                  # task: review a pull request
  policies/
    local-dev.policy.json          # relaxed policy for local development
    ci.policy.json                 # strict policy for CI
```

## Why Not Just Markdown?

AGENTS.md tells an agent *how you want things done*. An AEX contract tells the runtime *what the agent is allowed to do*. The difference is enforcement:

- AGENTS.md says "don't access external APIs during tests." An agent might comply. It might not.
- `deny network.*` in an AEX contract means the runtime **blocks** any `network.*` tool call. There is no compliance gap.

Both are useful. AGENTS.md provides context and intent. AEX provides guardrails.

## Getting Started

If you already have an `AGENTS.md`, adding AEX takes two steps:

```bash
# 1. Create a policy from your security guidelines
aex init --policy
# Edit .aex/policy.aex to match the rules in your AGENTS.md

# 2. Set up enforcement
# Claude Code: add aex gate hook to .claude/settings.json
# Codex: aex proxy -- npx your-mcp-server
```

Your AGENTS.md continues to guide the model's behavior. The AEX policy enforces the boundaries you defined as guidelines.

## See Also

- [Claude Code Integration](/integrations/claude-code) — hook and proxy setup
- [Codex Integration](/integrations/codex) — proxy setup for Codex CLI
- [Policy Reference](/reference/policy) — policy syntax and merge semantics
- [When to Use What](/workflows/when-to-use-what) — decision guide for policies vs contracts
