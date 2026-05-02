---
title: Threat Monitor
---

# Threat Monitor

Apply a reviewed patch with runtime safeguards — verifying the diff is valid, scoped to declared files, and passing tests both before and after application. Requires human confirmation before mutating the working tree.

## Contract

```aex
agent threat_monitor v0

goal "Apply a reviewed patch with runtime safeguards."

use git.diff, git.apply, tests.run, context.load
deny network.*, secrets.read

need patch: str
need target_files: list[str]
need test_cmd: str

do git.diff(paths=target_files) -> working_tree
check working_tree is valid diff

do tests.run(cmd=test_cmd) -> baseline
check baseline.passed

confirm before git.apply

do git.apply(diff=patch)

check patch is valid diff
check patch touches only target_files

do tests.run(cmd=test_cmd) -> validation
check validation.passed

return {
  status: "applied",
  files: target_files,
  tests: {
    before: baseline.stdout,
    after: validation.stdout
  }
}
```

## Inputs

```json
{
  "patch": "diff --git a/src/service.ts b/src/service.ts\n--- a/src/service.ts\n+++ b/src/service.ts\n@@ -1,3 +1,4 @@\n export function handler(input: string) {\n   const normalized = input.trim();\n-  return normalized;\n+  return normalized.replace(/\\u0000/g, \"\");\n }\n",
  "target_files": ["src/service.ts"],
  "test_cmd": "npm test"
}
```

## Policy

```json
{
  "allow": ["git.diff", "git.apply", "tests.run"],
  "require_confirmation": ["git.apply"],
  "budget": {
    "calls": 8
  }
}
```

## Run It

```bash
aex run examples/security/threat-monitor.aex \
  --inputs examples/security/threat-monitor.inputs.json \
  --policy examples/security/threat-monitor.policy.json
```

Without `--auto-confirm`, the CLI pauses before `git.apply` and shows the patch for review.

## Expected Output

On success:

```json
{
  "status": "applied",
  "files": ["src/service.ts"],
  "tests": {
    "before": "12 tests passed",
    "after": "12 tests passed"
  }
}
```

## Blocked Actions

If the patch modifies files outside `target_files`, the runtime blocks it:

```json
{"event":"check.failed","condition":"patch touches only target_files","reason":"patch modifies README.md which is not in target_files"}
{"event":"run.finished","status":"blocked","reason":"check failed: patch touches only target_files"}
```

If baseline tests fail, the contract stops before applying any changes — preventing patches from being applied to an already-broken tree.

## Audit Log

```json
{"event":"run.started","agent":"threat_monitor","version":"v0"}
{"event":"tool.allowed","tool":"git.diff","step":1}
{"event":"tool.result","tool":"git.diff","bind":"working_tree"}
{"event":"check.passed","condition":"working_tree is valid diff"}
{"event":"tool.allowed","tool":"tests.run","step":2}
{"event":"tool.result","tool":"tests.run","bind":"baseline"}
{"event":"check.passed","condition":"baseline.passed"}
{"event":"confirm.required","tool":"git.apply"}
{"event":"confirm.approved","tool":"git.apply"}
{"event":"tool.allowed","tool":"git.apply","step":3}
{"event":"tool.result","tool":"git.apply","bind":"_"}
{"event":"check.passed","condition":"patch is valid diff"}
{"event":"check.passed","condition":"patch touches only target_files"}
{"event":"tool.allowed","tool":"tests.run","step":4}
{"event":"tool.result","tool":"tests.run","bind":"validation"}
{"event":"check.passed","condition":"validation.passed"}
{"event":"run.finished","status":"success"}
```

## What This Proves

- **Pre/post verification**: tests run before and after the patch — catching both regressions and patches applied to broken baselines
- **Scope enforcement**: `check patch touches only target_files` prevents supply-chain-style attacks where a patch sneaks changes into unrelated files
- **Human gate**: `confirm before git.apply` ensures a human reviews the exact diff before any mutation
- **Network isolation**: `deny network.*` blocks exfiltration — the agent works entirely offline with local git and test tools
- **Provenance pairing**: combine with `aex sign` / `aex verify` to attach a cryptographic record to every contract revision
