# Language Overview

AEX v0 is intentionally tiny. Master these concepts and you can read any contract.

## Agent Header

```aex
agent fix_test v0
```

Names the contract and declares the spec version it targets.

## Goal

```aex
goal "Fix the failing test with the smallest safe change."
```

Human-readable statement of the desired outcome.

## Capabilities

```aex
use file.read, file.write, tests.run
deny network.*, secrets.read
```

`use` grants requested capabilities. `deny` explicitly blocks capabilities. Runtime policy will intersect with these declarations.

## Inputs

```aex
need test_cmd: str
need target_files: list[file]
```

Inputs are required at runtime before the contract executes.

## Steps

- `do`: call a tool
- `make`: request model output
- `check`: validate a condition
- `confirm`: require human approval before a tool call
- `return`: finish the contract with typed data

Example:

```aex
do tests.run(cmd=test_cmd) -> failure
make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior
```

Each `do` binds a result. Each `make` produces structured model output.

## Checks and Confirmation

Checks are guardrails that must pass. Confirmation steps create human approval gates for side-effectful tools.

```aex
check patch touches only target_files
confirm before file.write
```

## Return Value

Contracts end with an explicit return payload:

```aex
return {
  status: "fixed",
  patch: patch,
  test: final
}
```

The runtime serializes this structure into JSON for downstream consumers.
