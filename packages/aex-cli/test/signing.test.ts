import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createSignature, verifySignature } from "../src/signing.js";

async function writeTempContract(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-signing-"));
  const filePath = path.join(dir, "task.aex");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("signing", () => {
  it("creates and verifies provenance metadata", async () => {
    const file = await writeTempContract("task foo v0\n\nreturn true\n");
    const secret = "secret-key";
    const signature = await createSignature(file, "tester", secret);
    expect(signature.hash).toHaveLength(64);
    expect(signature.signature).toHaveLength(64);
    const valid = await verifySignature(file, signature, secret);
    expect(valid).toBe(true);
    const invalid = await verifySignature(file, signature, "different");
    expect(invalid).toBe(false);
  });

  it("rejects tampered signatures", async () => {
    const file = await writeTempContract("task bar v0\n\nreturn true\n");
    const secret = "my-key";
    const signature = await createSignature(file, "tester", secret);
    const tampered = { ...signature, signature: "a".repeat(64) };
    const valid = await verifySignature(file, tampered, secret);
    expect(valid).toBe(false);
  });

  it("rejects when file content has changed", async () => {
    const file = await writeTempContract("task baz v0\n\nreturn true\n");
    const secret = "my-key";
    const signature = await createSignature(file, "tester", secret);
    await fs.writeFile(file, "task baz v0\n\nreturn false\n", "utf8");
    const valid = await verifySignature(file, signature, secret);
    expect(valid).toBe(false);
  });
});
