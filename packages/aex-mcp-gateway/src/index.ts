import path from "node:path";
import { parseFile, type ParseResult, matchesAny } from "@aex-lang/parser";
import type { EffectivePermissions, RuntimeEvent } from "@aex-lang/runtime";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface GatewaySummary {
  allowedTools: string[];
  deniedTools: string[];
  confirmTools: string[];
}

/**
 * Reads an AEX contract and answers permission questions for MCP tool requests.
 */
export class AEXMCPGateway {
  private readonly taskPath: string;
  private parsed: ParseResult | null = null;

  constructor(taskPath: string) {
    this.taskPath = path.resolve(process.cwd(), taskPath);
  }

  async allows(toolName: string): Promise<boolean> {
    const task = await this.loadTask();
    const allowedByUse = matchesAny(toolName, task.use);
    const denied = matchesAny(toolName, task.deny);
    return allowedByUse && !denied;
  }

  async requiresConfirmation(toolName: string): Promise<boolean> {
    const summary = await this.summary();
    return matchesAny(toolName, summary.confirmTools);
  }

  async summary(): Promise<GatewaySummary> {
    const task = await this.loadTask();
    const confirm = task.steps
      .filter((step) => step.kind === "confirm")
      .map((step) => (step.kind === "confirm" ? step.before : ""))
      .filter(Boolean);
    return {
      allowedTools: [...task.use],
      deniedTools: [...task.deny],
      confirmTools: confirm,
    };
  }

  private async loadTask() {
    if (this.parsed) {
      return this.parsed.task;
    }
    this.parsed = await parseFile(this.taskPath, { tolerant: true });
    return this.parsed.task;
  }
}

// --- JSON-RPC 2.0 types ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ProxyOptions {
  permissions: EffectivePermissions;
  autoConfirm?: boolean;
  logger: (event: RuntimeEvent) => void;
}

export type ProxyDecision =
  | { action: "forward" }
  | { action: "block"; response: JsonRpcResponse };

/**
 * MCP stdio proxy that sits between a client (Claude Code / Codex) and an
 * upstream MCP server, enforcing AEX policy on every tool call.
 */
export class AEXProxy {
  private readonly permissions: EffectivePermissions;
  private readonly autoConfirm: boolean;
  private readonly logger: (event: RuntimeEvent) => void;
  private callsUsed = 0;

  constructor(options: ProxyOptions) {
    this.permissions = options.permissions;
    this.autoConfirm = options.autoConfirm ?? false;
    this.logger = options.logger;
  }

  /**
   * Start proxying between clientIn/clientOut and the upstream child process.
   * Intercepts tools/call requests and tools/list responses.
   */
  async start(
    clientIn: Readable,
    clientOut: Writable,
    upstream: ChildProcess,
  ): Promise<void> {
    const upstreamIn = upstream.stdin!;
    const upstreamOut = upstream.stdout!;

    // Client -> Proxy -> Upstream
    const clientReader = createInterface({ input: clientIn });
    clientReader.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        // Not valid JSON-RPC, forward as-is
        upstreamIn.write(line + "\n");
        return;
      }

      if (msg.method === "tools/call") {
        const decision = this.handleToolsCall(msg);
        if (decision.action === "block") {
          clientOut.write(JSON.stringify(decision.response) + "\n");
          return;
        }
      }

      // Forward to upstream
      upstreamIn.write(line + "\n");
    });

    // Upstream -> Proxy -> Client
    const upstreamReader = createInterface({ input: upstreamOut });
    upstreamReader.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        clientOut.write(line + "\n");
        return;
      }

      // If this is a tools/list response, filter the tool list
      if (msg.result && typeof msg.result === "object" && "tools" in (msg.result as object)) {
        msg = this.filterToolsList(msg);
      }

      clientOut.write(JSON.stringify(msg) + "\n");
    });

    // Wait for upstream to exit
    await new Promise<void>((resolve) => {
      upstream.on("exit", () => {
        clientReader.close();
        upstreamReader.close();
        resolve();
      });
    });
  }

  /**
   * Gate a tools/call request against effective permissions.
   * Returns a decision: forward to upstream or block with error.
   */
  handleToolsCall(request: JsonRpcRequest): ProxyDecision {
    const toolName = (request.params?.name as string) ?? "";
    const requestId = request.id ?? null;

    // 1. Check deny list
    if (matchesAny(toolName, this.permissions.deny)) {
      this.logger({ event: "tool.denied", data: { tool: toolName, reason: "deny_list" } });
      return {
        action: "block",
        response: errorResponse(requestId, -32600, `Tool "${toolName}" is denied by policy.`),
      };
    }

    // 2. Check allow list
    if (!matchesAny(toolName, this.permissions.allow)) {
      this.logger({ event: "tool.denied", data: { tool: toolName, reason: "not_allowed" } });
      return {
        action: "block",
        response: errorResponse(requestId, -32600, `Tool "${toolName}" is not in the allow list.`),
      };
    }

    // 3. Check budget
    if (this.permissions.budget !== undefined) {
      this.callsUsed++;
      if (this.callsUsed > this.permissions.budget) {
        this.logger({ event: "budget.exhausted", data: { tool: toolName, used: this.callsUsed, limit: this.permissions.budget } });
        return {
          action: "block",
          response: errorResponse(requestId, -32600, "Call budget exhausted."),
        };
      }
    }

    // 4. Check confirmation
    if (matchesAny(toolName, this.permissions.confirm)) {
      if (!this.autoConfirm) {
        this.logger({ event: "confirm.required", data: { tool: toolName } });
        return {
          action: "block",
          response: errorResponse(requestId, -32600, `Tool "${toolName}" requires confirmation (use --auto-confirm to bypass).`),
        };
      }
      this.logger({ event: "confirm.auto_approved", data: { tool: toolName } });
    }

    // 5. Allowed — forward
    this.logger({ event: "tool.allowed", data: { tool: toolName } });
    return { action: "forward" };
  }

  /**
   * Filter a tools/list response to remove tools not in the allow list or in the deny list.
   */
  filterToolsList(response: JsonRpcResponse): JsonRpcResponse {
    const result = response.result as { tools?: Array<{ name: string; [key: string]: unknown }> };
    if (!result.tools || !Array.isArray(result.tools)) {
      return response;
    }

    const filtered = result.tools.filter((tool) => {
      if (matchesAny(tool.name, this.permissions.deny)) return false;
      if (!matchesAny(tool.name, this.permissions.allow)) return false;
      return true;
    });

    this.logger({
      event: "tools.filtered",
      data: {
        total: result.tools.length,
        allowed: filtered.length,
        removed: result.tools.length - filtered.length,
      },
    });

    return {
      ...response,
      result: { ...result, tools: filtered },
    };
  }

  /** Current number of calls consumed */
  get callCount(): number {
    return this.callsUsed;
  }
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}
