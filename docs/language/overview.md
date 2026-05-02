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

`need` declares required runtime inputs. AEX validates the presence and type of each input before executing any tool or model step. Supported types: `str`, `num`, `int`, `bool`, `file`, `url`, `json`, `list[T]`, and `T?` (optional). Missing or mistyped inputs block execution immediately.

## Steps

- `do`: call a tool
- `make`: request model output
- `check`: validate a condition
- `confirm`: require human approval before a tool call
- `return`: finish the contract with typed data

`make` steps are executed through the runtime's `model` handler. When you integrate via the CLI or adapters (for example `@aex-lang/openai-agents`), you provide a function that takes the `make` step description and returns the generated artifact.

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

Built-in checks include:

- `result` &mdash; treats the value as truthy/non-empty
- `value has "Literal"` &mdash; substring inclusion
- `value has citations` &mdash; ensures Markdown or URLs include citations
- `value does not include other_value` &mdash; forbids sensitive tokens
- `patch is valid diff` &mdash; validates unified diff structure
- `patch touches only target_files` &mdash; ensures the diff stays within an allowed list

## Control Flow

### Conditional (`if`)

Execute steps only when a condition is true:

```aex
do tests.run(cmd=test_cmd) -> result

if result.passed
  do file.write(diff=patch) -> written
```

The body is indented under the `if` line. If the condition is false, the body is skipped.

### Iteration (`for`)

Loop over a list input:

```aex
need repos: list[str]

for repo in repos
  do git.diff(paths=[repo]) -> diff
  check diff is valid diff
```

The loop variable (`repo`) is scoped to the body. Budget limits count each iteration separately — a `budget calls=3` with a 5-element list will block after the third call.

## Built-in Tools

The reference runtime ships several safe defaults so you can run contracts locally without wiring custom handlers:

- `file.read` &mdash; read files into memory
- `file.write` &mdash; apply structured writes or unified diffs with optional confirmation gates
- `tests.run` &mdash; execute a test command and capture pass/fail output
- `git.diff` / `git.apply` &mdash; inspect and apply diffs in the current repository

All tools participate in the permission intersection (`use`/`deny` + runtime policy) and respect call budgets and confirmation gates.

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
