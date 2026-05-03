# When to Use What

AEX has three layers: **policies**, **task contracts**, and **checkpoints**. You don't need all of them at once. This guide helps you pick the right combination for your situation.

## Decision Table

| Your situation | What to use | Why |
|---|---|---|
| Constrain agent exploration | Policy only | No contract needed for read/explore tasks |
| Execute a specific change | Policy + Task contract | Contract defines steps, checks, and output |
| Resume work across sessions | Policy + Task + Checkpoint | Saves budget and state for later |
| Generate contracts from prompts | `aex draft` + `aex review` | Model proposes, human reviews |
| Gate PRs in CI | `aex check` + `aex fmt` | Validate contracts before merge |

## Policy Alone

Use a policy when the agent is exploring, reading code, or answering questions. The policy sets the boundary — what's allowed, what's blocked, what needs confirmation — without prescribing steps.

```bash
aex init --policy
```

This is enough when:
- You want to prevent network access or secrets reads
- You want confirmation before file writes
- You don't need structured steps or output checks

See [Policy-Only Mode](/workflows/policy-mode) for the full setup.

## Policy + Contract

Add a task contract when the agent is making changes. Contracts define the steps, checks, and expected output — not just the boundary.

```bash
# Generate from a prompt
aex draft "fix the failing test in src/foo.ts" --model anthropic

# Review permissions before running
aex review .aex/runs/fix-failing-test.aex

# Approve and execute
aex review .aex/runs/fix-failing-test.aex --run
```

Use contracts when you need:
- Structured execution steps (`do`, `make`, `check`)
- Output validation (`check patch is valid diff`)
- Scoped tool access narrower than the policy
- Auditable, reproducible workflows

When both policy and contract are active, effective permissions are the most restrictive combination: allow is intersected, deny is unioned, budget takes the minimum.

See [Draft, Review, and Run](/workflows/draft-review-run) for the full workflow.

## Adding Checkpoints

Checkpoints save session state — budget consumed, tool call history, and audit log — so work can resume later or in a different client.

Use checkpoints when:
- A task is too long for one session
- You want to hand off between Claude Code and Codex
- You need an audit trail that spans sessions

Checkpoints are saved via the `aex.checkpoint` meta-tool and restored with `aex.resume`, both available through `aex proxy`.

See [Checkpoint and Resume](/workflows/checkpoint-resume) for the full workflow.

## CI Validation

Use `aex check` and `aex fmt --check` in your CI pipeline to gate PRs on valid, well-formatted contracts. Add `aex sign` and `aex verify` for provenance tracking.

```bash
aex check tasks/**/*.aex
aex fmt --check tasks/**/*.aex .aex/policy.aex
```

See [CI Validation](/workflows/ci-validation) for GitHub Actions setup and more.

## Combining Everything

The full stack looks like this:

```
repo/
  .aex/
    policy.aex              # ambient security boundary
    checkpoints/fix-auth/   # saved session state
    runs/                   # generated one-off contracts
  tasks/
    fix-test.aex            # reusable checked-in workflow
```

Policy provides the boundary. Contracts define specific jobs. Checkpoints persist state. CI validates everything before merge. You add layers as you need them — start with a policy, add contracts when you're making changes, and add checkpoints when sessions need continuity.

## See Also

- [Policy-Only Mode](/workflows/policy-mode) — enforcement without contracts
- [Draft, Review, and Run](/workflows/draft-review-run) — generate and execute contracts
- [Checkpoint and Resume](/workflows/checkpoint-resume) — cross-session continuity
- [CI Validation](/workflows/ci-validation) — gate PRs on valid contracts
