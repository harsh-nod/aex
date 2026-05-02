# Research Brief

Constrain web research by capping total calls, requiring citations, and separating facts from inference. The agent can search and read — but never post, send email, or access payment systems.

## Contract

```aex
agent research_brief v0

goal "Create a cited research brief."

use web.search, web.open, model.make
deny web.post, email.send, payment.*, secrets.read

need question: str

budget calls=8

do web.search(q=question, n=5) -> hits
do web.open(urls=hits[:3].url) -> pages

make brief: markdown from pages with:
  - answer the question
  - cite sources inline
  - separate facts from inference
  - list remaining uncertainty

check brief has citations

return brief
```

## Inputs

```json
{
  "question": "What are the tradeoffs between Rust and Go for backend services?"
}
```

## Policy

```json
{
  "allow": [
    "web.search",
    "web.open",
    "model.make"
  ],
  "deny": [
    "web.post",
    "email.send",
    "payment.*",
    "secrets.read"
  ],
  "require_confirmation": []
}
```

## Run It

```bash
aex run examples/research-brief/task.aex \
  --inputs examples/research-brief/inputs.json \
  --policy examples/research-brief/policy.json
```

## Expected Output

The agent returns a markdown brief with inline citations:

```markdown
## Rust vs Go for Backend Services

**Performance**: Rust consistently outperforms Go in compute-heavy workloads
due to zero-cost abstractions and no garbage collector [1]. Go's GC pauses
are typically under 1ms but can affect p99 latencies [2].

**Development speed**: Go's simpler type system and faster compile times
reduce iteration cycles [2]. Rust's borrow checker catches memory bugs at
compile time but has a steeper learning curve [1].

**Remaining uncertainty**: Long-term maintenance costs are poorly studied
in production settings.

[1] https://benchmarksgame-team.pages.debian.net/
[2] https://go.dev/blog/gc-latency
```

## Blocked Actions

`budget calls=8` caps the total number of tool invocations. After 8 calls, any further `do` step is blocked:

```json
{"event":"budget.exceeded","limit":"calls","used":8,"max":8}
```

`deny web.post` prevents the agent from submitting forms, posting data, or writing to external services during research.

## Audit Log

```json
{"event":"run.started","agent":"research_brief","version":"v0"}
{"event":"tool.allowed","tool":"web.search","step":1}
{"event":"tool.result","tool":"web.search","bind":"hits"}
{"event":"tool.allowed","tool":"web.open","step":2}
{"event":"tool.result","tool":"web.open","bind":"pages"}
{"event":"make.result","bind":"brief","type":"markdown"}
{"event":"check.passed","condition":"brief has citations"}
{"event":"run.finished","status":"success"}
```

## What This Proves

- **Budget enforcement**: `budget calls=8` prevents runaway tool usage — the agent cannot make unbounded API calls
- **Read-only web access**: `deny web.post` ensures the agent can consume information but never publish or submit data
- **Citation requirement**: `check brief has citations` forces the model to back claims with sources rather than hallucinating
- **Fact/inference separation**: the `make` instructions require the model to clearly distinguish between established facts and its own reasoning
