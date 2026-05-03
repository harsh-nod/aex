# GitHub Actions

Validate AEX contracts on every push and pull request. Catch syntax errors, formatting drift, and permission changes before they merge.

## Workflow

```yaml
name: AEX Validation
on:
  pull_request:
  push:
    branches: [main]

jobs:
  aex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install AEX
        run: npm install -g @aex-lang/cli

      - name: Validate contracts
        run: |
          for f in tasks/*.aex .aex/runs/*.aex; do
            [ -f "$f" ] && aex check "$f"
          done

      - name: Validate policy
        run: |
          if [ -f ".aex/policy.aex" ]; then
            aex check .aex/policy.aex
          fi

      - name: Check formatting
        run: |
          for f in tasks/*.aex .aex/policy.aex; do
            [ -f "$f" ] && aex fmt --check "$f"
          done
```

## What Each Step Does

### `aex check`

Validates syntax and semantics:

```bash
$ aex check tasks/fix-test.aex
# exit 0 — valid

$ aex check tasks/bad.aex
# line 8: Tool "network.fetch" is not declared in use.
# exit 1
```

Checks include:
- Valid `task`/`policy` declaration and `goal`
- All tools used in `do` steps are declared in `use`
- No `do` steps call denied tools
- `make` steps reference defined values
- `need` types are valid (`str`, `int`, `bool`, `file`, `url`, `json`, `list[...]`)
- Return statement is present (tasks only)

### `aex fmt --check`

Verifies formatting without rewriting:

```bash
$ aex fmt --check tasks/fix-test.aex
# exit 0 — correctly formatted

$ aex fmt --check tasks/messy.aex
# Formatting differs
# exit 1
```

Use `aex fmt tasks/fix-test.aex` (without `--check`) to auto-fix formatting locally before committing.

### `aex review`

Shows a permission summary for a contract:

```bash
$ aex review tasks/fix-test.aex
# Task:      fix_test
# Goal:      Fix the failing test.
# Requested: file.read, file.write, tests.run
# Denied:    network.*, secrets.read
# Checks:    patch is valid diff, patch touches only target_files, final.passed
# Valid task.
```

## Signing and Verification

Attach provenance metadata in your release workflow, then verify in CI:

```yaml
# In your release job:
- name: Sign contracts
  run: |
    for f in tasks/*.aex; do
      aex sign "$f" --id ci-bot --key-file ./signing.key
    done

# In your validation job:
- name: Verify signatures
  run: |
    for f in tasks/*.aex; do
      sig="${f}.signature.json"
      if [ -f "$sig" ]; then
        aex verify "$f" --signature "$sig" --key-file ./signing.key
      fi
    done
```

The signature file records the content hash, signer identity, and timestamp. If the contract has been modified since signing, verification fails.

## PR Comment Pattern

Auto-comment permission summaries on pull requests:

```yaml
- name: Review changed contracts
  if: github.event_name == 'pull_request'
  run: |
    BODY=""
    for f in $(git diff --name-only origin/main -- 'tasks/*.aex'); do
      if [ -f "$f" ]; then
        BODY="$BODY\n## $f\n\`\`\`\n$(aex review "$f")\n\`\`\`\n"
      fi
    done
    if [ -n "$BODY" ]; then
      echo -e "$BODY" > /tmp/aex-review.md
      gh pr comment ${{ github.event.pull_request.number }} --body-file /tmp/aex-review.md
    fi
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This gives reviewers a clear summary of what each changed contract allows, denies, and checks — without reading the DSL.

## Effective Permissions in CI

Show the merged policy + task permissions for audit:

```yaml
- name: Show effective permissions
  run: |
    for f in tasks/*.aex; do
      [ -f "$f" ] && echo "--- $f ---" && aex effective --contract "$f"
    done
```

```
--- tasks/fix-test.aex ---
Policy:   .aex/policy.aex
Contract: tasks/fix-test.aex

Allowed:  file.read, file.write, tests.run
Denied:   network.*, secrets.read
Confirm:  file.write
Budget:   20
```

## See Also

- [CLI Reference](/reference/cli) — flags for `aex check`, `aex fmt`, `aex sign`, `aex verify`
- [CI Validation Workflow](/workflows/ci-validation) — broader CI patterns beyond GitHub Actions
- [Security Model](/reference/security) — signing and provenance details
