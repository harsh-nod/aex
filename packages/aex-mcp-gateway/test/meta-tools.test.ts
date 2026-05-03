import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isMetaTool,
  handleMetaTool,
  META_TOOL_DEFINITIONS,
  type MetaToolContext,
  type ToolCallRecord,
} from "../src/meta-tools";
import { AEXProxy, type ProxyOptions } from "../src/index";
import type { RuntimeEvent } from "@aex-lang/runtime";

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "aex-meta-"));
}

function createContext(
  cwd: string,
  overrides?: Partial<MetaToolContext>,
): MetaToolContext {
  return {
    cwd,
    callsUsed: 3,
    budget: 10,
    toolHistory: [
      {
        tool: "file.read",
        timestamp: "2026-05-02T10:00:00Z",
        decision: "forward",
      },
      {
        tool: "tests.run",
        timestamp: "2026-05-02T10:01:00Z",
        decision: "forward",
      },
      {
        tool: "network.fetch",
        timestamp: "2026-05-02T10:02:00Z",
        decision: "block",
        reason: "deny_list",
      },
    ],
    auditEvents: [
      { event: "tool.allowed", data: { tool: "file.read" } },
      { event: "tool.allowed", data: { tool: "tests.run" } },
      {
        event: "tool.denied",
        data: { tool: "network.fetch", reason: "deny_list" },
      },
    ],
    permissions: {
      allow: ["file.read", "file.write", "tests.run"],
      deny: ["network.*", "secrets.read"],
      confirm: ["file.write"],
      budget: 10,
    },
    restoreState: () => {},
    ...overrides,
  };
}

describe("isMetaTool", () => {
  it("returns true for known meta-tools", () => {
    expect(isMetaTool("aex.checkpoint")).toBe(true);
    expect(isMetaTool("aex.resume")).toBe(true);
    expect(isMetaTool("aex.list_tasks")).toBe(true);
    expect(isMetaTool("aex.review_task")).toBe(true);
  });

  it("returns false for non-meta-tools", () => {
    expect(isMetaTool("file.read")).toBe(false);
    expect(isMetaTool("aex.unknown")).toBe(false);
    expect(isMetaTool("network.fetch")).toBe(false);
  });
});

describe("aex.checkpoint", () => {
  it("creates checkpoint directory and files", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    const result = (await handleMetaTool(
      "aex.checkpoint",
      { name: "test-cp" },
      ctx,
    )) as { path: string; message: string };

    expect(result.path).toBe(".aex/checkpoints/test-cp/");
    expect(result.message).toContain("test-cp");

    // Verify checkpoint.json
    const cpPath = path.join(
      cwd,
      ".aex",
      "checkpoints",
      "test-cp",
      "checkpoint.json",
    );
    const cpRaw = await fs.readFile(cpPath, "utf8");
    const cp = JSON.parse(cpRaw);
    expect(cp.name).toBe("test-cp");
    expect(cp.callsUsed).toBe(3);
    expect(cp.budget).toBe(10);
    expect(cp.toolHistory).toHaveLength(3);

    // Verify audit.jsonl
    const auditPath = path.join(
      cwd,
      ".aex",
      "checkpoints",
      "test-cp",
      "audit.jsonl",
    );
    const auditRaw = await fs.readFile(auditPath, "utf8");
    const lines = auditRaw.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("saves description when provided", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    await handleMetaTool(
      "aex.checkpoint",
      { name: "with-desc", description: "Fixed auth bug" },
      ctx,
    );

    const cpPath = path.join(
      cwd,
      ".aex",
      "checkpoints",
      "with-desc",
      "checkpoint.json",
    );
    const cp = JSON.parse(await fs.readFile(cpPath, "utf8"));
    expect(cp.description).toBe("Fixed auth bug");
  });

  it("rejects invalid checkpoint names", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    await expect(
      handleMetaTool("aex.checkpoint", { name: "../etc" }, ctx),
    ).rejects.toThrow("Invalid checkpoint name");
    await expect(
      handleMetaTool("aex.checkpoint", { name: "foo/bar" }, ctx),
    ).rejects.toThrow("Invalid checkpoint name");
    await expect(
      handleMetaTool("aex.checkpoint", { name: "" }, ctx),
    ).rejects.toThrow("Invalid checkpoint name");
  });
});

describe("aex.resume", () => {
  it("loads checkpoint and restores state", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    // Save checkpoint first
    await handleMetaTool("aex.checkpoint", { name: "resume-test" }, ctx);

    // Resume with different state
    let restoredCalls = 0;
    let restoredHistory: ToolCallRecord[] = [];
    const resumeCtx = createContext(cwd, {
      callsUsed: 0,
      toolHistory: [],
      restoreState: (calls, history) => {
        restoredCalls = calls;
        restoredHistory = history;
      },
    });

    const result = (await handleMetaTool(
      "aex.resume",
      { name: "resume-test" },
      resumeCtx,
    )) as {
      name: string;
      callsUsed: number;
      toolsCalled: string[];
      budgetRemaining?: number;
    };

    expect(result.name).toBe("resume-test");
    expect(result.callsUsed).toBe(3);
    expect(result.toolsCalled).toContain("file.read");
    expect(result.toolsCalled).toContain("tests.run");
    expect(result.toolsCalled).toContain("network.fetch");
    expect(result.budgetRemaining).toBe(7);

    // Verify restoreState was called
    expect(restoredCalls).toBe(3);
    expect(restoredHistory).toHaveLength(3);
  });

  it("errors on missing checkpoint", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    await expect(
      handleMetaTool("aex.resume", { name: "nonexistent" }, ctx),
    ).rejects.toThrow("not found");
  });
});

