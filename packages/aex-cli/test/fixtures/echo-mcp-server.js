#!/usr/bin/env node
// Minimal MCP server for proxy integration tests.
// Responds to tools/list with a fixed set of tools and echoes tools/call args back.

import { createInterface } from "node:readline";

const TOOLS = [
  { name: "file.read", description: "Read a file", inputSchema: { type: "object" } },
  { name: "file.write", description: "Write a file", inputSchema: { type: "object" } },
  { name: "network.fetch", description: "Fetch a URL", inputSchema: { type: "object" } },
  { name: "secrets.read", description: "Read secrets", inputSchema: { type: "object" } },
];

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  const id = msg.id ?? null;

  if (msg.method === "initialize") {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } },
      }) + "\n",
    );
    return;
  }

  if (msg.method === "tools/list") {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }) + "\n",
    );
    return;
  }

  if (msg.method === "tools/call") {
    const toolName = msg.params?.name ?? "unknown";
    const args = msg.params?.arguments ?? {};
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ tool: toolName, args }) }],
        },
      }) + "\n",
    );
    return;
  }

  // Unknown method — return error
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    }) + "\n",
  );
});
