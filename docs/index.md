---
title: AEX Overview
---

<div class="hero-intro">
  <h1>Field Notes for Agentic Systems</h1>
  <p class="hero-tagline">
    AEX captures an agent’s permissions, tests, confirmations, and provenance in one contract. Format it, sign it, run it, and compile it into LangGraph without rewriting your stack.
  </p>
  <div class="hero-actions">
    <a class="action primary" href="/quickstart">Get Started</a>
    <a class="action" href="/quickstart#format-the-contract">Format a Contract</a>
    <a class="action" href="https://github.com/harsh-nod/aex">View on GitHub</a>
  </div>
</div>

## Why AEX?

<div class="landing-grid">
  <article class="card">
    <h3>Readable & Diffable</h3>
    <p>AEX treats contracts like code: diff them, review them, and reformat them deterministically with <code>aex fmt</code>.</p>
  </article>
  <article class="card">
    <h3>Runtime Enforcement</h3>
    <p>Built-in checks validate diffs, file scopes, and test runs before side-effectful tools can proceed.</p>
  </article>
  <article class="card">
    <h3>LangGraph Ready</h3>
    <p>Compile any contract into a LangGraph plan via <code>@aex/langgraph</code> and drop it into existing agent graphs.</p>
  </article>
  <article class="card">
    <h3>CLI Ergonomics</h3>
    <p>Error codes, formatter support, provenance signing, and human-friendly diagnostics keep contracts tidy.</p>
  </article>
  <article class="card">
    <h3>Provable Provenance</h3>
    <p><code>aex sign</code> and <code>aex verify</code> attach HMAC-backed metadata so production runs can trust the source.</p>
  </article>
</div>

## Quick Win

```bash
npm install
aex init --task fix-test
aex check tasks/fix-test.aex
aex run tasks/fix-test.aex --inputs tasks/fix-test.inputs.json --policy tasks/fix-test.policy.json --auto-confirm
```

`aex init` scaffolds a starter contract, inputs, and policy so you can edit and run immediately.

## Anatomy of an AEX Contract

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
check patch has "Fix"
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed
return {
  status: "fixed",
  patch: patch
}
```

## Integrations

<div class="integrations">
  <div>
    <h3><code>@aex/openai-agents</code></h3>
    <p>Wrap your OpenAI Agents SDK workflows with an AEX guardrail.</p>

```ts
import { AEXGuardedAgent } from "@aex/openai-agents";

const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: { "crm.lookup": crmLookup, "email.draft": emailDraft }
});

const result = await agent.run({
  customer_id: "cus_123",
  ticket_id: "tkt_456"
});
```
  </div>
  <div>
    <h3><code>@aex/mcp-gateway</code></h3>
    <p>Enforce AEX contracts in front of MCP servers before forwarding tool calls.</p>

```ts
import { AEXMCPGateway } from "@aex/mcp-gateway";

const gateway = new AEXMCPGateway("tasks/support-ticket.aex");

if (!(await gateway.allows("email.send"))) {
  throw new Error("Email sending is denied for this task.");
}
```
  </div>
  <div>
    <h3><code>@aex/langgraph</code></h3>
    <p>Compile contracts straight into LangGraph plans for agent orchestration.</p>

```ts
import { compileFileToLangGraph } from "@aex/langgraph";

const plan = await compileFileToLangGraph("tasks/fix-test.aex");
langGraph.load(plan);
```
  </div>
</div>

## What's New

- Built-in diff-aware checks, structured `file.write`, and git helpers in the local runtime.
- `@aex/langgraph` compiler so contracts can power LangGraph workflows immediately.
- `aex fmt`, richer CLI diagnostics, and a companion VS Code extension.
- `aex sign` / `aex verify` provenance metadata plus a security-focused threat-monitor example.

Track ongoing work in the [Roadmap](community/roadmap).

## Learn More

- [Quickstart](/quickstart) for a five-minute run-through.
- [Language Overview](/language/overview) for every keyword.
- [Examples](/examples/README) for real-world task contracts.
- [Threat Monitor](/examples/security) for a threat-modelled workflow.
- [Policy Reference](/reference/policy) &amp; [Security Model](/reference/security) for governance teams.
- [VS Code Extension](https://github.com/harsh-nod/aex/tree/main/packages/aex-vscode) for syntax highlighting and snippets.
