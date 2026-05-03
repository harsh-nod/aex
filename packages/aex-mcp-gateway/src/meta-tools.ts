import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFile } from "@aex-lang/parser";
import type { EffectivePermissions, RuntimeEvent } from "@aex-lang/runtime";
import { extractPolicyLayer, mergePolicyAndTask } from "@aex-lang/runtime";

// --- Types ---

export interface ToolCallRecord {
  tool: string;
  timestamp: string;
  decision: "forward" | "block";
  reason?: string;
}

export interface CheckpointData {
  name: string;
  description?: string;
  timestamp: string;
  callsUsed: number;
  budget?: number;
  toolHistory: ToolCallRecord[];
}

export interface MetaToolContext {
  cwd: string;
  callsUsed: number;
  budget?: number;
  toolHistory: ToolCallRecord[];
  auditEvents: RuntimeEvent[];
  permissions: EffectivePermissions;
  restoreState: (callsUsed: number, toolHistory: ToolCallRecord[]) => void;
}

// --- MCP tool definitions (injected into tools/list responses) ---

export const META_TOOL_DEFINITIONS = [
  {
    name: "aex.checkpoint",
    description:
      "Save current session state as a named checkpoint that can be resumed later",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Checkpoint name (alphanumeric, dashes, underscores)",
        },
        description: {
          type: "string",
          description: "What was accomplished so far",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "aex.resume",
    description:
      "Load a previously saved checkpoint and restore session state",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Checkpoint name to resume",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "aex.list_tasks",
    description: "List available AEX task contracts and checkpoints",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "aex.run_task",
    description:
      "Review an AEX task contract and return its permissions summary without executing",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "Path to .aex file (relative to working directory)",
        },
      },
      required: ["task"],
    },
  },
];

const META_TOOL_NAMES = new Set(META_TOOL_DEFINITIONS.map((t) => t.name));

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

// --- Public API ---

export function isMetaTool(toolName: string): boolean {
  return META_TOOL_NAMES.has(toolName);
}

export async function handleMetaTool(
  toolName: string,
  params: Record<string, unknown>,
  ctx: MetaToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "aex.checkpoint":
      return handleCheckpoint(params as { name: string; description?: string }, ctx);
    case "aex.resume":
      return handleResume(params as { name: string }, ctx);
    case "aex.list_tasks":
      return handleListTasks(ctx);
    case "aex.run_task":
      return handleRunTask(params as { task: string }, ctx);
    default:
      throw new Error(`Unknown meta-tool: ${toolName}`);
  }
}

// --- Handlers ---

async function handleCheckpoint(
  params: { name: string; description?: string },
  ctx: MetaToolContext,
): Promise<{ path: string; message: string }> {
  const { name, description } = params;
  if (!name || !VALID_NAME.test(name)) {
    throw new Error(
      `Invalid checkpoint name "${name}". Use only letters, digits, dashes, and underscores.`,
    );
  }

  const dir = path.join(ctx.cwd, ".aex", "checkpoints", name);
  await fs.mkdir(dir, { recursive: true });

  const checkpoint: CheckpointData = {
    name,
    description,
    timestamp: new Date().toISOString(),
    callsUsed: ctx.callsUsed,
    budget: ctx.budget,
    toolHistory: ctx.toolHistory,
  };
  await fs.writeFile(
    path.join(dir, "checkpoint.json"),
    JSON.stringify(checkpoint, null, 2) + "\n",
    "utf8",
  );

  const auditLines = ctx.auditEvents
    .map((ev) => JSON.stringify(ev))
    .join("\n");
  await fs.writeFile(
    path.join(dir, "audit.jsonl"),
    auditLines ? auditLines + "\n" : "",
    "utf8",
  );

  const relPath = `.aex/checkpoints/${name}/`;
  return { path: relPath, message: `Checkpoint "${name}" saved to ${relPath}` };
}

async function handleResume(
  params: { name: string },
  ctx: MetaToolContext,
): Promise<{
  name: string;
  description?: string;
  toolsCalled: string[];
  callsUsed: number;
  budgetRemaining?: number;
  auditSummary: RuntimeEvent[];
}> {
  const { name } = params;
  if (!name || !VALID_NAME.test(name)) {
    throw new Error(
      `Invalid checkpoint name "${name}".`,
    );
  }

  const dir = path.join(ctx.cwd, ".aex", "checkpoints", name);
  const cpPath = path.join(dir, "checkpoint.json");

  let raw: string;
  try {
    raw = await fs.readFile(cpPath, "utf8");
  } catch {
    throw new Error(`Checkpoint "${name}" not found at ${cpPath}`);
  }

  const checkpoint: CheckpointData = JSON.parse(raw);

  // Restore proxy state
  ctx.restoreState(checkpoint.callsUsed, checkpoint.toolHistory);

  // Read audit log
  let auditSummary: RuntimeEvent[] = [];
  try {
    const auditRaw = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    auditSummary = auditRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeEvent);
  } catch {
    // No audit file is fine
  }

  const toolsCalled = [...new Set(checkpoint.toolHistory.map((t) => t.tool))];
  const budgetRemaining =
    checkpoint.budget !== undefined
      ? checkpoint.budget - checkpoint.callsUsed
      : undefined;

  return {
    name: checkpoint.name,
    description: checkpoint.description,
    toolsCalled,
    callsUsed: checkpoint.callsUsed,
    budgetRemaining,
    auditSummary,
  };
}

