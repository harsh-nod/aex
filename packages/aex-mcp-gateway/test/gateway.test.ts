import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AEXMCPGateway, AEXProxy, type ProxyOptions } from "../src/index";
import type { RuntimeEvent } from "@aex-lang/runtime";

async function createContract(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-mcp-"));
  const filePath = path.join(dir, "task.aex");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("AEXMCPGateway", () => {
  it("summarises permissions from the contract", async () => {
    const taskPath = await createContract(`agent gateway v0

goal "Describe MCP permissions"

use crm.lookup, ticket.read
deny secrets.read, network.*

confirm before ticket.read

return {}
`);

    const gateway = new AEXMCPGateway(taskPath);
    expect(await gateway.allows("crm.lookup")).toBe(true);
    expect(await gateway.allows("network.fetch")).toBe(false);
    expect(await gateway.requiresConfirmation("ticket.read")).toBe(true);

    const summary = await gateway.summary();
    expect(summary.allowedTools).toContain("crm.lookup");
    expect(summary.deniedTools).toContain("secrets.read");
    expect(summary.confirmTools).toContain("ticket.read");
  });
});

function createProxy(
  overrides: Partial<ProxyOptions["permissions"]> = {},
  opts: { autoConfirm?: boolean } = {},
): { proxy: AEXProxy; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  const permissions = {
    allow: ["file.read", "file.write", "tests.run"],
    deny: ["network.*", "secrets.read"],
    confirm: ["file.write"],
    budget: 5,
    ...overrides,
  };
  const proxy = new AEXProxy({
    permissions,
    autoConfirm: opts.autoConfirm,
    logger: (ev) => events.push(ev),
  });
  return { proxy, events };
}

function toolsCallRequest(
  toolName: string,
  id: number = 1,
): { jsonrpc: "2.0"; id: number; method: string; params: { name: string } } {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: toolName } };
}

describe("AEXProxy", () => {
  it("allows tools in the allow list", () => {
    const { proxy, events } = createProxy();
    const decision = proxy.handleToolsCall(toolsCallRequest("file.read"));
    expect(decision.action).toBe("forward");
    expect(events[0].event).toBe("tool.allowed");
  });

  it("blocks tools in the deny list", () => {
    const { proxy, events } = createProxy();
    const decision = proxy.handleToolsCall(toolsCallRequest("network.fetch"));
    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.response.error?.message).toContain("denied by policy");
    }
    expect(events[0].event).toBe("tool.denied");
    expect(events[0].data?.reason).toBe("deny_list");
  });

  it("blocks tools not in the allow list", () => {
    const { proxy, events } = createProxy();
    const decision = proxy.handleToolsCall(toolsCallRequest("admin.delete"));
    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.response.error?.message).toContain("not in the allow list");
    }
    expect(events[0].event).toBe("tool.denied");
    expect(events[0].data?.reason).toBe("not_allowed");
  });

  it("enforces call budget", () => {
    const { proxy } = createProxy({ budget: 2 });
    expect(proxy.handleToolsCall(toolsCallRequest("file.read", 1)).action).toBe("forward");
    expect(proxy.handleToolsCall(toolsCallRequest("file.read", 2)).action).toBe("forward");
    const third = proxy.handleToolsCall(toolsCallRequest("file.read", 3));
    expect(third.action).toBe("block");
    if (third.action === "block") {
      expect(third.response.error?.message).toContain("budget exhausted");
    }
  });

  it("blocks tools requiring confirmation when autoConfirm is false", () => {
    const { proxy, events } = createProxy({}, { autoConfirm: false });
    const decision = proxy.handleToolsCall(toolsCallRequest("file.write"));
    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.response.error?.message).toContain("requires confirmation");
    }
    expect(events[0].event).toBe("confirm.required");
  });

  it("auto-approves tools requiring confirmation when autoConfirm is true", () => {
    const { proxy, events } = createProxy({}, { autoConfirm: true });
    const decision = proxy.handleToolsCall(toolsCallRequest("file.write"));
    expect(decision.action).toBe("forward");
    expect(events[0].event).toBe("confirm.auto_approved");
  });

  it("filters tools/list responses", () => {
    const { proxy, events } = createProxy();
    const response = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        tools: [
          { name: "file.read", description: "Read files" },
          { name: "file.write", description: "Write files" },
          { name: "network.fetch", description: "HTTP fetch" },
          { name: "admin.delete", description: "Delete things" },
        ],
      },
    };
    const filtered = proxy.filterToolsList(response);
    const tools = (filtered.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("file.read");
    expect(names).toContain("file.write");
    expect(names).not.toContain("network.fetch");
    expect(names).not.toContain("admin.delete");
    expect(events[0].event).toBe("tools.filtered");
    expect(events[0].data?.removed).toBe(2);
  });

  it("tracks call count", () => {
    const { proxy } = createProxy({ budget: undefined });
    expect(proxy.callCount).toBe(0);
    proxy.handleToolsCall(toolsCallRequest("file.read"));
    proxy.handleToolsCall(toolsCallRequest("tests.run"));
    expect(proxy.callCount).toBe(0); // no budget means no counting
  });

  it("deny takes precedence over allow", () => {
    const { proxy } = createProxy({
      allow: ["network.*"],
      deny: ["network.fetch"],
    });
    const decision = proxy.handleToolsCall(toolsCallRequest("network.fetch"));
    expect(decision.action).toBe("block");
  });
});
