import {
  parseFile,
  AEXTask,
  AEXDoStep,
  AEXMakeStep,
  AEXReturnStep,
  AEXConfirmStep,
  AEXStep,
} from "@aex/parser";
import {
  validateParsed,
  ValidationIssue,
  ValidationIssue as ValidatorIssue,
} from "@aex/validator";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { exec as childExec } from "node:child_process";

const exec = promisify(childExec);

export interface RuntimePolicy {
  allow?: string[];
  deny?: string[];
  require_confirmation?: string[];
  budget?: Record<string, number>;
}

export interface RuntimeEvent {
  event: string;
  data?: Record<string, unknown>;
}

export interface RunResult {
  status: "success" | "blocked";
  issues: string[];
  output?: unknown;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ExecutionContext,
) => Promise<unknown>;

export interface ToolDefinition {
  handler: ToolHandler;
  sideEffect: "none" | "read" | "write";
}

export interface ToolRegistry {
  [toolName: string]: ToolDefinition | ToolHandler;
}

export interface ModelHandler {
  (step: AEXMakeStep, context: ExecutionContext): Promise<unknown>;
}

export interface ConfirmationHandler {
  (toolName: string, step: AEXDoStep, context: ExecutionContext): Promise<
    boolean
  >;
}

export interface RunOptions {
  inputs?: Record<string, unknown>;
  policy?: RuntimePolicy;
  tools?: ToolRegistry;
  model?: ModelHandler;
  confirm?: ConfirmationHandler;
  logger?: (event: RuntimeEvent) => void;
}

interface ExecutionContext {
  inputs: Record<string, unknown>;
  variables: Map<string, unknown>;
  logger: (event: RuntimeEvent) => void;
}

interface ExecutionState {
  context: ExecutionContext;
  task: AEXTask;
  options: RunOptions;
  policy: NormalizedPolicy;
  confirmations: Set<string>;
  callsUsed: number;
  callBudget?: number;
}

interface NormalizedPolicy {
  allow: string[] | undefined;
  deny: string[];
  requireConfirmation: string[];
  budgetCalls?: number;
}

export async function runTask(
  filePath: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const parsed = await parseFile(filePath, { tolerant: true });
  const validation = validateParsed(parsed);
  const validationErrors = validation.issues
    .filter((issue) => issue.severity === "error")
    .map(formatIssue);

  if (validationErrors.length > 0) {
    return { status: "blocked", issues: validationErrors };
  }

  const normalizedPolicy = normalizePolicy(options.policy);
  const confirmations = collectConfirmations(validation.task, normalizedPolicy);

  const context: ExecutionContext = {
    inputs: options.inputs ?? {},
    variables: new Map<string, unknown>(),
    logger: options.logger ?? (() => {
      /* noop */
    }),
  };

  const state: ExecutionState = {
    context,
    task: validation.task,
    options,
    policy: normalizedPolicy,
    confirmations,
    callsUsed: 0,
    callBudget: determineCallBudget(validation.task, normalizedPolicy),
  };

  context.logger({
    event: "run.started",
    data: { agent: validation.task.agent?.name },
  });

  for (const step of validation.task.steps) {
    const result = await executeStep(step, state);
    if (result.status !== "continue") {
      if (result.status === "success") {
        context.logger({ event: "run.finished", data: { status: "success" } });
        return {
          status: "success",
          issues: [],
          output: result.output,
        };
      }

      context.logger({
        event: "run.finished",
        data: { status: "blocked", reason: result.reason },
      });
      return { status: "blocked", issues: [result.reason] };
    }
  }

  context.logger({
    event: "run.finished",
    data: { status: "blocked", reason: "Contract ended without return" },
  });
  return {
    status: "blocked",
    issues: ["AEX contract did not reach a return statement."],
  };
}

type StepResult =
  | { status: "continue" }
  | { status: "success"; output: unknown }
  | { status: "blocked"; reason: string };

async function executeStep(
  step: AEXStep,
  state: ExecutionState,
): Promise<StepResult> {
  switch (step.kind) {
    case "do":
      return executeDo(step, state);
    case "make":
      return executeMake(step, state);
    case "check":
      return executeCheck(step.condition, state, step.line);
    case "confirm":
      state.confirmations.add(step.before);
      return { status: "continue" };
    case "return":
      return executeReturn(step, state);
    default:
      return {
        status: "blocked",
        reason: `Unsupported step kind: ${(step as AEXStep).kind}`,
      };
  }
}

