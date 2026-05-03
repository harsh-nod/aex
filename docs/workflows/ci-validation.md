# CI Validation

Gate pull requests on valid, well-formatted AEX contracts. Catch syntax errors, formatting drift, and permission changes before they merge.

## What to Validate

| Command | What it checks |
|---|---|
| `aex check` | Syntax and semantic validation |
| `aex fmt --check` | Formatting consistency |
| `aex effective` | Merged permission summary |
| `aex review` | Full contract review with warnings |
| `aex verify` | Provenance signature verification |

## GitHub Actions

```yaml
name: AEX Validation
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install AEX CLI
        run: npm install -g @aex-lang/cli

      - name: Validate contracts
        run: |
          for f in tasks/*.aex .aex/runs/*.aex; do
            [ -f "$f" ] && aex check "$f"
          done

      - name: Check formatting
        run: |
          for f in tasks/*.aex .aex/policy.aex; do
            [ -f "$f" ] && aex fmt --check "$f"
          done

      - name: Review permissions
        run: |
          for f in tasks/*.aex; do
            [ -f "$f" ] && echo "--- $f ---" && aex review "$f"
          done
```

This runs on every push and PR. Any invalid contract or formatting violation fails the build.

## Other CI Systems

The same commands work in any CI environment. Install the CLI and run:

```bash
# Install
npm install -g @aex-lang/cli

# Validate all contracts
aex check tasks/*.aex
aex check .aex/policy.aex

# Enforce formatting
aex fmt --check tasks/*.aex .aex/policy.aex

# Show effective permissions (useful for PR review)
aex effective --contract tasks/fix-test.aex
```

## Signing in CI

Attach provenance metadata to contracts during your release process:

```bash
# Sign a contract
aex sign tasks/fix-test.aex --id ci-bot --key-file ./signing.key

# Verify a signature
aex verify tasks/fix-test.aex \
  --signature tasks/fix-test.aex.signature.json \
  --key-file ./signing.key
```

The signature file records the content hash, signer identity, and timestamp. Add verification to CI to ensure contracts haven't been tampered with:

```yaml
- name: Verify contract signatures
  run: |
    for f in tasks/*.aex; do
      sig="${f}.signature.json"
      if [ -f "$sig" ]; then
        aex verify "$f" --signature "$sig" --key-file ./signing.key
      fi
    done
```

## PR Review Pattern

Auto-comment permission summaries on pull requests by piping `aex review` output into your PR tooling:

```bash
# Generate review for changed contracts
for f in $(git diff --name-only origin/main -- 'tasks/*.aex'); do
  echo "## $f"
  aex review "$f"
  echo ""
done
```

This gives reviewers a clear summary of what each contract will do — requested tools, denied tools, checks, and effective permissions — without reading the DSL.

## Policy Validation

Don't forget to validate the policy file itself:

```bash
aex check .aex/policy.aex
aex fmt --check .aex/policy.aex
```

Policy changes affect every contract in the repo. Reviewing policy diffs in PRs is as important as reviewing contract changes.

## See Also

- [CLI Reference](/reference/cli) — flags for `aex check`, `aex fmt`, `aex sign`
- [GitHub Actions Integration](/integrations/github-actions) — additional CI patterns
- [Security Model](/reference/security) — signing and provenance details
