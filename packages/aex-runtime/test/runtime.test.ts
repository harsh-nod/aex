import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runTask, ToolRegistry } from "@aex/runtime";

const TOOLS: ToolRegistry = {
  "tests.success": {
    sideEffect: "none",
    handler: async (args) => {
      return {
        success: Boolean(args.input),
      };
    },
  },
  "tests.fail": {
    sideEffect: "none",
    handler: async () => ({ success: false }),
  },
};

async function writeTempTask(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-runtime-"));
  const filePath = path.join(dir, "task.aex");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("runtime", () => {
  it("executes allowed tools and returns structured output", async () => {
    const taskPath = await writeTempTask(`agent runtime_success v0

goal "Succeeds"

use tests.success

need value: str

do tests.success(input=value) -> outcome

check outcome.success

return outcome
`);

    const result = await runTask(taskPath, {
      inputs: { value: "ok" },
      tools: TOOLS,
    });

    expect(result.status).toBe("success");
    expect(result.issues).toHaveLength(0);
    expect(result.output).toEqual({ success: true });
  });

  it("blocks when tool is not declared in use", async () => {
    const taskPath = await writeTempTask(`agent runtime_block v0

goal "Blocks unused tool"

use tests.success

do tests.fail() -> outcome

return outcome
`);

    const result = await runTask(taskPath, {
      tools: TOOLS,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain('Tool "tests.fail" is not declared in use');
  });

  it("requires confirmation when confirm step present", async () => {
    const taskPath = await writeTempTask(`agent runtime_confirm v0

goal "Needs confirmation"

use tests.success

confirm before tests.success

do tests.success(input=true) -> outcome

return outcome
`);

    const result = await runTask(taskPath, {
      tools: TOOLS,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("requires confirmation");

    const approved = await runTask(taskPath, {
      tools: TOOLS,
      confirm: async () => true,
    });

    expect(approved.status).toBe("success");
  });
});
