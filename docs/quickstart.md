# Quickstart

The goal: run your first AEX contract in under five minutes.

## Install

```bash
npm install
npm run build
```

Publishing to npm will arrive once the MVP solidifies.

## Create a Task

Create `tasks/fix-test.aex`:

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

check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed
return final
```

## Validate It

```bash
aex check tasks/fix-test.aex
```

## Scaffold Files

```bash
aex init --task fix-test
```

This generates a starter contract plus matching inputs and policy files under `tasks/`.

## Compile to JSON IR

```bash
aex compile tasks/fix-test.aex
```

The JSON output captures permissions, needs, and step sequence for downstream runtimes. The CLI validates the result against the official IR schema before printing.

## Run Parser Tests

Verify the parser and validator behave as expected:

```bash
npm test
```

## Run It

```bash
aex run tasks/fix-test.aex \
  --inputs examples/fix-test/inputs.json \
  --policy examples/fix-test/policy.json
```

The runtime enforces contract permissions and policy budgets. If a step requires confirmation (`confirm before`), provide a confirmation handler when integrating with your agent runtime or pass `--auto-confirm` when testing locally. Otherwise the CLI blocks the run and reports that confirmation is required.

The runtime will log every tool call and check.
