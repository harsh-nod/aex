# Policy Reference

Runtime policy intersects with the permissions requested in an AEX contract. The effective authority is the intersection of both.

## Schema

```json
{
  "allow": ["file.read:/workspace/**", "tests.run"],
  "deny": ["file.read:/secrets/**", "network.*"],
  "require_confirmation": ["file.write"],
  "budget": {
    "calls": 20
  }
}
```

## Enforcement

- `allow`: Capabilities or fully-qualified tool paths granted at runtime.
- `deny`: Capabilities explicitly blocked even if the contract requests them.
- `require_confirmation`: Tools that need a human approval gate.
- `budget`: Numeric limits enforced during execution.

The runtime will emit audit log events documenting every decision: allowed tool calls, denied requests, confirmations, and budget consumption.
