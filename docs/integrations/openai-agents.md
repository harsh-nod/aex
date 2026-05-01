# OpenAI Agents SDK

Wrap an existing tool-enabled agent with an AEX guardrail.

```python
from aex_openai import load_task, AEXGuardedAgent

task = load_task("tasks/fix-test.aex")

agent = AEXGuardedAgent(
    task=task,
    tools=[file_read, file_write, tests_run],
)

result = agent.run(inputs={
    "test_cmd": "npm test",
    "target_files": ["src/foo.ts", "test/foo.test.ts"],
})
```

The adapter enforces tool permissions, checks, and confirmation steps declared in the contract.
