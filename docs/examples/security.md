---
title: Threat Monitor
---

The threat-monitor example demonstrates how to enforce patch hygiene before touching production systems. The contract requires passing baseline tests, confirms human approval before calling `git.apply`, and checks that the proposed diff only touches the files declared in `target_files`.

```bash
aex run examples/security/threat-monitor.aex \
  --inputs examples/security/threat-monitor.inputs.json \
  --policy examples/security/threat-monitor.policy.json \
  --auto-confirm
```

## Highlights

- Uses the built-in `git.diff` and `git.apply` tools from the runtime registry.
- Exercises the new `patch is valid diff` and `patch touches only target_files` checks.
- Demonstrates running tests before and after applying a diff.
- Requires an explicit confirmation before mutating the working tree.

Pair this contract with the provenance tooling (`aex sign` / `aex verify`) to attach a cryptographic record every time the contract is modified.
