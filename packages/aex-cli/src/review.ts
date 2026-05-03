import { parseFile, AEXTask, AEXStep } from "@aex-lang/parser";
import { validateText } from "@aex-lang/validator";
import {
  mergePolicyAndTask,
  extractPolicyLayer,
  discoverPolicy,
  runTask,
  createStructuredLogger,
  EffectivePermissions,
} from "@aex-lang/runtime";
import { resolveModelHandler } from "./models/index.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export interface ReviewOptions {
  json?: boolean;
  run?: boolean;
  yes?: boolean;
  policy?: string;
  model?: string;
  modelHandler?: string;
  inputs?: string;
  autoConfirm?: boolean;
}

export interface ReviewSummary {
  task: string;
  goal: string;
  source: { task: string; policy?: string };
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
  confirmRequired: string[];
  valid: boolean;
  runsUnderPolicy: boolean;
  warnings: string[];
}

function collectSteps(
  steps: AEXStep[],
  checks: string[],
  makeSteps: string[],
  confirmRequired: string[],
): void {
  for (const step of steps) {
    switch (step.kind) {
      case "check":
        checks.push(step.condition);
        break;
      case "make":
        makeSteps.push(
          `make ${step.bind}: ${step.type} from ${step.inputs.join(", ")}`,
        );
        break;
      case "confirm":
        confirmRequired.push(step.before);
        break;
      case "if":
        collectSteps(step.body, checks, makeSteps, confirmRequired);
        break;
      case "for":
        collectSteps(step.body, checks, makeSteps, confirmRequired);
        break;
    }
  }
}

export async function buildReviewSummary(
  filePath: string,
  policyOpt?: string,
): Promise<ReviewSummary> {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  // Parse task
  const parsed = await parseFile(resolved, { tolerant: true });
  const task: AEXTask = parsed.task;

  // Validate
  const source = await fs.readFile(resolved, "utf8");
  const validation = validateText(source);
  const hasErrors = validation.issues.some((i) => i.severity === "error");

  // Discover policy
  const policyPath = policyOpt
    ? path.isAbsolute(policyOpt)
      ? policyOpt
      : path.resolve(process.cwd(), policyOpt)
    : await discoverPolicy();

  let effective: EffectivePermissions;
  let policyRelative: string | undefined;

  if (policyPath) {
    policyRelative = path.relative(process.cwd(), policyPath);
    const policyParsed = await parseFile(policyPath, { tolerant: true });
    const policyLayer = extractPolicyLayer(policyParsed.task);
    const taskLayer = extractPolicyLayer(task);
    effective = mergePolicyAndTask(policyLayer, taskLayer);
  } else {
    const taskLayer = extractPolicyLayer(task);
    effective = mergePolicyAndTask(taskLayer);
  }

  // Collect checks, make steps, confirmations
  const checks: string[] = [];
  const makeSteps: string[] = [];
  const confirmRequired: string[] = [];
  collectSteps(task.steps, checks, makeSteps, confirmRequired);

  // Check if task runs under policy
  const warnings: string[] = [];
  let runsUnderPolicy = true;

  if (policyPath) {
    const policyParsed = await parseFile(policyPath, { tolerant: true });
    const policyLayer = extractPolicyLayer(policyParsed.task);
    // Check if task requests tools outside policy allow
    for (const tool of task.use) {
      const inAllow = policyLayer.use.some((allowed) => {
        if (allowed.endsWith(".*")) {
          return tool.startsWith(allowed.slice(0, -1));
        }
        return tool === allowed;
      });
      if (!inAllow && policyLayer.use.length > 0) {
        warnings.push(
          `Tool "${tool}" requested by task but not in policy allow list.`,
        );
        runsUnderPolicy = false;
      }
    }
  }

  if (hasErrors) {
    for (const issue of validation.issues) {
      if (issue.severity === "error") {
        warnings.push(`${issue.code ?? ""} ${issue.message}`.trim());
      }
    }
  }

  return {
    task: task.agent?.name ?? "unknown",
    goal: task.goal ?? "",
    source: {
      task: path.relative(process.cwd(), resolved),
      policy: policyRelative,
    },
    requested: [...task.use],
    denied: [...task.deny],
    effective: {
      allow: effective.allow,
      deny: effective.deny,
      confirm: effective.confirm,
      budget: effective.budget,
    },
    checks,
    makeSteps,
    confirmRequired,
    valid: !hasErrors,
    runsUnderPolicy,
    warnings,
  };
}

