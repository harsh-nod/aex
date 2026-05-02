import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { compileFileToLangGraph, taskToLangGraph } from "../src/index.js";
import type { AEXTask } from "@aex-lang/parser";

async function writeContract(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-langgraph-"));
  const filePath = path.join(dir, "task.aex");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("langgraph compiler", () => {
  it("compiles an AEX file into a LangGraph plan", async () => {
    const filePath = await writeContract(`agent compile_demo v0

goal "Demonstrate compilation"

use tests.run, file.write

need test_cmd: str

do tests.run(cmd=test_cmd) -> first_run
check first_run.passed

do file.write(path="tmp.txt", contents="hello") -> write_result

return {
  status: "complete",
  written: write_result.written
}
`);

    const plan = await compileFileToLangGraph(filePath);
    expect(plan.start).toBeTruthy();
    const nodeIds = Object.keys(plan.nodes);
    expect(nodeIds).toHaveLength(4);
    const first = plan.nodes[plan.start ?? ""];
    expect(first.kind).toBe("do");
    expect(first.data.tool).toBe("tests.run");
    expect(plan.nodes[first.next ?? ""]?.kind).toBe("check");
    expect(plan.metadata.goal).toBe("Demonstrate compilation");
    expect(plan.metadata.source).toMatch(/task\.aex$/);
  });

  it("throws when the contract has validation errors", async () => {
    const file = await writeContract(`agent invalid v0

goal "Missing return"

use file.write

do file.write(path="x", contents="y")
`);
    await expect(compileFileToLangGraph(file)).rejects.toThrow(
      /missing a return statement/i,
    );
  });

  it("derives nodes directly from an AEXTask", () => {
    const task: AEXTask = {
      agent: { name: "direct", version: "0" },
      goal: "Direct conversion",
      use: ["tool.example"],
      deny: [],
      needs: {},
      steps: [
        {
          kind: "do",
          tool: "tool.example",
          args: { payload: "value" },
          bind: "result",
          line: 10,
        },
        {
          kind: "return",
          expression: "result",
          line: 11,
        },
      ],
      returnStatement: "result",
    };

    const plan = taskToLangGraph(task);
    expect(plan.start).toBe("result");
    expect(plan.nodes.result.next).toBe("return-1");
    expect(plan.nodes["return-1"].kind).toBe("return");
  });
});
