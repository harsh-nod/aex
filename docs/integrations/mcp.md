# MCP Gateway

The AEX MCP gateway sits between your agent and MCP servers, enforcing tool permissions, checks, and confirmation gates defined in the contract.

## Planned Features

- Filter tool calls based on `use` and `deny`
- Enforce confirmation requirements before side-effectful tools
- Apply path-level restrictions from runtime policy
- Emit JSONL audit logs per run

Command preview:

```bash
aex mcp-gateway --task tasks/support-ticket.aex --policy policy.json
```
