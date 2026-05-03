---
title: AEX Overview
---

<div class="hero-intro">
  <h1>Prompts Are Not Permissions</h1>
  <p class="hero-tagline">
    AEX defines <strong>policies</strong> (ambient security boundaries) and <strong>task contracts</strong> (per-task execution rules) in one readable format. The runtime enforces the most restrictive combination — prompt injection cannot bypass what the model never gets to call.
  </p>
  <p class="hero-subtitle"><em>Plans are not contracts.</em> AEX turns agent plans into enforceable task contracts.</p>
  <div class="hero-actions">
    <a class="action primary" href="/aex/quickstart">Get Started</a>
    <a class="action" href="/aex/language/overview#policy-files">Policy Files</a>
    <a class="action" href="https://github.com/harsh-nod/aex">View on GitHub</a>
  </div>
</div>

## How It Works

```
User prompt → aex draft → LLM generates contract → aex review → human approves → aex run → enforced execution
```

The model proposes. The human reviews. AEX enforces.

<div class="demo-grid">
<div class="demo-panel demo-danger">
<h4>Without AEX</h4>

```
User: "Fix the failing test in src/foo.ts"

Agent: reads src/foo.ts ✓
Agent: reads ~/.ssh/id_rsa ✓
Agent: writes to 14 unrelated files ✓
Agent: POSTs data to external URL ✓
```

The agent does whatever the model decides. Nothing stops scope creep, data exfiltration, or unintended writes.
</div>
<div class="demo-panel demo-safe">
<h4>With AEX</h4>

```bash
aex draft "fix the failing test in src/foo.ts"
aex review .aex/runs/fix-test.aex --run
```

```json
{"event":"tool.allowed","tool":"tests.run"}
{"event":"tool.allowed","tool":"file.read"}
{"event":"check.passed","condition":"patch touches only target_files"}
{"event":"confirm.approved","tool":"file.write"}
{"event":"check.passed","condition":"final.passed"}
{"event":"run.finished","status":"success"}
```

Every tool call is gated. Every check is enforced. The contract defines the boundary.
</div>
</div>

## Two Modes

AEX supports two modes of operation:

| Prompt type | Mode | Enforcement |
|---|---|---|
| "Explain this code" | Exploratory | Policy via `aex gate` / `aex proxy` |
| "Help me debug" | Exploratory | Policy guards, no contract needed |
| "Fix the failing test" | Contract | `aex draft` → `aex review` → `aex run` |
| "Update dependency" | Contract | Full runtime enforcement |
| "Deploy to production" | Contract + approvals | Policy + task + confirmations + budget |

**Explore freely under policy. Execute changes through contracts.**

## Quick Start

```bash
npm install -g @aex-lang/cli

# Set up repo policy
aex init --policy

# Generate a contract from natural language
aex draft "fix the failing test in src/foo.ts" --model anthropic

# Review what it will do
aex review .aex/runs/20260502-fix-failing-test.aex

# Approve and execute
aex review .aex/runs/20260502-fix-failing-test.aex --run
```

Or write contracts by hand:

```bash
aex init --task fix-test                # scaffold a contract
aex check tasks/fix-test.aex           # validate it
aex effective --contract tasks/fix-test.aex  # preview permissions
aex run tasks/fix-test.aex --inputs inputs.json
```

## Three Layers

```
repo/
  .aex/
    policy.aex          ← always-on repo guardrails
    runs/               ← generated one-off contracts
      fix-test.aex
      fix-test.audit.jsonl
  tasks/
    fix-test.aex        ← reusable checked-in workflows
    review-pr.aex
```

<div class="demo-grid">
<div class="demo-panel">
<h4>Policy (ambient boundary)</h4>

```aex
policy workspace v0

goal "Default security boundary."

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
```

</div>
<div class="demo-panel">
<h4>Task Contract (specific job)</h4>

