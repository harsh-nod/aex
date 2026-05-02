import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile as childExecFile } from "node:child_process";
import {
  runTask,
  ToolRegistry,
  composePolicies,
  resolvePolicy,
  createStructuredLogger,
} from "@aex-lang/runtime";
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

describe("if/for control flow", () => {
  it("executes if body when condition is true", async () => {
    const taskPath = await writeTempTask(`agent if_true v0

goal "If true"

use tests.success

need val: str

do tests.success(input=val) -> result

if result.success
  do tests.success(input=val) -> inner

return inner
`);

    const result = await runTask(taskPath, {
      inputs: { val: "yes" },
      tools: TOOLS,
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ success: true });
  });

  it("skips if body when condition is false", async () => {
    const taskPath = await writeTempTask(`agent if_false v0

goal "If false"

use tests.success, tests.fail

need val: str

do tests.fail() -> result

if result.success
  do tests.success(input=val) -> inner

return result
`);

    const result = await runTask(taskPath, {
      inputs: { val: "yes" },
      tools: TOOLS,
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ success: false });
  });

  it("iterates for loop over list", async () => {
    const events: Array<Record<string, unknown>> = [];
    const taskPath = await writeTempTask(`agent for_loop v0

goal "Loop"

use context.load

need items: list[str]

for item in items
  do context.load(key=item) -> loaded

return loaded
`);

    const result = await runTask(taskPath, {
      inputs: { items: ["a", "b", "c"], a: "A", b: "B", c: "C" },
      tools: TOOLS,
      logger: (event) => events.push(event.data ?? {}),
    });

    expect(result.status).toBe("success");
    const forEvents = events.filter((e) => "count" in e);
    expect(forEvents[0]).toEqual({ variable: "item", count: 3 });
  });

  it("budget counts per for iteration", async () => {
    const taskPath = await writeTempTask(`agent for_budget v0

goal "Budget in loop"

use tests.success

need items: list[str]

budget calls=2

for item in items
  do tests.success(input=item) -> r

return r
`);

    const result = await runTask(taskPath, {
      inputs: { items: ["a", "b", "c"] },
      tools: TOOLS,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("budget exhausted");
  });
});

describe("matchesAny", () => {
  it("returns true when any pattern matches", () => {
    expect(matchesAny("file.read", ["network.*", "file.*"])).toBe(true);
    expect(matchesAny("file.read", ["network.*", "shell.*"])).toBe(false);
  });
});

describe("policy composition", () => {
  it("merges allow, deny, and confirmation lists", () => {
    const base = {
      allow: ["file.read", "file.write"],
      deny: ["network.*"],
      require_confirmation: ["file.write"],
      budget: { calls: 20 },
    };
    const overlay = {
      allow: ["tests.run"],
      deny: ["secrets.read"],
      require_confirmation: ["tests.run"],
      budget: { calls: 10 },
    };
    const merged = composePolicies(base, overlay);
    expect(merged.allow).toContain("file.read");
    expect(merged.allow).toContain("tests.run");
    expect(merged.deny).toContain("network.*");
    expect(merged.deny).toContain("secrets.read");
    expect(merged.require_confirmation).toContain("file.write");
    expect(merged.require_confirmation).toContain("tests.run");
    expect(merged.budget?.calls).toBe(10);
  });

  it("takes minimum budget from composed policies", () => {
    const a = { budget: { calls: 100, dollars: 50 } };
    const b = { budget: { calls: 5, dollars: 200 } };
    const merged = composePolicies(a, b);
    expect(merged.budget?.calls).toBe(5);
    expect(merged.budget?.dollars).toBe(50);
  });

  it("deduplicates allow/deny entries", () => {
    const a = { allow: ["file.read", "file.write"] };
    const b = { allow: ["file.read", "tests.run"] };
    const merged = composePolicies(a, b);
    expect(merged.allow?.filter((x) => x === "file.read")).toHaveLength(1);
  });
});

describe("policy inheritance", () => {
  it("resolves inline extends", async () => {
    const child = {
      extends: {
        allow: ["file.read"],
        deny: ["network.*"],
      },
      allow: ["tests.run"],
      budget: { calls: 5 },
    };
    const resolved = await resolvePolicy(child);
    expect(resolved.allow).toContain("file.read");
    expect(resolved.allow).toContain("tests.run");
    expect(resolved.deny).toContain("network.*");
    expect(resolved.budget?.calls).toBe(5);
  });

  it("resolves file-based extends", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-policy-"));
    const basePath = path.join(dir, "base.json");
    await fs.writeFile(
      basePath,
      JSON.stringify({
        allow: ["file.read"],
        deny: ["secrets.read"],
        budget: { calls: 50 },
      }),
      "utf8",
    );
    const child = {
      extends: basePath,
      allow: ["tests.run"],
      budget: { calls: 10 },
    };
    const resolved = await resolvePolicy(child);
    expect(resolved.allow).toContain("file.read");
    expect(resolved.allow).toContain("tests.run");
    expect(resolved.deny).toContain("secrets.read");
    expect(resolved.budget?.calls).toBe(10);
  });

  it("applies inherited policy at runtime", async () => {
    const taskPath = await writeTempTask(`agent policy_inherit v0

goal "Policy inheritance"

use tests.success

budget calls=100

do tests.success(input=val) -> r1
do tests.success(input=val) -> r2

return r2
`);

    const result = await runTask(taskPath, {
      inputs: { val: "ok" },
      tools: TOOLS,
      policy: {
        extends: { budget: { calls: 50 } },
        budget: { calls: 1 },
      },
    });
    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("budget exhausted");
  });
});

describe("structured logger", () => {
  it("captures events with timestamps and trace IDs", () => {
    const logger = createStructuredLogger("test-agent");
    logger.log({ event: "run.started", data: { agent: "test" } });
    logger.log({ event: "tool.allowed", data: { tool: "file.read" } });

    const events = logger.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBeDefined();
    expect(events[0].traceId).toBeDefined();
    expect(events[0].spanId).toBeDefined();
    expect(events[0].traceId).toBe(events[1].traceId);
    expect(events[0].spanId).not.toBe(events[1].spanId);
  });

  it("exports as JSON", () => {
    const logger = createStructuredLogger();
    logger.log({ event: "check.passed" });
    const json = JSON.parse(logger.toJSON());
    expect(json).toHaveLength(1);
    expect(json[0].event).toBe("check.passed");
  });

  it("exports as OTLP payload", () => {
    const logger = createStructuredLogger("my-agent");
    logger.log({ event: "run.started", data: { agent: "my-agent" } });
    logger.log({ event: "tool.allowed", data: { tool: "file.read" } });

    const otlp = logger.toOTLP();
    expect(otlp.resourceSpans).toHaveLength(1);
    expect(otlp.resourceSpans[0].resource.attributes[0].value.stringValue).toBe("my-agent");
    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe("run.started");
    expect(spans[0].attributes.find((a) => a.key === "aex.event")?.value.stringValue).toBe("run.started");
  });

  it("integrates with runTask logger option", async () => {
    const logger = createStructuredLogger();
    const taskPath = await writeTempTask(`agent logger_test v0

goal "Structured logging"

use tests.success

do tests.success(input=true) -> result

return result
`);
    await runTask(taskPath, {
      tools: TOOLS,
      logger: (event) => logger.log(event),
    });

    const events = logger.getEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.find((e) => e.event === "run.started")).toBeDefined();
    expect(events.find((e) => e.event === "run.finished")).toBeDefined();
  });
});

