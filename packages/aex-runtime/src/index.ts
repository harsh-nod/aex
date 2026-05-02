import {
  parseFile,
  AEXTask,
  AEXDoStep,
  AEXMakeStep,
  AEXReturnStep,
  AEXConfirmStep,
  AEXStep,
  matchesAny,
} from "@aex/parser";
import {
  validateParsed,
  ValidationIssue,
} from "@aex/validator";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as childExecFile } from "node:child_process";
import { tmpdir } from "node:os";

const execFile = promisify(childExecFile);

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

interface PolicyPathRule {
  tool: string;
  pathPattern?: string;
}

interface NormalizedPolicy {
  allow: PolicyPathRule[] | undefined;
  deny: PolicyPathRule[];
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

  const denyPatterns = [...task.deny, ...policy.deny.map((r) => r.tool)];
  if (matchesAny(toolName, denyPatterns)) {
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

  const touchesOnlyMatch =
    /^([A-Za-z0-9_.-]+)\s+touches only\s+([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (touchesOnlyMatch) {
    const patchValue = resolvePath(touchesOnlyMatch[1], state);
    const allowedList = resolvePath(touchesOnlyMatch[2], state);
    if (!Array.isArray(allowedList)) {
      return {
        ok: false,
        message: `"${touchesOnlyMatch[2]}" must be an array of file paths.`,
      };
    }
    const touched = extractTouchedFiles(patchValue);
    const allowed = new Set(
      (allowedList as unknown[]).map((entry) => String(entry)),
    );
    const disallowed = touched.filter((file) => !allowed.has(file));
    return disallowed.length === 0
      ? { ok: true }
      : {
          ok: false,
          message: `Patch touches files outside the allowed set: ${disallowed.join(
            ", ",
          )}`,
        };
  }

  const validDiffMatch =
    /^([A-Za-z0-9_.-]+)\s+is valid diff$/.exec(trimmed) ??
    /^([A-Za-z0-9_.-]+)\s+has valid diff$/.exec(trimmed);
  if (validDiffMatch) {
    const diffValue = resolvePath(validDiffMatch[1], state);
    return isValidDiff(diffValue)
      ? { ok: true }
      : {
          ok: false,
          message: `"${validDiffMatch[1]}" does not look like a valid unified diff.`,
        };
  }

  return {
    ok: false,
    message: `Check "${condition}" is not supported by the runtime.`,
  };
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
      const colonIndex = cleaned.indexOf(":");
      if (colonIndex === -1) continue;
      const rawKey = cleaned.substring(0, colonIndex).trim();
      const rawValue = cleaned.substring(colonIndex + 1).trim();
      if (!rawKey) continue;
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

const SHELL_CHAIN = /[;&|`$!<>]/;

function validateCommand(cmd: string): string[] {
  const parts = cmd.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Empty command");
  }
  for (const part of parts) {
    if (SHELL_CHAIN.test(part)) {
      throw new Error(
        `Command argument "${part}" contains shell metacharacters. ` +
          `Only simple command + arguments are allowed.`,
      );
    }
  }
  return parts;
}

function assertWithinCwd(filePath: string): string {
  const cwd = process.cwd();
  const absolute = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Path "${filePath}" resolves outside the working directory.`,
    );
  }
  return absolute;
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
        const absolute = assertWithinCwd(entry);
        resolved[entry] = await fs.readFile(absolute, "utf8");
      }
      return resolved;
    },
  },
  "file.write": {
    sideEffect: "write",
    handler: async (args) => {
      const writes = normalizeWritePayload(args);
      if (writes.length > 0) {
        const written: string[] = [];
        for (const entry of writes) {
          const absolute = assertWithinCwd(entry.path);
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(
            absolute,
            entry.contents,
            entry.encoding ?? "utf8",
          );
          written.push(entry.path);
        }
        return { written };
      }

      if (typeof args.diff === "string") {
        const diffText = String(args.diff);
        if (!isValidDiff(diffText)) {
          return {
            applied: false,
            message: "Provided diff payload is not valid unified diff text.",
          };
        }
        const result = await applyDiff(diffText);
        return result.applied
          ? { applied: true }
          : {
              applied: false,
              message: result.message ?? "Failed to apply diff.",
            };
      }

      throw new Error(
        "file.write expects either a `writes` array or a unified `diff` string.",
      );
    },
  },
  "tests.run": {
    sideEffect: "read",
    handler: async (args) => {
      const command = typeof args.cmd === "string" ? args.cmd : "npm test";
      const parts = validateCommand(command);
      try {
        const { stdout, stderr } = await execFile(parts[0], parts.slice(1), {
          cwd: process.cwd(),
        });
        return {
          passed: true,
          stdout,
          stderr,
          exitCode: 0,
        };
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; code?: number };
        return {
          passed: false,
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? formatError(error),
          exitCode:
            typeof err.code === "number"
              ? err.code
              : typeof (error as Record<string, unknown>).code === "number"
                ? ((error as Record<string, unknown>).code as number)
                : 1,
        };
      }
    },
  },
  "git.status": {
    sideEffect: "read",
    handler: async () => {
      const { stdout } = await execFile("git", ["status", "--short"], {
        cwd: process.cwd(),
      });
      return stdout.trim().split("\n").filter(Boolean);
    },
  },
  "git.diff": {
    sideEffect: "read",
    handler: async (args) => {
      const gitArgs = ["diff"];
      const pathsArg = args.paths;
      if (Array.isArray(pathsArg) && pathsArg.length > 0) {
        gitArgs.push("--");
        for (const p of pathsArg) {
          if (typeof p !== "string") continue;
          if (SHELL_CHAIN.test(p)) {
            throw new Error(`Path "${p}" contains disallowed characters.`);
          }
          gitArgs.push(p);
        }
      }
      const { stdout } = await execFile("git", gitArgs, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    },
  },
  "git.apply": {
    sideEffect: "write",
    handler: async (args) => {
      const diff = typeof args.diff === "string" ? args.diff : undefined;
      if (!diff) {
        throw new Error("git.apply requires a unified diff string in `diff`.");
      }
      if (!isValidDiff(diff)) {
        return {
          applied: false,
          message: "Provided diff payload is not valid unified diff text.",
        };
      }
      const result = await applyDiff(diff);
      return result.applied
        ? { applied: true }
        : {
            applied: false,
            message: result.message ?? "Failed to apply diff with git.apply.",
          };
    },
  },
};