```aex
task fix_test v0

goal "Fix the failing test."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior

check patch is valid diff
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

</div>
</div>

When both are active, effective permissions are the most restrictive combination: allow is intersected, deny is unioned, and budget takes the minimum.

## Why AEX?

<div class="landing-grid">
  <article class="card">
    <h3>Draft → Review → Run</h3>
    <p>Generate contracts from natural language with <code>aex draft</code>. Review permissions before executing. The model proposes, AEX enforces.</p>
  </article>
  <article class="card">
    <h3>Runtime Enforcement</h3>
    <p>Tool calls, file scopes, diff checks, confirmations, and budgets are enforced at runtime — not by asking the model nicely.</p>
  </article>
  <article class="card">
    <h3>Readable & Diffable</h3>
    <p>Contracts are text files. Diff them, review them in PRs, reformat with <code>aex fmt</code>. Security policies that live with your code.</p>
  </article>
  <article class="card">
    <h3>Works With Your Stack</h3>
    <p>Claude Code, Codex CLI, MCP servers, OpenAI Agents SDK, LangGraph, GitHub Actions. AEX wraps what you already use.</p>
  </article>
  <article class="card">
    <h3>Audit Trail</h3>
    <p>Every tool call, check, confirmation, and budget decision is logged as structured JSON. Full observability for every execution.</p>
  </article>
  <article class="card">
    <h3>Session Checkpoints</h3>
    <p>Save mid-session progress with <code>aex.checkpoint</code>. Resume in any MCP client with <code>aex.resume</code>. Cross-client, cross-session continuity.</p>
  </article>
</div>

## Integrations

<div class="integrations">
  <div>
    <h3><code>aex gate</code> + <code>aex proxy</code></h3>
    <p>Gate Claude Code built-in tools with hooks, MCP tools with the proxy — full coverage.</p>

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{ "matcher": ".*", "command": "aex gate" }]
  },
  "mcpServers": {
    "tools": {
      "command": "aex",
      "args": ["proxy", "--", "your-mcp-server"]
    }
  }
}
```
  </div>
  <div>
    <h3><code>aex draft</code> + <code>aex review</code></h3>
    <p>Generate and review contracts from natural language. The model drafts, human reviews, AEX runs.</p>

```bash
aex draft "fix the failing test" --model anthropic
aex review .aex/runs/fix-test.aex --run
```
  </div>
  <div>
    <h3><code>@aex-lang/openai-agents</code></h3>
    <p>Wrap OpenAI Agents SDK workflows with an AEX guardrail.</p>

```ts
import { AEXGuardedAgent } from "@aex-lang/openai-agents";

const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: { "crm.lookup": crmLookup }
});
```
  </div>
</div>

## What's New

- **Draft → Review → Run** — `aex draft` generates contracts from prompts, `aex review` shows what a contract will do, `aex review --run` executes with approval.
- **`aex classify`** — classifies prompts as exploratory or contract-requiring.
- **`.aex/runs/`** — generated contracts and audit logs stored alongside your policy.
- **Claude Code hook** — `aex gate` enforces policy on every built-in tool call.
- **MCP Proxy** — `aex proxy` sits between your client and upstream MCP servers.
- **Session Checkpoints** — `aex.checkpoint` and `aex.resume` meta-tools let agents save and reload sessions across conversations.
- **Policy files** — `policy workspace v0` defines ambient security boundaries.
- **Merge semantics** — allow = intersection, deny = union, budget = min.

Track ongoing work in the [Roadmap](community/roadmap).

## Learn More

- [Quickstart](/quickstart) for a five-minute walkthrough.
- [Language Overview](/language/overview) for every keyword.
- [Examples](/examples/) for real-world task contracts.
- [Claude Code Integration](/integrations/claude-code) for hook and proxy setup.
- [Policy Reference](/reference/policy) & [Security Model](/reference/security) for governance teams.
- [CLI Reference](/reference/cli) for every command.
