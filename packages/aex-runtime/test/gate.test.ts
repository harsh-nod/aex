import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CLAUDE_CODE_TOOL_MAP,
  mapToolName,
  extractToolPath,
  evaluateGate,
  readBudgetState,
  writeBudgetState,
  resolvebudgetState,
  GateInput,
  BudgetState,
  EffectivePermissions,
} from "@aex-lang/runtime";

// ---------------------------------------------------------------------------
// mapToolName
// ---------------------------------------------------------------------------

describe("mapToolName", () => {
  it("maps all known Claude Code tools", () => {
    expect(mapToolName("Read")).toBe("file.read");
    expect(mapToolName("Write")).toBe("file.write");
    expect(mapToolName("Edit")).toBe("file.write");
    expect(mapToolName("MultiEdit")).toBe("file.write");
    expect(mapToolName("Glob")).toBe("file.read");
    expect(mapToolName("Grep")).toBe("file.read");
    expect(mapToolName("LS")).toBe("file.read");
    expect(mapToolName("Bash")).toBe("shell.exec");
    expect(mapToolName("WebFetch")).toBe("network.fetch");
    expect(mapToolName("WebSearch")).toBe("network.search");
    expect(mapToolName("NotebookRead")).toBe("file.read");
    expect(mapToolName("NotebookEdit")).toBe("file.write");
    expect(mapToolName("TodoRead")).toBe("todo.read");
    expect(mapToolName("TodoWrite")).toBe("todo.write");
    expect(mapToolName("Agent")).toBe("agent.spawn");
  });

  it("passes through dotted names as-is", () => {
    expect(mapToolName("mcp.custom.tool")).toBe("mcp.custom.tool");
    expect(mapToolName("network.fetch")).toBe("network.fetch");
  });

  it("maps unknown non-dotted names to unknown.*", () => {
    expect(mapToolName("SomethingNew")).toBe("unknown.SomethingNew");
    expect(mapToolName("FutureTool")).toBe("unknown.FutureTool");
  });
});

// ---------------------------------------------------------------------------
// extractToolPath
// ---------------------------------------------------------------------------