export function formatReviewText(
  summary: ReviewSummary,
  useColor = false,
): string {
  const c = {
    cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
    green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
    red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
    yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  };

  const lines: string[] = [];

  lines.push(`${c.cyan("Task:")} ${summary.task}`);
  lines.push(`${c.cyan("Goal:")} ${summary.goal}`);
  lines.push("");

  lines.push(`${c.cyan("Source:")}`);
  lines.push(`  Task:   ${summary.source.task}`);
  if (summary.source.policy) {
    lines.push(`  Policy: ${summary.source.policy}`);
  }
  lines.push("");

  if (summary.requested.length > 0) {
    lines.push(`${c.cyan("Requested tools:")}`);
    for (const tool of summary.requested) {
      lines.push(`  ${tool}`);
    }
    lines.push("");
  }

  if (summary.denied.length > 0) {
    lines.push(`${c.cyan("Denied by task:")}`);
    for (const tool of summary.denied) {
      lines.push(`  ${tool}`);
    }
    lines.push("");
  }

  if (summary.effective.allow.length > 0) {
    lines.push(`${c.green("Effective allowed:")}`);
    for (const tool of summary.effective.allow) {
      lines.push(`  ${tool}`);
    }
    lines.push("");
  }

  if (summary.effective.deny.length > 0) {
    lines.push(`${c.red("Effective denied:")}`);
    for (const tool of summary.effective.deny) {
      lines.push(`  ${tool}`);
    }
    lines.push("");
  }

  if (summary.effective.confirm.length > 0) {
    lines.push(`${c.yellow("Confirmation required:")}`);
    for (const tool of summary.effective.confirm) {
      lines.push(`  ${tool}`);
    }
    lines.push("");
  }

  if (summary.effective.budget !== undefined) {
    lines.push(`${c.cyan("Budget:")}`);
    lines.push(`  calls=${summary.effective.budget}`);
    lines.push("");
  }

  if (summary.checks.length > 0) {
    lines.push(`${c.cyan("Required checks:")}`);
    for (const check of summary.checks) {
      lines.push(`  ${check}`);
    }
    lines.push("");
  }

  if (summary.makeSteps.length > 0) {
    lines.push(`${c.cyan("Model-generated steps:")}`);
    for (const step of summary.makeSteps) {
      lines.push(`  ${step}`);
    }
    lines.push("");
  }

  // Status
  lines.push(`${c.cyan("Status:")}`);
  if (summary.valid) {
    lines.push(`  ${c.green("Valid task.")}`);
  } else {
    lines.push(`  ${c.red("Invalid task.")}`);
  }
  if (summary.runsUnderPolicy) {
    lines.push(`  ${c.green("Runs under current policy.")}`);
  } else {
    lines.push(`  ${c.red("Exceeds current policy.")}`);
  }
  if (summary.confirmRequired.length > 0) {
    lines.push(
      `  Requires approval before ${summary.confirmRequired.join(", ")}.`,
    );
  }

  if (summary.warnings.length > 0) {
    lines.push("");
    lines.push(`${c.yellow("Warnings:")}`);
    for (const warning of summary.warnings) {
      lines.push(`  ${warning}`);
    }
  }

  return lines.join("\n");
}

export async function executeAfterApproval(
  filePath: string,
  options: ReviewOptions,
): Promise<{ status: string; output?: unknown }> {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  // Load inputs
  let inputs: Record<string, unknown> | undefined;
  if (options.inputs) {
    const inputsPath = path.isAbsolute(options.inputs)
      ? options.inputs
      : path.resolve(process.cwd(), options.inputs);
    const raw = await fs.readFile(inputsPath, "utf8");
    inputs = JSON.parse(raw) as Record<string, unknown>;
  }

  // Discover policy for runtime
  const policyPath = options.policy
    ? path.isAbsolute(options.policy)
      ? options.policy
      : path.resolve(process.cwd(), options.policy)
    : await discoverPolicy();

  let runtimePolicy;
  if (policyPath) {
    const policyParsed = await parseFile(policyPath, { tolerant: true });
    const layer = extractPolicyLayer(policyParsed.task);
    runtimePolicy = {
      allow: layer.use,
      deny: layer.deny,
      require_confirmation: layer.confirm,
      budget: layer.budget !== undefined ? { calls: layer.budget } : undefined,
    };
  }

  const modelHandler = await resolveModelHandler(
    options.model,
    options.modelHandler,
  );

  // Set up audit logging
  const structuredLog = createStructuredLogger();
  const auditEvents: Array<{ event: string; data?: Record<string, unknown> }> =
    [];
  const logFn = (event: { event: string; data?: Record<string, unknown> }) => {
    structuredLog.log(event);
    auditEvents.push(event);
  };

  // Confirmation handler
  let confirmHandler;
  if (options.autoConfirm || options.yes) {
    confirmHandler = async () => true;
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    confirmHandler = async (toolName: string) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const answer = await rl.question(`Confirm tool "${toolName}"? [y/N]: `);
        return answer.trim().toLowerCase().startsWith("y");
      } finally {
        rl.close();
      }
    };
  }

  const result = await runTask(resolved, {
    policy: runtimePolicy,
    inputs,
    model: modelHandler,
    confirm: confirmHandler,
    logger: logFn,
  });

  // Write audit log if task is in .aex/runs/
  if (resolved.includes(path.join(".aex", "runs"))) {
    const auditPath = resolved.replace(/\.aex$/, ".audit.jsonl");
    const auditContent =
      auditEvents
        .map((e) =>
          JSON.stringify({ ...e, timestamp: new Date().toISOString() }),
        )
        .join("\n") + "\n";
    await fs.writeFile(auditPath, auditContent, "utf8");
  }

  return { status: result.status, output: result.output };
}