describe("aex.list_tasks", () => {
  it("returns empty when no directories exist", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    const result = (await handleMetaTool("aex.list_tasks", {}, ctx)) as {
      tasks: unknown[];
    };
    expect(result.tasks).toEqual([]);
  });

  it("finds tasks and checkpoints", async () => {
    const cwd = await createTempDir();

    // Create tasks dir with a .aex file
    const tasksDir = path.join(cwd, "tasks");
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, "fix-test.aex"),
      `task fix_test v0\n\ngoal "Fix the test."\n\nuse file.read, tests.run\ndeny network.*\n\nreturn {}\n`,
      "utf8",
    );

    // Create a checkpoint
    const ctx = createContext(cwd);
    await handleMetaTool(
      "aex.checkpoint",
      { name: "my-cp", description: "Checkpoint desc" },
      ctx,
    );

    const result = (await handleMetaTool("aex.list_tasks", {}, ctx)) as {
      tasks: Array<{ name: string; type: string; goal?: string }>;
    };

    expect(result.tasks.length).toBeGreaterThanOrEqual(2);

    const taskEntry = result.tasks.find((t) => t.type === "task");
    expect(taskEntry).toBeDefined();
    expect(taskEntry!.name).toBe("fix_test");
    expect(taskEntry!.goal).toBe("Fix the test.");

    const cpEntry = result.tasks.find((t) => t.type === "checkpoint");
    expect(cpEntry).toBeDefined();
    expect(cpEntry!.name).toBe("my-cp");
  });
});

describe("aex.review_task", () => {
  it("returns review summary for a valid contract", async () => {
    const cwd = await createTempDir();
    const tasksDir = path.join(cwd, "tasks");
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, "review.aex"),
      `task review_pr v0

goal "Review a pull request."

use git.diff, file.read
deny file.write, network.*

need pr_diff: file

do git.diff(path=pr_diff) -> diff

make review: markdown from diff with:
  - identify risks

check review has "Blocking issues"

return review
`,
      "utf8",
    );

    const ctx = createContext(cwd);
    const result = (await handleMetaTool(
      "aex.review_task",
      { task: "tasks/review.aex" },
      ctx,
    )) as {
      task: string;
      goal: string;
      requested: string[];
      effective: { allow: string[]; deny: string[] };
      checks: string[];
      makeSteps: string[];
      valid: boolean;
    };

    expect(result.task).toBe("review_pr");
    expect(result.goal).toBe("Review a pull request.");
    expect(result.requested).toContain("git.diff");
    expect(result.requested).toContain("file.read");
    expect(result.checks).toContain('review has "Blocking issues"');
    expect(result.makeSteps).toHaveLength(1);
    expect(result.valid).toBe(true);
    // git.diff is not in the proxy's allow list, so it should have a warning
    expect(result.effective.deny).toContain("file.write");
  });

  it("errors on missing file", async () => {
    const cwd = await createTempDir();
    const ctx = createContext(cwd);

    await expect(
      handleMetaTool("aex.review_task", { task: "nonexistent.aex" }, ctx),
    ).rejects.toThrow("Cannot read task file");
  });
});

describe("AEXProxy meta-tool integration", () => {
  function createTestProxy(
    overrides: Partial<ProxyOptions["permissions"]> = {},
  ): { proxy: AEXProxy; events: RuntimeEvent[] } {
    const events: RuntimeEvent[] = [];
    const permissions = {
      allow: ["file.read", "file.write", "tests.run"],
      deny: ["network.*"],
      confirm: ["file.write"],
      budget: 10,
      ...overrides,
    };
    const proxy = new AEXProxy({
      permissions,
      logger: (ev) => events.push(ev),
    });
    return { proxy, events };
  }

  it("returns meta decision for aex.checkpoint", () => {
    const { proxy } = createTestProxy();
    const decision = proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "aex.checkpoint", arguments: { name: "test" } },
    });
    expect(decision.action).toBe("meta");
    if (decision.action === "meta") {
      expect(decision.toolName).toBe("aex.checkpoint");
      expect(decision.params).toEqual({ name: "test" });
    }
  });

  it("returns meta decision for aex.list_tasks", () => {
    const { proxy } = createTestProxy();
    const decision = proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "aex.list_tasks" },
    });
    expect(decision.action).toBe("meta");
  });

  it("does not treat non-meta aex-prefixed tools as meta", () => {
    const { proxy } = createTestProxy({ allow: ["aex.something"] });
    const decision = proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "aex.something" },
    });
    expect(decision.action).toBe("forward");
  });

  it("injects meta-tool definitions into tools/list", () => {
    const { proxy } = createTestProxy();
    const response = proxy.filterToolsList({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "file.read", description: "Read files" }],
      },
    });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("file.read");
    expect(names).toContain("aex.checkpoint");
    expect(names).toContain("aex.resume");
    expect(names).toContain("aex.list_tasks");
    expect(names).toContain("aex.review_task");
    expect(tools.length).toBe(1 + META_TOOL_DEFINITIONS.length);
  });

  it("records tool call history", () => {
    const { proxy } = createTestProxy();
    proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "file.read" },
    });
    proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "network.fetch" },
    });
    const history = proxy.history;
    expect(history).toHaveLength(2);
    expect(history[0].tool).toBe("file.read");
    expect(history[0].decision).toBe("forward");
    expect(history[1].tool).toBe("network.fetch");
    expect(history[1].decision).toBe("block");
    expect(history[1].reason).toBe("deny_list");
  });
});
