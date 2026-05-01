# OpenAI Agents SDK

Use the [`@aex/openai-agents`](https://github.com/harsh-nod/aex/tree/main/packages/aex-openai-agents) package to wrap an existing tool-enabled agent with an AEX guardrail.

```ts
import { AEXGuardedAgent } from "@aex/openai-agents";
import { fileReadTool, fileWriteTool } from "./tools";

const agent = new AEXGuardedAgent({
  taskPath: "tasks/fix-test.aex",
  tools: {
    "file.read": fileReadTool,
    "file.write": fileWriteTool,
  },
});

const result = await agent.run({
  test_cmd: "npm test",
  target_files: ["src/foo.ts", "test/foo.test.ts"],
});

if (result.status === "blocked") {
  throw new Error(result.issues.join(", "));
}

console.log(result.output);
```

Under the hood the adapter delegates to the shared runtime, so tool permissions, confirmation gates, budgets, and checks declared in the `.aex` file are enforced before your agent executes.
