---
title: CLI Reference
---

The `aex` CLI keeps contracts tidy, validated, and auditable. Commands compose cleanly in CI pipelines.

## `aex init`

Scaffold a starter contract, inputs, and policy files.

```bash
aex init --task fix-test
```

## `aex check`

Validate syntax and semantics. Errors include machine-readable codes.

```bash
aex check tasks/fix-test.aex
```

## `aex fmt`

Reformat contracts deterministically. Use `--check` to fail CI when files drift.

```bash
aex fmt tasks/fix-test.aex
aex fmt tasks/*.aex --check
```

## `aex compile`

Emit the JSON IR that adapters and runtimes consume.

```bash
aex compile tasks/fix-test.aex > tasks/fix-test.ir.json
```

## `aex run`

Execute a contract locally with optional inputs, policies, and confirmation handlers.

```bash
aex run tasks/fix-test.aex \
  --inputs tasks/fix-test.inputs.json \
  --policy tasks/fix-test.policy.json \
  --auto-confirm
```

## `aex sign` and `aex verify`

Generate and validate provenance metadata using an HMAC secret.

```bash
aex sign tasks/fix-test.aex --id release-bot --key-file ./keys/aex.hmac
aex verify tasks/fix-test.aex \
  --signature tasks/fix-test.aex.signature.json \
  --key-file ./keys/aex.hmac
```

## `aex init` + testing

Hook the commands into CI:

```yaml
- run: aex fmt tasks/*.aex --check
- run: aex check tasks/*.aex
- run: npm test
```