describe("extractToolPath", () => {
  it("extracts file_path from Read/Write/Edit", () => {
    expect(extractToolPath("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(extractToolPath("Write", { file_path: "/x.ts", content: "..." })).toBe("/x.ts");
    expect(extractToolPath("Edit", { file_path: "/c.ts", old_string: "a", new_string: "b" })).toBe("/c.ts");
  });

  it("extracts notebook_path from NotebookEdit", () => {
    expect(extractToolPath("NotebookEdit", { notebook_path: "/nb.ipynb" })).toBe("/nb.ipynb");
  });

  it("extracts path from Glob/Grep/LS", () => {
    expect(extractToolPath("Glob", { path: "/src", pattern: "*.ts" })).toBe("/src");
    expect(extractToolPath("Grep", { path: "/src", pattern: "TODO" })).toBe("/src");
    expect(extractToolPath("LS", { path: "/src" })).toBe("/src");
  });

  it("returns undefined for Bash (no path key)", () => {
    expect(extractToolPath("Bash", { command: "ls" })).toBeUndefined();
  });

  it("returns undefined for unknown tools", () => {
    expect(extractToolPath("CustomTool", { foo: "bar" })).toBeUndefined();
  });

  it("returns undefined when expected key is missing", () => {
    expect(extractToolPath("Read", { content: "..." })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateGate
// ---------------------------------------------------------------------------

function makeInput(toolName: string, toolInput: Record<string, unknown> = {}): GateInput {
  return {
    session_id: "test-session",
    cwd: "/test",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

describe("evaluateGate", () => {
  const basePermissions: EffectivePermissions = {
    allow: ["file.read", "file.write", "tests.run", "shell.exec"],
    deny: ["network.*", "secrets.read"],
    confirm: ["file.write"],
    budget: undefined,
  };

  it("allows a tool in the allow list", () => {
    const result = evaluateGate(makeInput("Read"), basePermissions);
    expect(result.output.permissionDecision).toBe("allow");
  });

  it("denies a tool in the deny list", () => {
    const result = evaluateGate(makeInput("WebFetch"), basePermissions);
    expect(result.output.permissionDecision).toBe("deny");
    expect(result.output.reason).toContain("denied by policy");
  });

  it("denies a tool matching deny wildcard", () => {
    const result = evaluateGate(makeInput("WebSearch"), basePermissions);
    expect(result.output.permissionDecision).toBe("deny");
  });

  it("denies a tool not in the allow list", () => {
    const permissions: EffectivePermissions = {
      allow: ["file.read"],
      deny: [],
      confirm: [],
    };
    const result = evaluateGate(makeInput("Bash"), permissions);
    expect(result.output.permissionDecision).toBe("deny");
    expect(result.output.reason).toContain("not in the allow list");
  });

  it("returns ask for a tool requiring confirmation", () => {
    const result = evaluateGate(makeInput("Write"), basePermissions);
    expect(result.output.permissionDecision).toBe("ask");
    expect(result.output.message).toContain("confirmation");
  });

  it("allows a tool that requires confirmation when tool is Read (maps to file.read, not in confirm list)", () => {
    const result = evaluateGate(makeInput("Read"), basePermissions);
    expect(result.output.permissionDecision).toBe("allow");
  });

  it("deny takes precedence over allow", () => {
    const permissions: EffectivePermissions = {
      allow: ["network.fetch"],
      deny: ["network.*"],
      confirm: [],
    };
    const result = evaluateGate(makeInput("WebFetch"), permissions);
    expect(result.output.permissionDecision).toBe("deny");
    expect(result.output.reason).toContain("denied by policy");
  });

  it("handles dotted tool names passed through", () => {
    const permissions: EffectivePermissions = {
      allow: ["custom.tool"],
      deny: [],
      confirm: [],
    };
    const input = makeInput("custom.tool");
    const result = evaluateGate(input, permissions);
    expect(result.output.permissionDecision).toBe("allow");
  });

  it("handles unknown tools mapped to unknown.*", () => {
    const permissions: EffectivePermissions = {
      allow: ["file.read"],
      deny: [],
      confirm: [],
    };
    const input = makeInput("NewTool");
    const result = evaluateGate(input, permissions);
    expect(result.output.permissionDecision).toBe("deny");
    expect(result.output.reason).toContain("unknown.NewTool");
  });

  describe("budget enforcement", () => {
    it("allows calls within budget", () => {
      const permissions: EffectivePermissions = {
        allow: ["file.read"],
        deny: [],
        confirm: [],
        budget: 5,
      };
      const budget: BudgetState = {
        sessionId: "test",
        callsUsed: 2,
        lastUpdated: new Date().toISOString(),
      };
      const result = evaluateGate(makeInput("Read"), permissions, budget);
      expect(result.output.permissionDecision).toBe("allow");
      expect(result.budgetState!.callsUsed).toBe(3);
    });

    it("denies when budget is exhausted", () => {
      const permissions: EffectivePermissions = {
        allow: ["file.read"],
        deny: [],
        confirm: [],
        budget: 3,
      };
      const budget: BudgetState = {
        sessionId: "test",
        callsUsed: 3,
        lastUpdated: new Date().toISOString(),
      };
      const result = evaluateGate(makeInput("Read"), permissions, budget);
      expect(result.output.permissionDecision).toBe("deny");
      expect(result.output.reason).toContain("budget exhausted");
    });

    it("skips budget check when no budget defined", () => {
      const permissions: EffectivePermissions = {
        allow: ["file.read"],
        deny: [],
        confirm: [],
      };
      const result = evaluateGate(makeInput("Read"), permissions);
      expect(result.output.permissionDecision).toBe("allow");
      expect(result.budgetState).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// budget state persistence
// ---------------------------------------------------------------------------

describe("budget state", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), "aex-gate-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads null when no state file exists", async () => {
    const state = await readBudgetState(tmpDir);
    expect(state).toBeNull();
  });

  it("writes and reads budget state", async () => {
    const state: BudgetState = {
      sessionId: "s1",
      callsUsed: 5,
      lastUpdated: new Date().toISOString(),
    };
    await writeBudgetState(tmpDir, state);
    const read = await readBudgetState(tmpDir);
    expect(read).toEqual(state);
  });

  it("resolves fresh state for new session", () => {
    const existing: BudgetState = {
      sessionId: "old-session",
      callsUsed: 10,
      lastUpdated: new Date().toISOString(),
    };
    const resolved = resolvebudgetState(existing, "new-session");
    expect(resolved.sessionId).toBe("new-session");
    expect(resolved.callsUsed).toBe(0);
  });

  it("continues existing state for same session", () => {
    const existing: BudgetState = {
      sessionId: "same-session",
      callsUsed: 7,
      lastUpdated: new Date().toISOString(),
    };
    const resolved = resolvebudgetState(existing, "same-session");
    expect(resolved.callsUsed).toBe(7);
  });

  it("resets stale state", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const existing: BudgetState = {
      sessionId: "same-session",
      callsUsed: 50,
      lastUpdated: fiveHoursAgo,
    };
    const resolved = resolvebudgetState(existing, "same-session");
    expect(resolved.callsUsed).toBe(0);
  });

  it("resolves fresh state when existing is null", () => {
    const resolved = resolvebudgetState(null, "new-session");
    expect(resolved.sessionId).toBe("new-session");
    expect(resolved.callsUsed).toBe(0);
  });
});
