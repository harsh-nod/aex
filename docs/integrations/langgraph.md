# LangGraph

Compile an AEX contract into a guarded LangGraph flow. Each `do`, `make`, `check`, and `confirm` step becomes a typed node in the resulting plan.

```ts
import { compileFileToLangGraph } from "@aex/langgraph";

const plan = await compileFileToLangGraph("tasks/fix-test.aex");
const graph = new LangGraph(plan);
graph.run({ test_cmd: "npm test" });
```

The compiler validates the contract before emitting nodes. If the plan fails verification, the CLI emits the exact line, severity, and error code so you can fix the contract before wiring it into your agent.
