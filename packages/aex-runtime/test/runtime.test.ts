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
  "text.provide": {
    sideEffect: "none",
    handler: async (args) => String(args.value ?? ""),
  },
  "context.load": {
    sideEffect: "none",
    handler: async (args, ctx) => {
      if (typeof args.key === "string") {
        return ctx.inputs[args.key];
      }
      return args.key;
    },
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

  it("evaluates string inclusion checks", async () => {
    const taskPath = await writeTempTask(`agent runtime_review v0

goal "Validate review text"

use text.provide

need review_text: str

do text.provide(value=review_text) -> review

check review has "Blocking issues"
check review has "Suggestions"

return review
`);

    const ok = await runTask(taskPath, {
      inputs: {
        review_text: "Blocking issues:\n- Example\n\nSuggestions:\n- More tests",
      },
      tools: TOOLS,
    });

    expect(ok.status).toBe("success");

    const bad = await runTask(taskPath, {
      inputs: {
        review_text: "Suggestions only.",
      },
      tools: TOOLS,
    });

    expect(bad.status).toBe("blocked");
    expect(bad.issues[0]).toContain("Blocking issues");
  });

  it("detects forbidden substrings via does not include", async () => {
    const taskPath = await writeTempTask(`agent runtime_support v0

goal "Ensure reply does not leak notes"

use context.load, text.provide

need message: str
need profile: object

do context.load(key="profile") -> customer
do text.provide(value=message) -> reply

check reply does not include customer.internal_notes

return reply
`);

    const result = await runTask(taskPath, {
      inputs: {
        profile: { internal_notes: "SECRET", email: "user@example.com" },
        message: "Hello! Your issue is resolved.",
      },
      tools: TOOLS,
    });
    expect(result.status).toBe("success");

    const blocked = await runTask(taskPath, {
      inputs: {
        profile: { internal_notes: "SECRET", email: "user@example.com" },
        message: "Hello SECRET customer",
      },
      tools: TOOLS,
    });
    expect(blocked.status).toBe("blocked");
  });

  it("passes citation checks", async () => {
    const taskPath = await writeTempTask(`agent runtime_research v0

goal "Check citations"

use text.provide

need body: str

do text.provide(value=body) -> brief

check brief has citations

return brief
`);

    const ok = await runTask(taskPath, {
      inputs: {
        body: "See [Doc](https://example.com) for details.",
      },
      tools: TOOLS,
    });
    expect(ok.status).toBe("success");

    const blocked = await runTask(taskPath, {
      inputs: {
        body: "No references here.",
      },
      tools: TOOLS,
    });
    expect(blocked.status).toBe("blocked");
  });
});
