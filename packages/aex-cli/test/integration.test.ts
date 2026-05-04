import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import {
  evaluateGate,
  extractPolicyLayer,
  mergePolicyAndTask,
  runTask,
  type GateInput,
  type RuntimeEvent,
} from "@aex-lang/runtime";
import { parseFile } from "@aex-lang/parser";
import { AEXProxy } from "@aex-lang/mcp-gateway";
import { draftContract } from "../src/draft.js";

async function createTempFile(
  contents: string,
  name = "task.aex",
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-integ-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

function makeGateInput(
  toolName: string,
  overrides: Partial<GateInput> = {},
): GateInput {
  return {
    session_id: "test-session",
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: {},
    ...overrides,
  };
}

// ── Gate ──────────────────────────────────────────

describe("gate integration", () => {
  it("allows a tool in the allow list", async () => {
    const policyPath = await createTempFile(`policy workspace v0

goal "Test policy"

allow file.read, file.write
deny network.*

budget calls=10
`);
    const parsed = await parseFile(policyPath, { tolerant: true });
    const layer = extractPolicyLayer(parsed.task);
    const permissions = mergePolicyAndTask(layer);

    const { output } = evaluateGate(makeGateInput("file.read"), permissions);
    expect(output.permissionDecision).toBe("allow");
  });

  it("denies a tool in the deny list", async () => {
    const policyPath = await createTempFile(`policy workspace v0

goal "Test policy"

allow file.read
deny network.*
`);
    const parsed = await parseFile(policyPath, { tolerant: true });
    const layer = extractPolicyLayer(parsed.task);
    const permissions = mergePolicyAndTask(layer);

    const { output } = evaluateGate(makeGateInput("network.fetch"), permissions);
    expect(output.permissionDecision).toBe("deny");
  });

  it("merges policy and task — deny union, allow intersection", async () => {
    const policyPath = await createTempFile(
      `policy workspace v0

goal "Broad policy"

allow file.read, file.write, tests.run, git.*
deny secrets.read
`,
      "policy.aex",
    );
    const taskPath = await createTempFile(
      `task fix_test v0

goal "Fix a test"

use file.read, tests.run
deny network.*

return {}
`,
      "task.aex",
    );

    const policyParsed = await parseFile(policyPath, { tolerant: true });
    const taskParsed = await parseFile(taskPath, { tolerant: true });
    const policyLayer = extractPolicyLayer(policyParsed.task);
    const taskLayer = extractPolicyLayer(taskParsed.task);
    const permissions = mergePolicyAndTask(policyLayer, taskLayer);

    // allow is intersection: file.read and tests.run (both in policy and task)
    expect(permissions.allow).toContain("file.read");
    expect(permissions.allow).toContain("tests.run");
    expect(permissions.allow).not.toContain("file.write"); // not in task use
    expect(permissions.allow).not.toContain("git.*"); // not in task use

    // deny is union
    expect(permissions.deny).toContain("secrets.read");
    expect(permissions.deny).toContain("network.*");
  });
});

// ── Proxy ─────────────────────────────────────────

describe("proxy integration", () => {
  function createProxy(
    overrides: Partial<{
      allow: string[];
      deny: string[];
      confirm: string[];
      budget?: number;
    }> = {},
    opts: { autoConfirm?: boolean } = {},
  ) {
    const events: RuntimeEvent[] = [];
    const permissions = {
      allow: ["file.read", "file.write", "tests.run"],
      deny: ["network.*", "secrets.read"],
      confirm: [] as string[],
      budget: undefined as number | undefined,
      ...overrides,
    };
    const proxy = new AEXProxy({
      permissions,
      autoConfirm: opts.autoConfirm,
      logger: (ev) => events.push(ev),
    });
    return { proxy, events };
  }

  it("filters denied tools from tools/list", () => {
    const { proxy } = createProxy();
    const response = proxy.filterToolsList({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "file.read", description: "Read" },
          { name: "network.fetch", description: "Fetch" },
          { name: "secrets.read", description: "Secrets" },
          { name: "file.write", description: "Write" },
        ],
      },
    });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("file.read");
    expect(names).toContain("file.write");
    expect(names).not.toContain("network.fetch");
    expect(names).not.toContain("secrets.read");
  });

  it("forwards allowed tools/call", () => {
    const { proxy, events } = createProxy();
    const decision = proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "file.read" },
    });
    expect(decision.action).toBe("forward");
    expect(events.some((e) => e.event === "tool.allowed")).toBe(true);
  });

  it("blocks denied tools/call", () => {
    const { proxy, events } = createProxy();
    const decision = proxy.handleToolsCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "network.fetch" },
    });
    expect(decision.action).toBe("block");
    expect(events.some((e) => e.event === "tool.denied")).toBe(true);
  });

  it("forwards and receives through echo MCP server", async () => {
    const { proxy } = createProxy();
    const fixtureServer = path.resolve(
      import.meta.dirname,
      "fixtures",
      "echo-mcp-server.js",
    );
    const upstream = spawn("node", [fixtureServer], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const clientIn = new PassThrough();
    const clientOut = new PassThrough();

    const proxyDone = proxy.start(clientIn, clientOut, upstream);

    // Collect output
    const lines: string[] = [];
    const reader = (await import("node:readline")).createInterface({
      input: clientOut,
    });
    reader.on("line", (line: string) => {
      if (line.trim()) lines.push(line.trim());
    });

    // Send a tools/call for an allowed tool
    clientIn.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "file.read", arguments: { path: "/tmp/test.txt" } },
      }) + "\n",
    );

    // Wait for response
    await new Promise((r) => setTimeout(r, 300));

    // Close client to signal end
    clientIn.end();
    upstream.kill();
    await proxyDone;

    expect(lines.length).toBeGreaterThan(0);
    const response = JSON.parse(lines[0]);
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
  });

  it("blocks denied tool before reaching upstream", async () => {
    const { proxy } = createProxy();
    const fixtureServer = path.resolve(
      import.meta.dirname,
      "fixtures",
      "echo-mcp-server.js",
    );
    const upstream = spawn("node", [fixtureServer], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const clientIn = new PassThrough();
    const clientOut = new PassThrough();

    const proxyDone = proxy.start(clientIn, clientOut, upstream);

    const lines: string[] = [];
    const reader = (await import("node:readline")).createInterface({
      input: clientOut,
    });
    reader.on("line", (line: string) => {
      if (line.trim()) lines.push(line.trim());
    });

    // Send a tools/call for a denied tool
    clientIn.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "network.fetch", arguments: {} },
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 200));

    clientIn.end();
    upstream.kill();
    await proxyDone;

    expect(lines.length).toBeGreaterThan(0);
    const response = JSON.parse(lines[0]);
    expect(response.id).toBe(5);
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("denied");
  });
});

