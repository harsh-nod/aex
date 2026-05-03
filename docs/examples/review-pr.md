# Review Pull Request

Guide an agent through analyzing a pull request diff and producing a structured review — with no ability to write files, access the network, or touch secrets.

## Contract

```aex
task review_pr v0

goal "Review a pull request for correctness, risk, and test coverage."

use git.diff, file.read
deny file.write, network.*, secrets.read

need pr_diff: file
need changed_files: list[file]

do git.diff(path=pr_diff) -> diff
do file.read(paths=changed_files) -> sources

make review: markdown from diff, sources with:
  - identify correctness risks
  - highlight missing tests
  - separate blocking issues from suggestions
  - stay focused on changes in this PR

check review has "Blocking issues"
check review has "Suggestions"

return review
```

## Inputs

```json
{
  "pr_diff": "examples/review-pr/sample.diff",
  "changed_files": [
    "src/service.ts",
    "tests/service.test.ts"
  ]
}
```

## Policy

Use an `.aex` policy file for the ambient security boundary:

```aex
policy review v0

goal "Read-only boundary for code review workflows."

allow git.diff, file.read
deny file.write, network.*, secrets.read

budget calls=20
```

Or the equivalent JSON policy:

```json
{
  "allow": [
    "git.diff",
    "file.read:/workspace/src/**",
    "file.read:/workspace/tests/**"
  ],
  "deny": [
    "file.write",
    "network.*",
    "secrets.read"
  ],
  "require_confirmation": []
}
```

## Run It

```bash
aex run examples/review-pr/task.aex \
  --inputs examples/review-pr/inputs.json \
  --policy examples/review-pr/policy.json
```

No `--auto-confirm` needed — the contract has no confirmation gates since the agent only reads, never writes.

## Expected Output

The agent returns a markdown review:

```markdown
## Blocking issues

- `compute()` now throws on negative input but no test covers
  the negative-value path. Add a test before merging.

## Suggestions

- Consider naming the parameter `multiplier` instead of `factor`
  for clarity.
```

## Blocked Actions

The contract explicitly denies `file.write`. If the model tries to apply a fix directly:

```json
{"event":"tool.denied","tool":"file.write","reason":"denied by contract: file.write"}
```

The policy restricts `file.read` to `src/**` and `tests/**` — reading config files, `.env`, or anything else is blocked.

## Audit Log

```json
{"event":"run.started","agent":"review_pr","version":"v0"}
{"event":"tool.allowed","tool":"git.diff","step":1}
{"event":"tool.result","tool":"git.diff","bind":"diff"}
{"event":"tool.allowed","tool":"file.read","step":2}
{"event":"tool.result","tool":"file.read","bind":"sources"}
{"event":"make.result","bind":"review","type":"markdown"}
{"event":"check.passed","condition":"review has \"Blocking issues\""}
{"event":"check.passed","condition":"review has \"Suggestions\""}
{"event":"run.finished","status":"success"}
```

## What This Proves

- **Read-only agent**: `deny file.write` makes this agent purely observational — it cannot modify the repository
- **Structured output**: `check review has "Blocking issues"` enforces that the model produces the expected sections
- **Scoped reads**: the policy limits which directories the agent can read, preventing access to credentials or unrelated code