type WriteEntry = { path: string; contents: string; encoding?: BufferEncoding };

function parsePolicyEntry(entry: string): PolicyPathRule {
  const colonIndex = entry.indexOf(":");
  if (colonIndex === -1) {
    return { tool: entry };
  }
  return {
    tool: entry.substring(0, colonIndex),
    pathPattern: entry.substring(colonIndex + 1),
  };
}

function normalizePolicy(policy?: RuntimePolicy): NormalizedPolicy {
  return {
    allow: policy?.allow?.map(parsePolicyEntry),
    deny: (policy?.deny ?? []).map(parsePolicyEntry),
    requireConfirmation: policy?.require_confirmation ?? [],
    budgetCalls: policy?.budget?.calls,
  };
}

function isAllowed(
  tool: string,
  contractUse: string[],
  policyAllow?: PolicyPathRule[],
): boolean {
  const contractAllows = matchesAny(tool, contractUse);
  if (!contractAllows) return false;
  if (!policyAllow || policyAllow.length === 0) return true;
  return policyAllow.some((rule) => matchesAny(tool, [rule.tool]));
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

function normalizeWritePayload(args: Record<string, unknown>): WriteEntry[] {
  const entries: WriteEntry[] = [];
  const writes = args.writes;

  if (Array.isArray(writes)) {
    for (const entry of writes) {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        if (typeof record.path === "string" && typeof record.contents === "string") {
          entries.push({
            path: record.path,
            contents: record.contents,
            encoding:
              typeof record.encoding === "string" ? record.encoding as BufferEncoding : undefined,
          });
        }
      } else if (typeof entry === "string") {
        const value = args.contents;
        if (typeof value === "string") {
          entries.push({ path: entry, contents: value });
        }
      }
    }
  } else if (writes && typeof writes === "object") {
    const record = writes as Record<string, unknown>;
    for (const [filePath, payload] of Object.entries(record)) {
      if (typeof payload === "string") {
        entries.push({ path: filePath, contents: payload });
      } else if (payload && typeof payload === "object") {
        const inner = payload as Record<string, unknown>;
        if (typeof inner.contents === "string") {
          entries.push({
            path: filePath,
            contents: inner.contents,
            encoding:
              typeof inner.encoding === "string" ? inner.encoding as BufferEncoding : undefined,
          });
        }
      }
    }
  }

  if (
    entries.length === 0 &&
    typeof args.path === "string" &&
    typeof args.contents === "string"
  ) {
    entries.push({
      path: args.path,
      contents: args.contents,
      encoding: typeof args.encoding === "string" ? args.encoding as BufferEncoding : undefined,
    });
  }

  return entries;
}

