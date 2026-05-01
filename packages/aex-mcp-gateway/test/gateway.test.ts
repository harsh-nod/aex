import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AEXMCPGateway } from "../src/index";

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
