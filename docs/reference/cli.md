---
title: CLI Reference
---

The `aex` CLI keeps contracts tidy, validated, and auditable. Commands compose cleanly in CI pipelines.

## Installation

```bash
npm install -g @aex-lang/cli
```

Or use without installing:

```bash
npx @aex-lang/cli check tasks/fix-test.aex
```

## `aex init`

Scaffold policies and task contracts.

### `aex init --policy`

Create a `.aex/policy.aex` file with a starter security boundary:

```bash
aex init --policy
```

### `aex init --task`

Scaffold a starter task contract, inputs, and policy files:

```bash
aex init --task fix-test
```

Creates `tasks/fix-test.aex`, `tasks/fix-test.inputs.json`, and `tasks/fix-test.policy.json`.

## `aex check`

Validate syntax and semantics. Errors include machine-readable codes.

```bash
aex check tasks/fix-test.aex
```

## `aex fmt`

Reformat contracts deterministically. Use `--check` to fail CI when files drift.

```bash
aex fmt tasks/fix-test.aex
aex fmt tasks/*.aex --check
```

## `aex compile`

Emit the JSON IR that adapters and runtimes consume.

```bash
aex compile tasks/fix-test.aex > tasks/fix-test.ir.json
```

## `aex run`

Execute a contract locally with optional inputs, policies, and confirmation handlers.

```bash
aex run tasks/fix-test.aex \
  --inputs tasks/fix-test.inputs.json \
  --policy tasks/fix-test.policy.json \
  --auto-confirm
```

### Options

| Flag | Description |
|------|-------------|
| `--inputs <file>` | Path to an inputs JSON file |
| `--policy <file>` | Path to a runtime policy JSON file |
| `--auto-confirm` | Automatically approve confirmation gates |
| `--model <provider>` | Model provider for `make` steps (`openai`, `anthropic`) |
| `--model-handler <path>` | Path to a custom model handler module |
| `--registry <url>` | URL of a remote tool registry |
| `--log-json` | Output structured log events as JSON |
| `--otlp-endpoint <url>` | OpenTelemetry collector endpoint for trace export |

### Model providers

Set the model provider for `make` steps:

```bash
# Use OpenAI (requires OPENAI_API_KEY)
aex run task.aex --model openai

# Use Anthropic (requires ANTHROPIC_API_KEY)
aex run task.aex --model anthropic

# Use a custom handler
aex run task.aex --model-handler ./my-handler.ts
```

### Remote tool registries

Load tool definitions from an HTTP endpoint:

```bash
aex run task.aex --registry https://tools.example.com/registry
```

The registry must return JSON with a `tools` object mapping tool names to `{ url, sideEffect }` definitions.

### Structured logging

```bash
# JSON event log to stdout
aex run task.aex --log-json

# Export traces to an OpenTelemetry collector
aex run task.aex --otlp-endpoint http://localhost:4318/v1/traces
```

## `aex effective`

Preview the merged permissions when a policy and task contract are combined.

```bash
# Policy only
aex effective

# Policy + task contract
aex effective --contract tasks/fix-test.aex
```

### Options

| Flag | Description |
|------|-------------|
| `--contract <file>` | Path to a task contract to merge with the policy |
| `--policy <file>` | Explicit path to a policy file (otherwise auto-discovered) |

### Output

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

## `aex proxy`

Start an MCP stdio proxy that gates every tool call against your policy.

```bash
# Preferred: everything after -- is the upstream command
aex proxy -- npx -y your-mcp-server --flag "hello world"

# Legacy: --upstream with a quoted string
aex proxy -- your-mcp-server
```

### Options

| Flag | Description |
|------|-------------|
| `-- <cmd...>` | Everything after `--` is the upstream command (preferred) |
| `--upstream <cmd>` | Quoted upstream command string (legacy, deprecated) |
| `--contract <file>` | Optional task contract for additional constraints |
| `--policy <file>` | Explicit policy file (otherwise auto-discovered) |
| `--auto-confirm` | Automatically approve confirmation gates |

The proxy auto-discovers `.aex/policy.aex` in the working directory. It sits between your MCP client (Claude Code, Codex CLI) and the upstream server, enforcing allow/deny rules, confirmation gates, and budgets on every `tools/call` request.

See the [Claude Code](/integrations/claude-code) and [Codex](/integrations/codex) integration guides for full setup.

### Meta-Tools

The proxy exposes four meta-tools through the MCP protocol. These are handled locally — never forwarded to upstream:

| Tool | Description |
|------|-------------|
| `aex.checkpoint` | Save session state (audit log, budget, tool history) to disk |
| `aex.resume` | Load a checkpoint and restore budget state |
| `aex.list_tasks` | List available contracts and checkpoints |
| `aex.review_task` | Review a contract's permissions without executing |

Meta-tools bypass policy — they manage AEX itself. They appear automatically in `tools/list` responses. See the [Meta-Tools Reference](/reference/meta-tools) for input schemas and examples.