// ── Run ───────────────────────────────────────────

describe("runTask integration", () => {
  it("succeeds with do steps when no tool registry (no-op handlers)", async () => {
    const taskPath = await createTempFile(`task simple_task v0

goal "A simple task"

use file.read

do file.read(path="test.txt") -> content

return {
  data: content
}
`);
    const result = await runTask(taskPath);
    // Without a tool registry, do steps produce undefined — task still succeeds
    expect(result.status).toBe("success");
  });

  it("executes a task with tool registry", async () => {
    const taskPath = await createTempFile(`task echo_task v0

goal "Echo task"

use echo

do echo(msg="hello") -> result

return {
  output: result
}
`);
    const result = await runTask(taskPath, {
      tools: {
        echo: async (args: Record<string, unknown>) => {
          return { echoed: args.msg };
        },
      },
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ output: { echoed: "hello" } });
  });

  it("reports missing required inputs", async () => {
    const taskPath = await createTempFile(`task needs_input v0

goal "Task needing input"

use file.read

need target: str
need count: int

do file.read(path=target) -> content

return {
  data: content
}
`);
    const result = await runTask(taskPath, { inputs: {} });
    expect(result.status).toBe("blocked");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes("target"))).toBe(true);
  });
});

// ── Draft errors ──────────────────────────────────

describe("draft error handling", () => {
  it("throws friendly error for missing plan file", async () => {
    await expect(
      draftContract({
        prompt: "test",
        fromPlan: "/nonexistent/plan.md",
      }),
    ).rejects.toThrow("Plan file not found: /nonexistent/plan.md");
  });
});
