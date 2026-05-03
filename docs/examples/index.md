# Examples

Concrete contracts show how to apply AEX to real workflows. Each example pairs a `.aex` file with inputs, policy, and expected behavior.

## Hand-written contracts

- [Fix Failing Test](fix-test.md) — file ops, diff checks, test verification
- [Review Pull Request](review-pr.md) — read-only review with structured output
- [Support Ticket Reply](support-ticket.md) — CRM integration, draft-only pattern
- [Research Brief](research-brief.md) — web research with budget enforcement
- [Threat Monitor](security.md) — pre/post verification, git patches, human gates

## Generated contracts

You can also generate contracts from natural language:

```bash
# Draft from a prompt
aex draft "fix the failing test in src/foo.ts" --model anthropic

# Review what it will do
aex review .aex/runs/fix-test.aex

# Approve and execute
aex review .aex/runs/fix-test.aex --run
```

Generated contracts are saved to `.aex/runs/` and validated against your repo policy before execution.

Looking for something else? Open an issue or contribute an example contract.
