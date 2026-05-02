# Support Ticket Reply

Draft a customer support response using CRM context — while blocking outbound email, payment access, and admin actions. The agent can draft but never send.

## Contract

```aex
agent support_ticket v0

goal "Draft a customer support reply using CRM context."

use crm.lookup, ticket.read, email.draft
deny email.send, payment.*, admin.*, secrets.read

need customer_id: str
need ticket_id: str

do crm.lookup(id=customer_id) -> customer
do ticket.read(id=ticket_id) -> ticket

make reply: markdown from customer, ticket with:
  - summarize the customer's issue
  - acknowledge prior interactions
  - propose the next step
  - mark any uncertainty

check reply does not include customer.internal_notes

do email.draft(to=customer.email, body=reply) -> draft

return draft
```

## Inputs

```json
{
  "customer_id": "cus_1234",
  "ticket_id": "tkt_5678"
}
```

## Policy

```json
{
  "allow": [
    "crm.lookup",
    "ticket.read",
    "email.draft"
  ],
  "deny": [
    "email.send",
    "payment.*",
    "admin.*",
    "secrets.read"
  ],
  "require_confirmation": [
    "email.draft"
  ]
}
```

## Run It

```bash
aex run examples/support-ticket/task.aex \
  --inputs examples/support-ticket/inputs.json \
  --policy examples/support-ticket/policy.json
```

Without `--auto-confirm`, the CLI pauses at `email.draft` and waits for human approval — the policy's `require_confirmation` gate.

## Expected Output

The agent returns the draft email object:

```json
{
  "to": "alice@example.com",
  "body": "Hi Alice, thanks for reaching out about the billing discrepancy...",
  "status": "draft"
}
```

## Blocked Actions

The contract denies `email.send` — the agent can prepare a draft but cannot send it. If it tries:

```json
{"event":"tool.denied","tool":"email.send","reason":"denied by contract: email.send"}
```

It also denies `payment.*` and `admin.*`, preventing the agent from issuing refunds, modifying accounts, or escalating privileges.

## Audit Log

```json
{"event":"run.started","agent":"support_ticket","version":"v0"}
{"event":"tool.allowed","tool":"crm.lookup","step":1}
{"event":"tool.result","tool":"crm.lookup","bind":"customer"}
{"event":"tool.allowed","tool":"ticket.read","step":2}
{"event":"tool.result","tool":"ticket.read","bind":"ticket"}
{"event":"make.result","bind":"reply","type":"markdown"}
{"event":"check.passed","condition":"reply does not include customer.internal_notes"}
{"event":"confirm.required","tool":"email.draft"}
{"event":"confirm.approved","tool":"email.draft"}
{"event":"tool.allowed","tool":"email.draft","step":3}
{"event":"tool.result","tool":"email.draft","bind":"draft"}
{"event":"run.finished","status":"success"}
```

## What This Proves

- **Draft-only pattern**: `deny email.send` lets the agent compose but never deliver — a human reviews before sending
- **Data isolation**: `check reply does not include customer.internal_notes` ensures internal CRM notes never leak into customer-facing replies
- **Blast radius limits**: `deny payment.*` and `deny admin.*` prevent the agent from taking irreversible financial or administrative actions
- **Confirmation gates**: both the contract and the policy require approval before `email.draft`, giving humans two independent checkpoints