async function executeDo(
  step: AEXDoStep,
  state: ExecutionState,
): Promise<StepResult> {
  const { task, policy } = state;
  const toolName = step.tool;

  if (!isAllowed(toolName, task.use, policy.allow)) {
    return {
      status: "blocked",
      reason: `Tool "${toolName}" is not allowed by contract or policy.`,
    };
  }

  if (isDenied(toolName, [...task.deny, ...policy.deny])) {
    return {
      status: "blocked",
      reason: `Tool "${toolName}" is denied by contract or policy.`,
    };
  }

  const tool = resolveTool(toolName, state.options.tools);
  if (!tool) {
    return {
      status: "blocked",
      reason: `Tool "${toolName}" is not registered in the runtime.`,
    };
  }

  const requiresConfirmation = state.confirmations.has(toolName);
  if (requiresConfirmation) {
    const confirmed = await requestConfirmation(toolName, step, state);
    if (!confirmed) {
      return {
        status: "blocked",
        reason: `Tool "${toolName}" requires confirmation and none was provided.`,
      };
    }
  }

  const budgetResult = consumeCallBudget(state, toolName);
  if (budgetResult) {
    return budgetResult;
  }

  const args = resolveArgs(step.args, state);
  state.context.logger({
    event: "tool.allowed",
    data: { tool: toolName, args },
  });

  try {
    const result = await tool.handler(args, state.context);
    state.context.logger({
      event: "tool.result",
      data: { tool: toolName, bind: step.bind, result },
    });
    if (step.bind) {
      state.context.variables.set(step.bind, result);
    }
    return { status: "continue" };
  } catch (error) {
    return {
      status: "blocked",
      reason: `Tool "${toolName}" failed: ${formatError(error)}`,
    };
  }
}

async function executeMake(
  step: AEXMakeStep,
  state: ExecutionState,
): Promise<StepResult> {
  if (!state.options.model) {
    return {
      status: "blocked",
      reason: `Make step "${step.bind}" requires a model handler.`,
    };
  }

  const budgetResult = consumeCallBudget(state, `make:${step.bind}`);
  if (budgetResult) {
    return budgetResult;
  }

  try {
    const result = await state.options.model(step, state.context);
    state.context.logger({
      event: "make.result",
      data: { bind: step.bind },
    });
    state.context.variables.set(step.bind, result);
    return { status: "continue" };
  } catch (error) {
    return {
      status: "blocked",
      reason: `Make step "${step.bind}" failed: ${formatError(error)}`,
    };
  }
}

function executeCheck(
  condition: string,
  state: ExecutionState,
  line: number,
): StepResult {
  const evaluation = evaluateCheck(condition, state);
  if (evaluation.ok) {
    state.context.logger({
      event: "check.passed",
      data: { condition },
    });
    return { status: "continue" };
  }

  state.context.logger({
    event: "check.failed",
    data: { condition, reason: evaluation.message },
  });
  return {
    status: "blocked",
    reason:
      evaluation.message ??
      `Check "${condition}" failed at line ${line.toString()}`,
  };
}

function executeReturn(
  step: AEXReturnStep,
  state: ExecutionState,
): StepResult {
  const output = evaluateReturn(step.expression, state);
  return { status: "success", output };
}

function resolveArgs(
  args: Record<string, string>,
  state: ExecutionState,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = resolveToken(value, state);
  }
  return resolved;
}

function resolveToken(token: string, state: ExecutionState): unknown {
  if (state.context.variables.has(token)) {
    return state.context.variables.get(token);
  }
  if (Object.prototype.hasOwnProperty.call(state.context.inputs, token)) {
    return state.context.inputs[token];
  }
  if (token === "true") return true;
  if (token === "false") return false;
  const numeric = Number(token);
  if (!Number.isNaN(numeric) && token.trim() !== "") {
    return numeric;
  }
  return token;
}

