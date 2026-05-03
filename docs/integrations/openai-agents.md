# OpenAI Agents SDK

The [`@aex-lang/openai-agents`](https://github.com/harsh-nod/aex/tree/main/packages/aex-openai-agents) package wraps an OpenAI Agents SDK workflow with AEX enforcement. Your agent runs normally — but every tool call is gated by an AEX contract at runtime.

## Installation

```bash
npm install @aex-lang/openai-agents
```

This also installs `@aex-lang/parser` and `@aex-lang/runtime` as dependencies.

## Quick Start

```ts
import { AEXGuardedAgent } from "@aex-lang/openai-agents";

const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: {
    "crm.lookup": {
      sideEffect: "none",
      handler: async (args) => {
        return { name: "Alice", plan: "pro", email: "alice@example.com" };
      },
    },
    "ticket.read": {
      sideEffect: "none",
      handler: async (args) => {
        return { subject: "Login issue", body: "Can't sign in since Tuesday." };
      },
    },
    "email.draft": {
      sideEffect: "write",
      handler: async (args) => {
        return { drafted: true, to: args.to, body: args.body };
      },
    },
  },
});

const result = await agent.run({
  customer_id: "cust_123",
  ticket_id: "tkt_456",
});

if (result.status === "success") {
  console.log("Output:", result.output);
} else {
  console.log("Blocked:", result.issues);
}
```

## Contract

The agent's behavior is governed by an AEX contract:

```aex
task support_ticket v0

goal "Draft a reply to a support ticket."

use crm.lookup, ticket.read, email.draft
deny email.send, payment.*, admin.*, secrets.read

need customer_id: str
need ticket_id: str

do crm.lookup(id=customer_id) -> customer
do ticket.read(id=ticket_id) -> ticket

make reply: str from customer, ticket with:
  - address the customer by name
  - reference the ticket subject
  - do not include internal notes

check reply does not include customer.internal_notes
confirm before email.draft

do email.draft(to=customer.email, body=reply) -> result

return {
  status: "drafted",
  reply: reply
}
```

## API Reference

### `new AEXGuardedAgent(options)`

| Option | Type | Required | Description |
|---|---|---|---|
| `taskPath` | `string` | yes | Path to `.aex` contract file |
| `tools` | `ToolRegistry` | yes | Tool implementations keyed by AEX tool name |
| `model` | `ModelHandler` | no | Handler for `make` steps (generates artifacts) |
| `policy` | `RuntimePolicy` | no | Additional runtime policy on top of the contract |
| `confirm` | `(tool: string) => Promise<boolean>` | no | Confirmation handler for `confirm before` gates |
| `logger` | `(event: RuntimeEvent) => void` | no | Audit event stream |

### `agent.run(inputs)`

Executes the contract with the given inputs. Returns a `RunResult`:

```ts
interface RunResult {
  status: "success" | "blocked";
  output?: unknown;
  issues: string[];
}
```

### Tool Registry

Each tool has a `sideEffect` declaration and a `handler`:

```ts
interface ToolDefinition {
  sideEffect: "none" | "read" | "write";
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

type ToolRegistry = Record<string, ToolDefinition>;
```

The `sideEffect` field is informational. The AEX contract's `use`/`deny`/`confirm` rules are what's enforced at runtime.

## Adding a Model Handler

If your contract uses `make` steps, provide a model handler:

```ts
const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: { /* ... */ },
  model: async (step) => {
    // step.type — artifact type ("str", "diff", "markdown")
    // step.inputs — named inputs available to the step
    // step.instructions — bullet points from the contract
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Generate a ${step.type}. ${step.instructions.join(". ")}`,
        },
        { role: "user", content: JSON.stringify(step.inputs) },
      ],
    });
    return response.choices[0].message.content;
  },
});
```

Without a model handler, execution blocks at the first `make` step.

## Runtime Policy Overlay

Layer a policy on top of the contract for additional constraints:

```ts
const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: { /* ... */ },
  policy: {
    deny: ["email.send"],
    budget: { calls: 10 },
  },
});
```

Effective permissions are the most restrictive combination: allow is intersected, deny is unioned, budget takes the minimum.

## Logging and Audit

Stream structured audit events:

```ts
const agent = new AEXGuardedAgent({
  taskPath: "tasks/support-ticket.aex",
  tools: { /* ... */ },
  logger: (event) => console.log(JSON.stringify(event)),
});

await agent.run(inputs);
```

```json
{"event": "run.started", "agent": "support_ticket", "version": "v0"}
{"event": "tool.allowed", "tool": "crm.lookup", "step": 1}
{"event": "tool.result", "tool": "crm.lookup", "bind": "customer"}
{"event": "tool.allowed", "tool": "ticket.read", "step": 2}
{"event": "check.passed", "condition": "reply does not include customer.internal_notes"}
{"event": "confirm.required", "tool": "email.draft"}
{"event": "run.finished", "status": "success"}
```

## Error Handling

When a contract blocks execution, `result.issues` contains the reasons:

```ts
const result = await agent.run({ customer_id: "cust_123" });

if (result.status === "blocked") {
  console.log(result.issues);
  // ["AEX030: Missing required input: ticket_id (expected: str)"]
}
```

Common block reasons:

| Code | Reason |
|---|---|
| AEX030 | Missing required input |
| AEX031 | Input type mismatch |
| — | Tool not declared in `use` list |
| — | Tool matches a `deny` pattern |
| — | Budget exhausted |
| — | Confirmation required (no handler provided) |
| — | `check` condition failed |

## See Also

- [MCP Gateway](/integrations/mcp) — lower-level gateway API for custom proxies
- [LangGraph](/integrations/langgraph) — compile contracts to execution graphs
- [Language Overview](/language/overview) — all AEX contract keywords
- [Examples](/examples/) — real-world contracts
