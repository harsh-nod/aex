import { matchesAny } from "@aex-lang/parser";
import type { EffectivePermissions } from "./index.js";
import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tool name mapping: Claude Code PascalCase → AEX dotted capability
// ---------------------------------------------------------------------------

export const CLAUDE_CODE_TOOL_MAP: Record<string, string> = {
  Read: "file.read",
  Write: "file.write",
  Edit: "file.write",
  MultiEdit: "file.write",
  Glob: "file.read",
  Grep: "file.read",
  LS: "file.read",
  Bash: "shell.exec",
  WebFetch: "network.fetch",
  WebSearch: "network.search",
  NotebookRead: "file.read",
  NotebookEdit: "file.write",
  TodoRead: "todo.read",
  TodoWrite: "todo.write",
  Agent: "agent.spawn",
};

export function mapToolName(claudeTool: string): string {
  if (claudeTool in CLAUDE_CODE_TOOL_MAP) {
    return CLAUDE_CODE_TOOL_MAP[claudeTool];
  }
  // Already a dotted name (MCP tool or custom) — pass through
  if (claudeTool.includes(".")) {
    return claudeTool;
  }
  // Unknown built-in
  return `unknown.${claudeTool}`;
}

// ---------------------------------------------------------------------------
// Path extraction from tool_input for path-scoped policy rules
// ---------------------------------------------------------------------------

const PATH_KEYS: Record<string, string> = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookRead: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "path",
  Grep: "path",
  LS: "path",
};

export function extractToolPath(
  claudeTool: string,
  toolInput: Record<string, unknown>,
): string | undefined {
  const key = PATH_KEYS[claudeTool];
  if (key && typeof toolInput[key] === "string") {
    return toolInput[key] as string;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Gate protocol types
// ---------------------------------------------------------------------------

export interface GateInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface GateOutput {
  permissionDecision: "allow" | "deny" | "ask";
  reason?: string;
  message?: string;
}

export interface BudgetState {
  sessionId: string;
  callsUsed: number;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Budget state persistence
// ---------------------------------------------------------------------------

const STALE_HOURS = 4;

export async function readBudgetState(
  dir: string,
): Promise<BudgetState | null> {
  const filePath = path.join(dir, ".aex", ".gate-budget.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as BudgetState;
  } catch {
    return null;
  }
}

export async function writeBudgetState(
  dir: string,
  state: BudgetState,
): Promise<void> {
  const aexDir = path.join(dir, ".aex");
  try {
    await fs.mkdir(aexDir, { recursive: true });
  } catch {
    // already exists
  }
  const filePath = path.join(aexDir, ".gate-budget.json");
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(state), "utf8");
  await fs.rename(tmpPath, filePath);
}

export function resolvebudgetState(
  existing: BudgetState | null,
  sessionId: string,
): BudgetState {
  if (!existing || existing.sessionId !== sessionId) {
    return { sessionId, callsUsed: 0, lastUpdated: new Date().toISOString() };
  }
  // Stale detection
  const elapsed = Date.now() - new Date(existing.lastUpdated).getTime();
  if (elapsed > STALE_HOURS * 60 * 60 * 1000) {
    return { sessionId, callsUsed: 0, lastUpdated: new Date().toISOString() };
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Core gate evaluation
// ---------------------------------------------------------------------------

export function evaluateGate(
  input: GateInput,
  permissions: EffectivePermissions,
  budgetState?: BudgetState,
): { output: GateOutput; budgetState?: BudgetState } {
  const aexTool = mapToolName(input.tool_name);

  // 1. Check deny list (highest priority)
  if (matchesAny(aexTool, permissions.deny)) {
    return {
      output: {
        permissionDecision: "deny",
        reason: `Tool "${aexTool}" is denied by policy.`,
      },
    };
  }

  // 2. Check allow list
  if (!matchesAny(aexTool, permissions.allow)) {
    return {
      output: {
        permissionDecision: "deny",
        reason: `Tool "${aexTool}" is not in the allow list.`,
      },
    };
  }

  // 3. Check budget
  if (permissions.budget !== undefined && budgetState) {
    budgetState.callsUsed++;
    budgetState.lastUpdated = new Date().toISOString();
    if (budgetState.callsUsed > permissions.budget) {
      return {
        output: {
          permissionDecision: "deny",
          reason: `Call budget exhausted (${permissions.budget} calls).`,
        },
        budgetState,
      };
    }
  }

  // 4. Check confirmation
  if (matchesAny(aexTool, permissions.confirm)) {
    return {
      output: {
        permissionDecision: "ask",
        message: `AEX policy requires confirmation before ${aexTool}.`,
      },
      budgetState,
    };
  }

  // 5. Allowed
  return {
    output: { permissionDecision: "allow" },
    budgetState,
  };
}