function determineCallBudget(
  task: AEXTask,
  policy: NormalizedPolicy,
): number | undefined {
  const contractBudget = task.budget?.calls;
  const policyBudget = policy.budgetCalls;

  if (contractBudget !== undefined && policyBudget !== undefined) {
    return Math.min(contractBudget, policyBudget);
  }
  return contractBudget ?? policyBudget ?? undefined;
}

function collectConfirmations(
  task: AEXTask,
  policy: NormalizedPolicy,
): Set<string> {
  const confirmationSteps = task.steps
    .filter((step): step is AEXConfirmStep => step.kind === "confirm")
    .map((step) => step.before);
  return new Set([...confirmationSteps, ...policy.requireConfirmation]);
}

function consumeCallBudget(
  state: ExecutionState,
  label: string,
): StepResult | undefined {
  if (state.callBudget === undefined) {
    return undefined;
  }
  state.callsUsed += 1;
  if (state.callsUsed > state.callBudget) {
    return {
      status: "blocked",
      reason: `Call budget exhausted while executing "${label}".`,
    };
  }
  return undefined;
}

async function requestConfirmation(
  toolName: string,
  step: AEXDoStep,
  state: ExecutionState,
): Promise<boolean> {
  if (!state.options.confirm) {
    return false;
  }
  state.context.logger({
    event: "confirm.required",
    data: { tool: toolName },
  });
  try {
    const approved = await state.options.confirm(toolName, step, state.context);
    if (approved) {
      state.context.logger({
        event: "confirm.approved",
        data: { tool: toolName },
      });
    } else {
      state.context.logger({
        event: "confirm.denied",
        data: { tool: toolName },
      });
    }
    return approved;
  } catch (error) {
    state.context.logger({
      event: "confirm.failed",
      data: { tool: toolName, error: formatError(error) },
    });
    return false;
  }
}

function evaluateCheck(condition: string, state: ExecutionState): {
  ok: boolean;
  message?: string;
} {
  const trimmed = condition.trim();

  if (!trimmed.includes(" ")) {
    const value = resolvePath(trimmed, state);
    if (truthy(value)) {
      return { ok: true };
    }
    return { ok: false, message: `Check "${condition}" evaluated to false.` };
  }

  const hasMatch = /^([A-Za-z0-9_.-]+)\s+has\s+"(.+)"$/.exec(trimmed);
  if (hasMatch) {
    const haystack = asText(resolvePath(hasMatch[1], state));
    return haystack.includes(hasMatch[2])
      ? { ok: true }
      : {
          ok: false,
          message: `Expected "${hasMatch[1]}" to include "${hasMatch[2]}".`,
        };
  }

  const citationsMatch = /^([A-Za-z0-9_.-]+)\s+has citations$/.exec(trimmed);
  if (citationsMatch) {
    const text = asText(resolvePath(citationsMatch[1], state));
    const hasCitation =
      /\[[^\]]+\]\([^)]+\)/.test(text) ||
      /\[[0-9]+\]/.test(text) ||
      /https?:\/\//.test(text);
    return hasCitation
      ? { ok: true }
      : {
          ok: false,
          message: `Expected "${citationsMatch[1]}" to contain citations.`,
        };
  }

  const notIncludeMatch =
    /^([A-Za-z0-9_.-]+)\s+does not include\s+(.+)$/.exec(trimmed);
  if (notIncludeMatch) {
    const subject = asText(resolvePath(notIncludeMatch[1], state));
    const rawNeedle = notIncludeMatch[2].trim();
    const needle =
      rawNeedle.startsWith('"') && rawNeedle.endsWith('"')
        ? rawNeedle.slice(1, -1)
        : asText(resolvePath(rawNeedle, state));
    return subject.includes(needle)
      ? {
          ok: false,
          message: `Expected "${notIncludeMatch[1]}" to avoid "${needle}".`,
        }
      : { ok: true };
  }

  switch (trimmed) {
    case "patch touches only target_files":
      return {
        ok: false,
        message:
          "Check \"patch touches only target_files\" is not implemented in the local runtime.",
      };
    default:
      return {
        ok: false,
        message: `Check "${condition}" is not supported by the runtime.`,
      };
  }
}

