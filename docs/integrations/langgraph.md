# LangGraph

The [`@aex-lang/langgraph`](https://github.com/harsh-nod/aex/tree/main/packages/aex-langgraph) package compiles AEX contracts into execution graphs. Each `do`, `make`, `check`, `confirm`, and `return` step becomes a typed node in a DAG that you can wire into LangGraph or any graph-based execution framework.

## Installation

```bash
npm install @aex-lang/langgraph
```

## Quick Start

```ts
import { compileFileToLangGraph } from "@aex-lang/langgraph";

const plan = await compileFileToLangGraph("tasks/fix-test.aex");

console.log("Start:", plan.start);
console.log("Nodes:", Object.keys(plan.nodes).length);
console.log("Agent:", plan.metadata.agent);

// Wire each node into your graph execution framework
for (const [id, node] of Object.entries(plan.nodes)) {
  console.log(`${id}: ${node.kind} → ${node.next ?? "end"}`);
}
```

Output:

```
Start: tests_run_1
Nodes: 8
Agent: fix_test
tests_run_1: do → file_read_2
file_read_2: do → patch_3
patch_3: make → check_4
check_4: check → check_5
check_5: check → confirm_6
confirm_6: confirm → file_write_7
file_write_7: do → return_8
return_8: return → end
```

## API Reference

### `compileFileToLangGraph(filePath, options?)`

Compiles an `.aex` file into a `LangGraphPlan`.

```ts
async function compileFileToLangGraph(
  filePath: string,
  options?: { tolerant?: boolean },
): Promise<LangGraphPlan>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filePath` | `string` | — | Path to `.aex` contract file |
| `tolerant` | `boolean` | `true` | Return diagnostics instead of throwing on errors |

Throws if validation fails and `tolerant` is `false`. Error format: `"Unable to compile AEX contract: line X: message"`.

### `taskToLangGraph(task)`

Converts an already-parsed `AEXTask` object into a plan. Use this when you've already parsed the contract elsewhere.

```ts
function taskToLangGraph(task: AEXTask): LangGraphPlan
```

### `LangGraphPlan`

```ts
interface LangGraphPlan {
  start: string | null;
  nodes: Record<string, LangGraphNode>;
  metadata: {
    agent?: string;
    goal?: string;
    source?: string;   // Absolute path to source .aex file
  };
}
```

### `LangGraphNode`

```ts
interface LangGraphNode {
  id: string;
  kind: "do" | "make" | "check" | "confirm" | "return" | "if" | "for";
  data: Record<string, unknown>;
  next?: string;
  line: number;        // Source line number in the .aex file
}
```

The `data` field contains the serialized step — tool name and arguments for `do` nodes, condition for `check` nodes, instructions for `make` nodes, etc.

## Working with Nodes

### `do` nodes

```ts
// data: { tool: "tests.run", args: { cmd: "test_cmd" }, bind: "failure" }
if (node.kind === "do") {
  const tool = node.data.tool as string;
  const args = node.data.args as Record<string, string>;
  const result = await callTool(tool, args);
  context[node.data.bind as string] = result;
}
```

### `make` nodes

```ts
// data: { bind: "patch", type: "diff", inputs: ["failure", "sources"],
//         instructions: ["fix the failing test", "preserve public behavior"] }
if (node.kind === "make") {
  const artifact = await generateWithModel(node.data);
  context[node.data.bind as string] = artifact;
}
```

### `check` nodes

```ts
// data: { condition: "patch is valid diff" }
if (node.kind === "check") {
  const passed = evaluateCheck(node.data.condition, context);
  if (!passed) throw new Error(`Check failed: ${node.data.condition}`);
}
```

### `confirm` nodes

```ts
// data: { before: "file.write" }
if (node.kind === "confirm") {
  const approved = await requestApproval(node.data.before as string);
  if (!approved) throw new Error(`Denied: ${node.data.before}`);
}
```

## End-to-End Example

Given this contract:

```aex
task fix_test v0

goal "Fix the failing test."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior

check patch is valid diff
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result

return {
  status: "fixed",
  patch: patch
}
```

Compile and inspect:

```ts
import { compileFileToLangGraph } from "@aex-lang/langgraph";

const plan = await compileFileToLangGraph("tasks/fix-test.aex");

// Traverse the graph
let current = plan.start;
while (current) {
  const node = plan.nodes[current];
  console.log(`[${node.kind}] ${node.id} (line ${node.line})`);
  current = node.next ?? null;
}
```

```
[do] tests_run_1 (line 12)
[do] file_read_2 (line 13)
[make] patch_3 (line 15)
[check] check_4 (line 20)
[check] check_5 (line 21)
[confirm] confirm_6 (line 22)
[do] file_write_7 (line 24)
[return] return_8 (line 26)
```

## Error Handling

When a contract has validation errors:

```ts
try {
  const plan = await compileFileToLangGraph("tasks/bad.aex", {
    tolerant: false,
  });
} catch (err) {
  console.error(err.message);
  // "Unable to compile AEX contract: line 8: Tool "network.fetch" is denied by the contract."
}
```

With `tolerant: true` (default), the plan is still returned but may have incomplete nodes. Use validation separately:

```ts
import { parseFile } from "@aex-lang/parser";
import { validateParsed } from "@aex-lang/validator";

const parsed = await parseFile("tasks/fix-test.aex", { tolerant: true });
const result = validateParsed(parsed);

if (result.issues.some((i) => i.severity === "error")) {
  console.log("Validation errors:", result.issues);
}
```

## See Also

- [OpenAI Agents SDK](/integrations/openai-agents) — higher-level agent wrapper with runtime enforcement
- [Language Overview](/language/overview) — all AEX keywords and step types
- [CLI Reference](/reference/cli) — `aex compile` outputs a similar IR as JSON