describe("remote tool registry", () => {
  it("passes registry option to runTask", async () => {
    const taskPath = await writeTempTask(`agent registry_test v0

goal "Test custom tools"

use custom.echo

do custom.echo(msg=val) -> result

return result
`);
    const result = await runTask(taskPath, {
      inputs: { val: "hello" },
      tools: {
        "custom.echo": {
          sideEffect: "none",
          handler: async (args) => ({ echo: args.msg }),
        },
      },
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ echo: "hello" });
  });
});

describe("budget enforcement", () => {
  it("blocks when contract budget is exceeded", async () => {
    const taskPath = await writeTempTask(`agent budget_test v0

goal "Test budget"

use tests.success

budget calls=1

do tests.success(input=val) -> r1
do tests.success(input=val) -> r2

return r2
`);

    const result = await runTask(taskPath, {
      inputs: { val: "ok" },
      tools: TOOLS,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("budget exhausted");
  });

  it("allows execution within budget", async () => {
    const taskPath = await writeTempTask(`agent budget_ok v0

goal "Within budget"

use tests.success

budget calls=5

do tests.success(input=val) -> r1

check r1.success

return r1
`);

    const result = await runTask(taskPath, {
      inputs: { val: "ok" },
      tools: TOOLS,
    });

    expect(result.status).toBe("success");
  });

  it("policy budget overrides when lower than contract", async () => {
    const taskPath = await writeTempTask(`agent budget_policy v0

goal "Policy override"

use tests.success

budget calls=10

do tests.success(input=val) -> r1
do tests.success(input=val) -> r2

return r2
`);

    const result = await runTask(taskPath, {
      inputs: { val: "ok" },
      tools: TOOLS,
      policy: { budget: { calls: 1 } },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues[0]).toContain("budget exhausted");
  });
});
