# Draft, Review, and Run

Generate a task contract from a natural language prompt, review its permissions, and execute it — all from the CLI.

## Overview

```
aex draft → aex review → aex review --run
```

The model drafts a contract. You review what it will do. AEX executes with full enforcement.

## 1. Draft a Contract

```bash
aex draft "fix the failing test in src/foo.ts" --model anthropic
```

This sends your prompt to the model, which generates a validated `.aex` contract and saves it to `.aex/runs/`:

```
.aex/runs/20260502-fix-failing-test.aex
```

The generated contract includes `use`/`deny` declarations, `need` inputs, `do`/`make` steps, `check` conditions, and a `return` block — all derived from your prompt.

## 2. Review Permissions

Before running anything, review what the contract will do:

```bash
aex review .aex/runs/20260502-fix-failing-test.aex
```

Output:

```
Task:      fix_failing_test
Goal:      Fix the failing test in src/foo.ts

Requested: file.read, file.write, tests.run
Denied:    network.*, secrets.read

Effective (with policy):
  Allow:   file.read, file.write, tests.run
  Deny:    network.*, secrets.read
  Confirm: file.write
  Budget:  20

Checks:
  - patch is valid diff
  - patch touches only target_files
  - final.passed

Make steps:
  - make patch: diff from failure, sources

Valid task.
```

This is a dry run — nothing executes. You see exactly what tools will be used, what's blocked, and what checks will be enforced.

## 3. Approve and Run

```bash
aex review .aex/runs/20260502-fix-failing-test.aex --run
```

The runtime executes the contract with full enforcement. Every step is logged:

```json
{"event": "run.started", "agent": "fix_failing_test", "version": "v0"}
{"event": "tool.allowed", "tool": "tests.run", "step": 1}
{"event": "tool.result", "tool": "tests.run", "bind": "failure"}
{"event": "tool.allowed", "tool": "file.read", "step": 2}
{"event": "make.result", "bind": "patch", "type": "diff"}
{"event": "check.passed", "condition": "patch is valid diff"}
{"event": "check.passed", "condition": "patch touches only target_files"}
{"event": "confirm.approved", "tool": "file.write"}
{"event": "tool.allowed", "tool": "file.write", "step": 3}
{"event": "check.passed", "condition": "final.passed"}
{"event": "run.finished", "status": "success"}
```

If any check fails or a denied tool is called, execution stops immediately.

## 4. Classify Prompts (Optional)

Not sure if a prompt needs a contract? Use `aex classify`:

```bash
aex classify "explain how the auth middleware works" --model anthropic
```

```json
{"classification": "exploratory", "reason": "Read-only question, no changes needed"}
```

```bash
aex classify "fix the failing test in src/foo.ts" --model anthropic
```

```json
{"classification": "contract", "reason": "Requires file modifications and test execution"}
```

Exploratory prompts can run under policy alone. Contract-requiring prompts should go through `aex draft`.

## Writing Contracts by Hand

For reusable workflows, write contracts directly instead of drafting them:

```bash
# Scaffold a contract
aex init --task fix-test

# Validate syntax
aex check tasks/fix-test.aex

# Preview effective permissions
aex effective --contract tasks/fix-test.aex

# Run it
aex run tasks/fix-test.aex --inputs inputs.json
```

Hand-written contracts live in `tasks/` and are checked into your repo. See the [Language Overview](/language/overview) for all keywords.

## Customizing the Model

`aex draft`, `aex review --run`, and `aex classify` accept a `--model` flag:

```bash
# Use Anthropic (Claude)
aex draft "..." --model anthropic

# Use OpenAI
aex draft "..." --model openai
```

Set the corresponding API key in your environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

## See Also

- [Language Overview](/language/overview) — all AEX keywords and syntax
- [CLI Reference](/reference/cli) — flags for `aex draft`, `aex review`, `aex classify`
- [Examples](/examples/) — real-world contracts to study
- [Policy-Only Mode](/workflows/policy-mode) — enforcement without contracts
