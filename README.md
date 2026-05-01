# AEX

> **Executable contracts for AI agents.** Prompts are not permissions.

AEX is a tiny, readable task-contract format that constrains what an AI agent may do, what it must check, and what requires human approval. Install the CLI, add an `.aex` file to your repo, and your existing agent stack gains an enforceable contract layer.

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

## Why AEX?

- **Readable:** Learn the format from one file.
- **Enforceable:** Tool use, checks, and human approvals are encoded and auditable.
- **Portable:** Works alongside OpenAI Agents SDK, MCP, LangGraph, GitHub Actions, and any custom runtime.
- **Diffable:** Task contracts live as text files, reviewable like code.

## Install (pre-release)

The CLI is under active development. Clone the repo and run scripts locally:

```bash
git clone https://github.com/harsh-nod/aex.git
cd aex
npm install
npm run build
# Run parser/validator/runtime tests
npm test
```

## Quickstart

```bash
aex init
aex check tasks/fix-test.aex
aex fmt tasks/fix-test.aex
aex compile tasks/fix-test.aex
aex run tasks/fix-test.aex --inputs inputs.json --policy policy.json
aex sign tasks/fix-test.aex --id release-bot --key-file signing.key
```

When you run a contract, the runtime enforces the intersection of contract permissions and runtime policy:

- tool calls outside the allowed set are blocked
- confirmation gates halt execution until a confirmation handler approves them
- call budgets stop execution when the limit is exceeded

`aex run` accepts `--inputs` and `--policy` flags for JSON files and will prompt for confirmation gates unless you pass `--auto-confirm` during local experiments.

`aex fmt` keeps contracts deterministic (use `--check` in CI), and `aex sign`/`aex verify` attach HMAC-backed provenance metadata for governance workflows.

## Works with

- MCP
- OpenAI Agents SDK
- LangGraph
- GitHub Actions
- AGENTS.md
- VS Code (syntax highlighting + snippets)

## Status

AEX is pre-release software. Expect rapid iteration as the parser, validator, runtime, and adapters land.

## Documentation

The documentation site is published via GitHub Pages: once Actions completes, visit https://harsh-nod.github.io/aex for the latest guides.

## Contributing

We welcome pull requests for examples, adapters, checks, docs, and tooling. See [docs/community/contributing.md](docs/community/contributing.md) once the contribution guide is published.

---

**Prompts are not permissions.** Keep your agent. Add a contract.
