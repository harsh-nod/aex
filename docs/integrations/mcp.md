# MCP Gateway

The [`@aex-lang/mcp-gateway`](https://github.com/harsh-nod/aex/tree/main/packages/aex-mcp-gateway) package sits between an MCP client and an MCP server, using an AEX contract to decide which tool calls are allowed, which require confirmation, and which are blocked.

## Overview

```
MCP Client  --->  AEX Gateway  --->  MCP Server
                    |
                    v
              .aex contract
              (permissions)
```

The gateway reads an `.aex` file and answers three questions for every incoming tool call:

1. **Is it allowed?** — tool must be in `use` and not in `deny`
2. **Does it need confirmation?** — any `confirm before <tool>` step triggers an approval gate
3. **Should it be blocked?** — denied tools are rejected immediately

## Installation

```bash
npm install @aex-lang/mcp-gateway
```

## Quick Start

```ts
import { AEXMCPGateway } from "@aex-lang/mcp-gateway";

const gateway = new AEXMCPGateway("tasks/db-access.aex");

// Check before forwarding a tool call
if (!(await gateway.allows("db.query"))) {
  throw new Error("db.query is not allowed by the contract.");
}

if (await gateway.requiresConfirmation("db.write")) {
  // Surface a human approval prompt before forwarding
  const approved = await promptUser("Allow db.write?");
  if (!approved) throw new Error("db.write denied by operator.");
}

// Safe to forward the call to the MCP server
const result = await mcpServer.call("db.query", args);
```

## Writing a Gateway Contract

A gateway contract defines the permissions boundary for an MCP server. Here's one that protects a database server:

```aex
task db_gateway v0

goal "Allow read queries but gate all writes behind confirmation."

use db.query, db.write, db.schema
deny db.drop, db.truncate, admin.*

confirm before db.write

return { status: "gateway ready" }
```

This contract:
- Allows `db.query`, `db.write`, and `db.schema`
- Blocks `db.drop`, `db.truncate`, and anything under `admin.*`
- Requires human confirmation before any `db.write` call

## API Reference

### `new AEXMCPGateway(taskPath: string)`

Create a gateway from an `.aex` contract file. The contract is parsed lazily on first use and cached.

### `gateway.allows(toolName: string): Promise<boolean>`

Returns `true` if the tool is in the contract's `use` list and not in the `deny` list. Supports wildcard patterns — `network.*` matches `network.fetch`, `network.post`, etc.

### `gateway.requiresConfirmation(toolName: string): Promise<boolean>`

Returns `true` if any `confirm before <tool>` step in the contract matches the tool name.

### `gateway.summary(): Promise<GatewaySummary>`

Returns the full permission sets:

```ts
interface GatewaySummary {
  allowedTools: string[];   // from `use`
  deniedTools: string[];    // from `deny`
  confirmTools: string[];   // from `confirm before` steps
}
```

Use this to build audit dashboards or permission matrices.

## End-to-End Example

### 1. Create the contract

```aex
task api_proxy v0

goal "Proxy API calls with rate limiting and access control."

use api.get, api.post, api.list
deny api.delete, admin.*

need api_key: str

budget calls=50

confirm before api.post

do api.list() -> endpoints

return endpoints
```

### 2. Create a policy

```json
{
  "allow": ["api.get", "api.post", "api.list"],
  "deny": ["api.delete", "admin.*"],
  "require_confirmation": ["api.post"],
  "budget": { "calls": 50 }
}
```

### 3. Wire the gateway into your MCP proxy

```ts
import { AEXMCPGateway } from "@aex-lang/mcp-gateway";

const gateway = new AEXMCPGateway("tasks/api-proxy.aex");
const summary = await gateway.summary();

console.log("Allowed:", summary.allowedTools);
console.log("Denied:", summary.deniedTools);
console.log("Confirm:", summary.confirmTools);

// In your MCP request handler:
async function handleToolCall(toolName: string, args: unknown) {
  if (!(await gateway.allows(toolName))) {
    return { error: `Tool "${toolName}" is blocked by contract.` };
  }

  if (await gateway.requiresConfirmation(toolName)) {
    const approved = await requestApproval(toolName);
    if (!approved) {
      return { error: `Tool "${toolName}" denied by operator.` };
    }
  }

  return await forwardToMCPServer(toolName, args);
}
```

### 4. Check the summary for audit

```ts
const summary = await gateway.summary();
// {
//   allowedTools: ["api.get", "api.post", "api.list"],
//   deniedTools: ["api.delete", "admin.*"],
//   confirmTools: ["api.post"]
// }
```

## Combining with Runtime Policies

The gateway reads permissions from the `.aex` file. For additional runtime constraints (path restrictions, budget caps), pass a policy to `aex run`:

```bash
aex run tasks/api-proxy.aex \
  --policy tasks/api-proxy.policy.json \
  --inputs tasks/api-proxy.inputs.json
```

Policies can extend base policies with the `extends` field for org-wide defaults.

## Error Handling

When the gateway blocks a tool call, surface a clear error to the client:

```ts
async function handleToolCall(toolName: string, args: unknown) {
  if (!(await gateway.allows(toolName))) {
    return {
      error: `Tool "${toolName}" is blocked by contract.`,
      code: "AEX_DENIED",
    };
  }

  if (await gateway.requiresConfirmation(toolName)) {
    const approved = await requestApproval(toolName);
    if (!approved) {
      return {
        error: `Tool "${toolName}" denied by operator.`,
        code: "AEX_CONFIRMATION_DENIED",
      };
    }
  }

  return await forwardToMCPServer(toolName, args);
}
```

Common scenarios:
- **Tool not in `use` list** — the contract doesn't declare it
- **Tool matches `deny` pattern** — `deny network.*` blocks `network.fetch`
- **Confirmation denied** — user rejected the `confirm before` gate

## See Also

- [Policy Reference](/reference/policy) — runtime policy enforcement rules
- [OpenAI Agents SDK](/integrations/openai-agents) — programmatic adapter for OpenAI agents
- [CLI Reference](/reference/cli) — full list of CLI flags
- [Meta-Tools Reference](/reference/meta-tools) — checkpoint, resume, list, review via proxy