async function applyDiff(
  diffText: string,
): Promise<{ applied: boolean; message?: string }> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "aex-diff-"));
  const diffPath = path.join(tempDir, "patch.diff");
  try {
    await fs.writeFile(diffPath, diffText, "utf8");
    await execFile("git", ["apply", "--whitespace=nowarn", diffPath], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { applied: true };
  } catch (error) {
    return { applied: false, message: formatError(error) };
  } finally {
    await fs.rm(diffPath, { force: true }).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function extractTouchedFiles(patch: unknown): string[] {
  const files = new Set<string>();

  if (typeof patch === "string") {
    const lines = patch.split("\n");
    for (const line of lines) {
      const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line.trim());
      if (diffMatch) {
        files.add(normalizeFilePath(diffMatch[2]));
        continue;
      }
      const newFileMatch = /^\+\+\+\s+b\/(.+)$/.exec(line.trim());
      if (newFileMatch) {
        files.add(normalizeFilePath(newFileMatch[1]));
      }
    }
    return [...files];
  }

  if (Array.isArray(patch)) {
    for (const entry of patch) {
      if (typeof entry === "string") {
        files.add(normalizeFilePath(entry));
      } else if (entry && typeof entry === "object") {
        const candidate =
          (entry as Record<string, unknown>).path ??
          (entry as Record<string, unknown>).file ??
          (entry as Record<string, unknown>).newPath;
        if (typeof candidate === "string") {
          files.add(normalizeFilePath(candidate));
        }
      }
    }
    return [...files];
  }

  if (patch && typeof patch === "object") {
    const record = patch as Record<string, unknown>;
    if (Array.isArray(record.files)) {
      return extractTouchedFiles(record.files);
    }
    if (typeof record.path === "string") {
      files.add(normalizeFilePath(record.path));
      return [...files];
    }
  }

  return [];
}

function isValidDiff(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    if (!/(^|\n)(diff --git|---\s|@@ )/.test(value)) {
      return false;
    }
    return extractTouchedFiles(value).length > 0;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => {
      if (typeof entry === "string") return entry.trim().length > 0;
      if (entry && typeof entry === "object") {
        const candidate =
          (entry as Record<string, unknown>).path ??
          (entry as Record<string, unknown>).newPath;
        return typeof candidate === "string" && candidate.trim().length > 0;
      }
      return false;
    });
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.files)) {
      return isValidDiff(record.files);
    }
    if (typeof record.diff === "string") {
      return isValidDiff(record.diff);
    }
    if (typeof record.path === "string") {
      return true;
    }
  }
  return false;
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/^(\.\/)+/, "");
}

function formatIssue(issue: ValidationIssue): string {
  const segments = [];
  if (issue.code) segments.push(issue.code);
  if (issue.line) segments.push(`line ${issue.line}`);
  segments.push(issue.message);
  return segments.join(": ");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
