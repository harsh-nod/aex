import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AEXGuardedAgent } from "../src/index";

async function createTask(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-guarded-agent-"));
  const filePath = path.join(dir, "task.aex");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("AEXGuardedAgent", () => {
  it("runs the contract through the runtime", async () => {
    const taskPath = await createTask(`agent summarizer v0

goal "Echo the supplied text."

use text.echo

need text: str

do text.echo(value=text) -> reply

return reply
`);

    const agent = new AEXGuardedAgent({
      taskPath,
      tools: {
        "text.echo": {
          sideEffect: "none",
          handler: async (args) => args.value ?? "",
        },
      },
    });

    const result = await agent.run({ text: "hello world" });
    expect(result.status).toBe("success");
    expect(result.output).toEqual("hello world");
  });
});
