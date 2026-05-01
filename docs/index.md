---
title: AEX Overview
---

<div class="hero-intro">
  <h1>Executable Contracts for AI Agents</h1>
  <p class="hero-tagline">
    AEX turns brittle prompts into enforceable task contracts. Define allowed tools, checks, confirmations, and budgets in one readable file.
  </p>
  <div class="hero-actions">
    <a class="action primary" href="/quickstart">Get Started</a>
    <a class="action" href="https://github.com/harsh-nod/aex">View on GitHub</a>
  </div>
</div>

## Why AEX?

<div class="landing-grid">
  <article class="card">
    <h3>Readable & Diffable</h3>
    <p>Contracts live next to your code. Review changes like any other pull request.</p>
  </article>
  <article class="card">
    <h3>Runtime Enforcement</h3>
    <p>Tool calls must match <code>use</code> clauses, checks must pass, and confirmation gates require approval before side effects.</p>
  </article>
  <article class="card">
    <h3>Framework-Agnostic</h3>
    <p>Use the shared runtime directly or guard existing stacks via the OpenAI Agents and MCP adapters.</p>
  </article>
  <article class="card">
    <h3>Audit Friendly</h3>
    <p>Every tool call, check, confirmation, and return value is logged for compliance and review.</p>
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
</div>

## Roadmap Snapshot

- Runtime parity with more agent frameworks (LangGraph compiler, GitHub Actions guardrails).
- First-class formatter (`aex fmt`) and VS Code extension.
- Signed task contracts and cross-runtime compatibility suite.

Track progress in the [Roadmap](community/roadmap).

## Learn More

- [Quickstart](/quickstart) for a five-minute run-through.
- [Language Overview](/language/overview) for every keyword.
- [Examples](/examples/README) for real-world task contracts.
- [Policy Reference](/reference/policy) &amp; [Security Model](/reference/security) for governance teams.