async function handleListTasks(
  ctx: MetaToolContext,
): Promise<{
  tasks: Array<{
    name: string;
    path: string;
    type: "task" | "run" | "checkpoint";
    goal?: string;
    tools?: string[];
  }>;
}> {
  const tasks: Array<{
    name: string;
    path: string;
    type: "task" | "run" | "checkpoint";
    goal?: string;
    tools?: string[];
  }> = [];

  // Scan tasks/
  await scanAEXDir(path.join(ctx.cwd, "tasks"), "task", tasks);

  // Scan .aex/runs/
  await scanAEXDir(path.join(ctx.cwd, ".aex", "runs"), "run", tasks);

  // Scan .aex/checkpoints/
  const cpDir = path.join(ctx.cwd, ".aex", "checkpoints");
  try {
    const entries = await fs.readdir(cpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cpPath = path.join(cpDir, entry.name, "checkpoint.json");
      try {
        const raw = await fs.readFile(cpPath, "utf8");
        const cp: CheckpointData = JSON.parse(raw);
        tasks.push({
          name: cp.name,
          path: `.aex/checkpoints/${entry.name}/`,
          type: "checkpoint",
          goal: cp.description,
        });
      } catch {
        // Skip invalid checkpoints
      }
    }
  } catch {
    // Directory doesn't exist, that's fine
  }

  return { tasks };
}

async function scanAEXDir(
  dirPath: string,
  type: "task" | "run",
  results: Array<{
    name: string;
    path: string;
    type: "task" | "run" | "checkpoint";
    goal?: string;
    tools?: string[];
  }>,
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".aex")) continue;
      const filePath = path.join(dirPath, entry.name);
      try {
        const parsed = await parseFile(filePath, { tolerant: true });
        const task = parsed.task;
        results.push({
          name: task.agent?.name ?? entry.name.replace(/\.aex$/, ""),
          path: filePath,
          type,
          goal: task.goal,
          tools: task.use,
        });
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Directory doesn't exist, that's fine
  }
}

async function handleRunTask(
  params: { task: string },
  ctx: MetaToolContext,
): Promise<{
  task: string;
  goal: string;
  requested: string[];
  denied: string[];
  effective: {
    allow: string[];
    deny: string[];
    confirm: string[];
    budget?: number;
  };
  checks: string[];
  makeSteps: string[];
  valid: boolean;
  warnings: string[];
}> {
  const filePath = path.resolve(ctx.cwd, params.task);

  let parsed;
  try {
    parsed = await parseFile(filePath, { tolerant: true });
  } catch {
    throw new Error(`Cannot read task file: ${params.task}`);
  }

  const task = parsed.task;
  const taskLayer = extractPolicyLayer(task);

  // Build a PolicyLayer from the current proxy permissions
  const policyLayer = {
    use: ctx.permissions.allow,
    deny: ctx.permissions.deny,
    confirm: ctx.permissions.confirm,
    budget: ctx.permissions.budget,
  };

  const effective = mergePolicyAndTask(policyLayer, taskLayer);

  // Extract checks and make steps from the AST
  const checks: string[] = [];
  const makeSteps: string[] = [];
  const collectSteps = (steps: typeof task.steps) => {
    for (const step of steps) {
      if (step.kind === "check") {
        checks.push(step.condition);
      } else if (step.kind === "make") {
        makeSteps.push(
          `make ${step.bind}: ${step.type} from ${step.inputs.join(", ")}`,
        );
      } else if (step.kind === "if") {
        collectSteps(step.body);
      } else if (step.kind === "for") {
        collectSteps(step.body);
      }
    }
  };
  collectSteps(task.steps);

  // Check if task runs under policy (all requested tools are in effective allow)
  const warnings: string[] = [];
  for (const tool of task.use) {
    if (!effective.allow.includes(tool)) {
      warnings.push(`Tool "${tool}" requested by task is not allowed by policy`);
    }
  }

  return {
    task: task.agent?.name ?? path.basename(filePath, ".aex"),
    goal: task.goal ?? "",
    requested: task.use,
    denied: task.deny,
    effective: {
      allow: effective.allow,
      deny: effective.deny,
      confirm: effective.confirm,
      budget: effective.budget,
    },
    checks,
    makeSteps,
    valid: parsed.diagnostics.length === 0,
    warnings,
  };
}
