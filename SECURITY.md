# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AEX, please report it responsibly.

**Email:** Open a [GitHub Security Advisory](https://github.com/harsh-nod/aex/security/advisories/new) on this repository.

Do not open a public issue for security vulnerabilities.

## Scope

The following areas are in scope for security reports:

- **Runtime enforcement bypass** — any way to execute a denied tool or skip a confirmation gate
- **Command injection** — shell metacharacter injection via `tests.run` or other tool arguments
- **Path traversal** — accessing files outside the working directory via built-in tools
- **Signature verification bypass** — forging or bypassing `aex sign` / `aex verify` HMAC checks
- **Policy evaluation errors** — allow/deny rules not matching as documented

## Out of Scope

- Vulnerabilities in upstream dependencies (report those upstream)
- Model behavior or prompt injection at the LLM layer (AEX enforces tool-level boundaries, not prompt-level safety)
- Denial of service via large contracts (no performance guarantees yet)

## Response

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days for confirmed issues.

## Disclosure

We follow coordinated disclosure. We will credit reporters in the release notes unless they prefer to remain anonymous.
