import path from "node:path";
import { parseFile, type ParseResult, matchesAny } from "@aex/parser";

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