function evaluateReturn(
  expression: string,
  state: ExecutionState,
): unknown {
  const trimmed = expression.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1);
    const result: Record<string, unknown> = {};
    const pairs = inner
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("//"));
    for (const pair of pairs) {
      const cleaned = pair.replace(/,$/, "");
      const [rawKey, rawValue] = cleaned.split(":").map((part) => part.trim());
      if (!rawKey || rawValue === undefined) continue;
      const key = rawKey.replace(/^["']|["']$/g, "");
      result[key] = resolveExpressionValue(rawValue, state);
    }
    return result;
  }

  return resolveExpressionValue(trimmed, state);
}

function resolveExpressionValue(
  value: string,
  state: ExecutionState,
): unknown {
  const unquoted = value.replace(/,$/, "").trim();
  if (unquoted.startsWith('"') && unquoted.endsWith('"')) {
    return unquoted.slice(1, -1);
  }
  if (state.context.variables.has(unquoted)) {
    return state.context.variables.get(unquoted);
  }
  if (Object.prototype.hasOwnProperty.call(state.context.inputs, unquoted)) {
    return state.context.inputs[unquoted];
  }
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  const numeric = Number(unquoted);
  if (!Number.isNaN(numeric) && unquoted !== "") {
    return numeric;
  }
  return unquoted;
}

function resolveTool(
  toolName: string,
  customTools?: ToolRegistry,
): ToolDefinition | undefined {
  const merged: ToolRegistry = {
    ...builtinTools,
    ...(customTools ?? {}),
  };
  const candidate = merged[toolName];
  if (!candidate) return undefined;
  if (typeof candidate === "function") {
    return { handler: candidate, sideEffect: "none" };
  }
  return candidate;
}

const builtinTools: ToolRegistry = {
  "file.read": {
    sideEffect: "read",
    handler: async (args) => {
      const { paths } = args;
      const pathList = Array.isArray(paths) ? paths : [paths];
      const resolved: Record<string, string> = {};
      for (const entry of pathList) {
        if (typeof entry !== "string") continue;
        const absolute = path.resolve(process.cwd(), entry);
        resolved[entry] = await fs.readFile(absolute, "utf8");
      }
      return resolved;
    },
  },
  "file.write": {
    sideEffect: "write",
    handler: async (args) => {
      return {
        accepted: false,
        message:
          "file.write is not available in the local runtime. Provide a custom tool handler.",
        diff: args.diff ?? null,
      };
    },
  },
  "tests.run": {
    sideEffect: "read",
    handler: async (args) => {
      const command = typeof args.cmd === "string" ? args.cmd : "npm test";
      const { stdout, stderr } = await exec(command, { cwd: process.cwd() });
      return {
        passed: true,
        stdout,
        stderr,
      };
    },
  },
};

function normalizePolicy(policy?: RuntimePolicy): NormalizedPolicy {
  return {
    allow: policy?.allow?.map(stripPolicyQualifier),
    deny: (policy?.deny ?? []).map(stripPolicyQualifier),
    requireConfirmation: (policy?.require_confirmation ?? []).map(
      stripPolicyQualifier,
    ),
    budgetCalls: policy?.budget?.calls,
  };
}

function stripPolicyQualifier(entry: string): string {
  return entry.split(":")[0] ?? entry;
}

function isAllowed(
  tool: string,
  contractUse: string[],
  policyAllow?: string[],
): boolean {
  const contractAllows = matches(tool, contractUse);
  if (!contractAllows) return false;
  if (!policyAllow || policyAllow.length === 0) return true;
  return matches(tool, policyAllow);
}

function isDenied(tool: string, denyList: string[]): boolean {
  return matches(tool, denyList);
}

function matches(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(name, pattern));
}

function matchPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return name.startsWith(prefix);
  }
  return name === pattern;
}

function resolvePath(pathExpr: string, state: ExecutionState): unknown {
  const tokens = pathExpr.split(".");
  let value: unknown = state.context.variables.get(tokens[0]);
  if (value === undefined) {
    value = state.context.inputs[tokens[0]];
  }
  for (const token of tokens.slice(1)) {
    if (value && typeof value === "object" && token in (value as object)) {
      value = (value as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return value;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}

function asText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function formatIssue(issue: ValidationIssue): string {
  return issue.line ? `line ${issue.line}: ${issue.message}` : issue.message;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
