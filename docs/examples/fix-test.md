# Fix Failing Test

Constrain a coding agent to apply the minimal patch that makes tests pass — blocking network access, limiting file scope, and requiring human confirmation before any write.

## Contract

```aex
agent fix_test v0

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
  - do not touch unrelated files

check patch is valid diff
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed

return {
  status: "fixed",
  patch: patch,
  test: final
}
```

## Inputs

```json
{
  "test_cmd": "npm test -- --watch=false",
  "target_files": [
    "src/foo.ts",
    "tests/foo.test.ts"
  ]
}
```

## Policy

Use an `.aex` policy file for the ambient security boundary:

```aex
policy fix_test v0

goal "Security boundary for fix-test workflows."

use file.read, file.write, tests.run
deny network.*, secrets.read

confirm before file.write

budget calls=20
```

Or the equivalent JSON policy:

```json
{
  "allow": [
    "file.read:/workspace/**",
    "file.write:/workspace/tests/**",
    "tests.run"
  ],
  "deny": [
    "network.*",
    "secrets.read"
  ],
  "require_confirmation": [
    "file.write"
  ],
  "budget": {
    "calls": 20
  }
}
```

## Run It

```bash
aex run examples/fix-test/task.aex \
  --inputs examples/fix-test/inputs.json \
  --policy examples/fix-test/policy.json \
  --auto-confirm
```

Or with policy auto-discovery (place the `.aex` policy file in `.aex/policy.aex`):

```bash
aex run examples/fix-test/task.aex \
  --inputs examples/fix-test/inputs.json \
  --auto-confirm
```

## Expected Output

On success the agent returns the patch it applied and the final test result:

```json
{
  "status": "fixed",
  "patch": "diff --git a/tests/foo.test.ts ...",
  "test": { "passed": true, "stdout": "1 test passed" }
}
```

## Blocked Actions

The contract denies `network.*` and `secrets.read`. If the model tries to call a network tool, the runtime blocks it immediately:

```json
{"event":"tool.denied","tool":"network.fetch","reason":"denied by contract: network.*"}
```

The policy also scopes `file.write` to `/workspace/tests/**` — writing outside that path is rejected even though the contract allows `file.write` in general.

## Audit Log

Every step is logged as structured JSON:

```json
{"event":"run.started","agent":"fix_test","version":"v0"}
{"event":"tool.allowed","tool":"tests.run","step":1}
{"event":"tool.result","tool":"tests.run","bind":"failure"}
{"event":"tool.allowed","tool":"file.read","step":2}
{"event":"tool.result","tool":"file.read","bind":"sources"}
{"event":"make.result","bind":"patch","type":"diff"}
{"event":"check.passed","condition":"patch is valid diff"}
{"event":"check.passed","condition":"patch touches only target_files"}
{"event":"confirm.required","tool":"file.write"}
{"event":"confirm.approved","tool":"file.write"}
{"event":"tool.allowed","tool":"file.write","step":3}
{"event":"tool.result","tool":"file.write","bind":"result"}
{"event":"tool.allowed","tool":"tests.run","step":4}
{"event":"tool.result","tool":"tests.run","bind":"final"}
{"event":"check.passed","condition":"final.passed"}
{"event":"run.finished","status":"success"}
```

## What This Proves

- **Least privilege**: only `file.read`, `file.write`, and `tests.run` are available — no network, no secrets
- **File scope enforcement**: both the contract (`check patch touches only target_files`) and the policy (`file.write:/workspace/tests/**`) limit where writes can land
- **Human-in-the-loop**: `confirm before file.write` blocks until a human approves the patch
- **Verifiable outcome**: the final `check final.passed` ensures the fix actually works before returning
