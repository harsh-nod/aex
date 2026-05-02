import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SignatureMetadata {
  schema: "aex/signature@v1";
  file: string;
  hash: string;
  signer: string;
  signedAt: string;
  signature: string;
  keyHint: string;
  tool: string;
}

export async function createSignature(
  filePath: string,
  signer: string,
  secret: string,
): Promise<SignatureMetadata> {
  const absolute = path.resolve(filePath);
  const contents = await fs.readFile(absolute, "utf8");
  const hash = createHash("sha256").update(contents, "utf8").digest("hex");
  const signature = createHmac("sha256", secret)
    .update(hash, "utf8")
    .digest("hex");
  const keyHint = createHash("sha1").update(secret, "utf8").digest("hex").slice(0, 12);

  return {
    schema: "aex/signature@v1",
    file: absolute,
    hash,
    signer,
    signedAt: new Date().toISOString(),
    signature,
    keyHint,
    tool: "aex-cli",
  };
}

export async function verifySignature(
  filePath: string,
  metadata: SignatureMetadata,
  secret: string,
): Promise<boolean> {
  const absolute = path.resolve(filePath);
  const contents = await fs.readFile(absolute, "utf8");
  const hash = createHash("sha256").update(contents, "utf8").digest("hex");
  if (hash !== metadata.hash) {
    return false;
  }
  const expectedSignature = createHmac("sha256", secret)
    .update(metadata.hash, "utf8")
    .digest("hex");
  if (expectedSignature.length !== metadata.signature.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expectedSignature, "utf8"),
    Buffer.from(metadata.signature, "utf8"),
  );
}
