# Security Model

AEX contracts act as an enforceable layer between intent and tool execution. The runtime and adapters uphold the following guarantees:

- Contracts are parsed and validated before execution.
- Tool calls must appear in `use`, be absent from `deny`, and pass the runtime policy intersection.
- When both a policy and task contract are active, effective permissions use the most restrictive combination: allow is intersected, deny is unioned, confirm is unioned, budget takes the minimum.
- Confirmation gates pause execution until an approval handler allows the call.
- Budgets stop execution when the permitted number of `do`/`make` steps is exhausted.
- All tool calls, confirmations, checks, and return values are logged.
- The MCP proxy (`aex proxy`) enforces the same rules on every tool call between your client and upstream servers.

## Runtime Protections

### Command Injection Prevention

Built-in tools like `tests.run` use `execFile` rather than shell-based `exec`. Commands are split into an executable and argument array, preventing injection via shell metacharacters like `;`, `&&`, `|`, or backticks. The runtime rejects any command argument containing shell chaining operators.

### Path Traversal Prevention

The built-in `file.read` and `file.write` tools enforce a working-directory boundary. Any path that resolves outside `process.cwd()` (e.g., `../../../etc/passwd` or an absolute path like `/etc/shadow`) is rejected before the filesystem is touched.

### Policy Path Qualifiers

Runtime policy entries support path-scoped rules like `file.read:/workspace/**`. The runtime parses both the tool name and the path pattern from policy entries, preserving the path qualifier for future enforcement instead of discarding it.

### Wildcard Matching

Tool permission wildcards enforce a dot boundary: `network.*` matches `network.fetch` and `network.post` but does **not** match `networkx.anything`. A shared matching implementation is used consistently across the parser, validator, runtime, and MCP gateway.

### Timing-Safe Signature Verification

The `aex verify` command uses `crypto.timingSafeEqual` to compare HMAC signatures, preventing timing side-channel attacks that could progressively leak the expected signature.

## Threat Model

AEX is designed to mitigate:

- prompt-injection attempts that ask an agent to read secrets or call undeclared tools
- exfiltration via overbroad tool permissions (blocked by `deny` rules enforced before any tool executes)
- silent edits that skip tests or checks
- tool calls that should require human approval (e.g., `file.write`, `ticket.create`)
- path traversal attacks through user-controlled file paths
- command injection through crafted test commands
- permission escalation when a task contract requests broader access than the ambient policy allows (merge semantics enforce the intersection)

What AEX does **not** guarantee:

- the correctness of a model-generated artifact (`make` steps still depend on the underlying model)
- protection against compromised tool implementations
- sandboxing of arbitrary shell commands (use specialized tools instead of `shell.exec`)

## Signed Contracts & Provenance

Use the CLI to generate and verify cryptographic metadata:

```bash
aex sign tasks/fix-test.aex --id release-bot --key-file ./keys/aex.hmac
aex verify tasks/fix-test.aex --signature tasks/fix-test.aex.signature.json --key-file ./keys/aex.hmac
```

Signature files capture the source path, SHA-256 hash, signer, timestamp, and HMAC digest. Store the signatures in your repository alongside contracts so platform teams can audit every change before allowing execution.

## Threat-Model Demo

The [Threat Monitor example](../examples/security.md) demonstrates how to wire policies, confirmations, git tooling, and diff-aware checks together before mutating a repository. Pair it with signed contracts to guarantee the workflow hasn't changed since approval.

## Compatibility Tests

The reference implementation includes tests that ensure the CLI, runtime, and LangGraph compiler agree on step ordering and semantics. When you run `npm test`, vitest executes:

- Command injection prevention (shell metacharacters blocked).
- Path traversal prevention (out-of-cwd paths rejected).
- Runtime checks for unified diff validation and file-permission enforcement.
- Git tool integrations (`git.diff`, `git.apply`) under a temporary repository.
- Cross-runtime verification that `taskToLangGraph` produces the same step count as the validated task.
- Timing-safe signature verification and tamper detection.

## MCP Proxy Security

The `aex proxy` command enforces policy on MCP tool calls at the transport layer — between your client (Claude Code, Codex CLI) and upstream MCP servers. This provides defense-in-depth because:

- **Deny rules are enforced before the upstream server sees the request.** A prompt injection that convinces the model to call a denied tool is blocked at the proxy, not at the model.
- **Budget enforcement** stops execution after the configured number of calls, preventing runaway agents.
- **Audit logging** records every decision (allowed, denied, confirmed) as structured JSON to stderr.

```bash
aex proxy --upstream "your-mcp-server" --policy .aex/policy.aex
```

## Resources

- [Policy Reference](/reference/policy) — `.aex` policy file format and merge semantics
- [Policy schema](https://github.com/harsh-nod/aex/blob/main/schemas/policy.schema.json)
- [JSON IR schema](https://github.com/harsh-nod/aex/blob/main/schemas/aex-ir.schema.json)
- Runtime audit logs emitted by `aex run` (`--logger` integrations can stream them elsewhere).
- [Threat Monitor contract](https://github.com/harsh-nod/aex/tree/main/examples/security)
