# Quickstart

The goal: run your first AEX contract in under five minutes.

## Install

```bash
npm install -g @aex-lang/cli
```

Or run without installing:

```bash
npx @aex-lang/cli check tasks/fix-test.aex
```

After a global install, the `aex` command is available on your PATH.

## Create a Policy

Every repo starts with a policy — the ambient security boundary:

```bash
aex init --policy
```

This creates `.aex/policy.aex`:

```aex
policy workspace v0

goal "Default security boundary for this repository."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

Edit it to match your repo's needs. Policies define what tools are available, which are denied, and which require human approval.

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

check patch is valid diff
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

## Preview Effective Permissions

See the merged permissions when policy and task are combined:

```bash
aex effective --contract tasks/fix-test.aex
```

Output:

```
Policy:   .aex/policy.aex
Contract: tasks/fix-test.aex

Allowed:
  file.read
  file.write
  tests.run

Denied:
  network.*
  secrets.read

Confirmation required:
  file.write

Budget:
  calls=20
```

The allow list is the intersection (only tools both policy and task agree on), deny is the union (everything either blocks), and budget is the minimum.

## Compile to JSON IR

```bash
aex compile tasks/fix-test.aex
```

The JSON output captures permissions, needs, and step sequence for downstream runtimes. The CLI validates the result against the official IR schema before printing.

## Format the Contract

```bash
aex fmt tasks/fix-test.aex
```

Add `--check` to ensure formatting during CI without rewriting files:

```bash
aex fmt tasks/fix-test.aex --check
```

## Run It

```bash
aex run tasks/fix-test.aex \
  --inputs examples/fix-test/inputs.json \
  --policy examples/fix-test/policy.json \
  --auto-confirm
```

The runtime enforces contract permissions and policy budgets. Without `--auto-confirm`, the CLI blocks at `confirm before file.write` and reports that confirmation is required.

### Audit Log

The runtime logs every tool call and check to stdout:

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

## Use as an MCP Proxy

If you use Claude Code or Codex CLI, `aex proxy` sits between your client and upstream MCP servers, gating every tool call against your policy:

```bash
aex proxy --upstream "your-mcp-server" --auto-confirm
```

The proxy auto-discovers `.aex/policy.aex`. See the [Claude Code](/integrations/claude-code) and [Codex](/integrations/codex) integration guides for full setup.

## How `make` Works

`make` steps ask a model to generate an artifact (like a diff or a draft). When you run `aex run`, the runtime delegates `make` to a **model handler**.

**Default behavior:** Without a model handler, `aex run` blocks at the first `make` step and reports that no model handler is configured.

**Using OpenAI:**

```bash
export AEX_MODEL=openai
export OPENAI_API_KEY=sk-...
aex run tasks/fix-test.aex --inputs examples/fix-test/inputs.json --policy examples/fix-test/policy.json
```

**Using a custom handler:**

```bash
aex run tasks/fix-test.aex --model-handler ./my-handler.ts
```

A model handler is a function that receives the `make` step description (type, inputs, instructions) and returns the generated artifact. See the [OpenAI Agents integration](/integrations/openai-agents) for a full example.

## Sign and Verify the Contract

Attach provenance metadata before shipping a contract:

```bash
aex sign tasks/fix-test.aex --id maintainer --key-file ./signing.key
```

Verify the metadata later:

```bash
aex verify tasks/fix-test.aex \
  --signature tasks/fix-test.aex.signature.json \
  --key-file ./signing.key
```

The signature file records the hash, signer, and timestamp, giving security teams an audit trail for every contract revision.
