# MCP Gateway

The [`@aex/mcp-gateway`](https://github.com/harsh-nod/aex/tree/main/packages/aex-mcp-gateway) package helps you answer permission questions before forwarding tool calls to MCP servers.

```ts
import { AEXMCPGateway } from "@aex/mcp-gateway";

const gateway = new AEXMCPGateway("tasks/support-ticket.aex");

if (!(await gateway.allows("crm.lookup"))) {
  throw new Error("crm.lookup is not allowed for this task.");
}

const requiresApproval = await gateway.requiresConfirmation("ticket.read");
if (requiresApproval) {
  // surface a human approval prompt before forwarding the call
}
```

`summary()` returns the allow/deny/confirm sets so you can build runtime policies or audit dashboards directly from the `.aex` file.