## `aex gate`

Claude Code `PreToolUse` hook that evaluates every tool call against your AEX policy.

```bash
# Configured as a Claude Code hook, not run directly
# In .claude/settings.json:
# { "hooks": { "PreToolUse": [{ "matcher": ".*", "command": "aex gate" }] } }
```

### Options

| Flag | Description |
|------|-------------|
| `--contract <file>` | Optional task contract for additional constraints |
| `--policy <file>` | Explicit policy file (otherwise auto-discovered from `cwd` in hook input) |
| `--allow-no-policy` | Allow all tool calls when no policy is found (default: deny all) |

### Behavior

- Reads JSON from stdin (Claude Code hook protocol)
- Maps Claude Code tool names to AEX capabilities (e.g., `Write` → `file.write`)
- Evaluates against allow/deny/confirm/budget rules
- Responds with `permissionDecision`: `"allow"`, `"deny"`, or `"ask"`
- Fails closed if no policy is found (denies all calls); pass `--allow-no-policy` to allow all
- Tracks budget state across calls via `.aex/.gate-budget.json`

### Tool Name Mapping

| Claude Code | AEX Capability |
|-------------|----------------|
| Read, Glob, Grep, LS | file.read |
| Write, Edit, MultiEdit | file.write |
| Bash | shell.exec |
| WebFetch | network.fetch |
| WebSearch | network.search |
| Agent | agent.spawn |

## `aex draft`

Generate a draft AEX task contract from a natural language prompt.

```bash
aex draft "<prompt>" [options]
```

The command calls an LLM to produce a valid AEX contract, validates it, and saves it to `.aex/runs/`.

### Options

| Flag | Description |
|------|-------------|
| `--model <provider>` | Model provider (`openai`, `anthropic`, or `provider:model` like `openai:gpt-4o`) |
| `--out <file>` | Output file path (defaults to `.aex/runs/<timestamp>-<name>.aex`) |
| `--name <name>` | Task name in snake_case (derived from prompt if omitted) |
| `--policy <file>` | Policy file to constrain against (auto-discovers `.aex/policy.aex`) |
| `--from-plan <file>` | Read plan text from file instead of prompt |
| `--max-retries <n>` | Max retries on validation failure (default: 1) |

### Examples

```bash
# Generate a contract using Anthropic
aex draft "fix the failing test in src/foo.ts" --model anthropic

# Specify output path and name
aex draft "review this PR" --model openai --name review_pr --out tasks/review.aex

# Use a specific model version
aex draft "update dependency" --model openai:gpt-4o
```

The drafted contract is validated against the active policy. If validation fails, the LLM is retried with error feedback.

## `aex review`

Review an AEX task contract and optionally execute it.

```bash
aex review <file> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--json` | Output machine-readable JSON summary |
| `--run` | Prompt for approval then execute the task |
| `--yes` | Skip approval prompt (with `--run`) |
| `--policy <file>` | Policy file (auto-discovers if omitted) |
| `--model <provider>` | Model provider for `make` steps (with `--run`) |
| `--model-handler <path>` | Custom model handler (with `--run`) |
| `--inputs <file>` | Inputs JSON file (with `--run`) |
| `--auto-confirm` | Auto-approve confirmation gates during execution |

### Output

The review shows: task name, goal, requested tools, denied tools, effective permissions, checks, model-generated steps, and whether the task runs under current policy.

### Examples

```bash
# Review a drafted contract
aex review .aex/runs/20260502-153012-fix-test.aex

# Review and run with approval
aex review .aex/runs/fix-test.aex --run

# Machine-readable output
aex review tasks/fix-test.aex --json
```

## `aex classify`

Classify a prompt as exploratory or contract-requiring.

```bash
aex classify "<prompt>"
```

### Output

```json
{ "mode": "contract_recommended", "reason": "prompt implies file modifications" }
```

Modes: `exploratory`, `contract_recommended`, `contract_required`. Uses keyword heuristics, no LLM call.

## `aex sign` and `aex verify`

Generate and validate provenance metadata using an HMAC secret.

```bash
aex sign tasks/fix-test.aex --id release-bot --key-file ./keys/aex.hmac
aex verify tasks/fix-test.aex \
  --signature tasks/fix-test.aex.signature.json \
  --key-file ./keys/aex.hmac
```

## CI Integration

Hook the commands into CI:

```yaml
- run: npx @aex-lang/cli fmt tasks/*.aex --check
- run: npx @aex-lang/cli check tasks/*.aex
- run: npm test
```

Or use the [`setup-aex`](https://github.com/harsh-nod/aex/tree/main/action) GitHub Action:

```yaml
- uses: harsh-nod/aex/action@main
  with:
    version: latest
- run: aex check tasks/*.aex
```

> **Note:** The action is at `action/action.yml` in the repo, so the `uses:` path includes the `/action` subdirectory.
