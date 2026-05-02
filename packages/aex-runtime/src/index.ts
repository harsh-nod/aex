import {
  parseFile,
  AEXTask,
  AEXDoStep,
  AEXMakeStep,
  AEXReturnStep,
  AEXConfirmStep,
  AEXIfStep,
  AEXForStep,
  AEXStep,
  matchesAny,
} from "@aex-lang/parser";
import {
  validateParsed,
  ValidationIssue,
} from "@aex-lang/validator";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as childExecFile } from "node:child_process";
import { tmpdir } from "node:os";

const execFile = promisify(childExecFile);

export interface RuntimePolicy {
  extends?: string | RuntimePolicy;
  allow?: string[];
  deny?: string[];
  require_confirmation?: string[];
  budget?: Record<string, number>;
}

export function composePolicies(...policies: RuntimePolicy[]): RuntimePolicy {
  const result: RuntimePolicy = {};
  const allAllow: string[] = [];
  const allDeny: string[] = [];
  const allConfirm: string[] = [];
  const mergedBudget: Record<string, number> = {};

  for (const policy of policies) {
    if (policy.allow) allAllow.push(...policy.allow);
    if (policy.deny) allDeny.push(...policy.deny);
    if (policy.require_confirmation) allConfirm.push(...policy.require_confirmation);
    if (policy.budget) {
      for (const [key, value] of Object.entries(policy.budget)) {
        mergedBudget[key] =
          key in mergedBudget ? Math.min(mergedBudget[key], value) : value;
      }
    }
  }

  if (allAllow.length > 0) result.allow = [...new Set(allAllow)];
  if (allDeny.length > 0) result.deny = [...new Set(allDeny)];
  if (allConfirm.length > 0) result.require_confirmation = [...new Set(allConfirm)];
  if (Object.keys(mergedBudget).length > 0) result.budget = mergedBudget;

  return result;
}

export async function resolvePolicy(
  policy: RuntimePolicy,
  loader?: (ref: string) => Promise<RuntimePolicy>,
): Promise<RuntimePolicy> {
  if (!policy.extends) return policy;

  let base: RuntimePolicy;
  if (typeof policy.extends === "string") {
    if (!loader) {
      const raw = await fs.readFile(policy.extends, "utf8");
      base = JSON.parse(raw) as RuntimePolicy;
    } else {
      base = await loader(policy.extends);
    }
    base = await resolvePolicy(base, loader);
  } else {
    base = await resolvePolicy(policy.extends, loader);
  }

  const { extends: _, ...ownFields } = policy;
  return composePolicies(base, ownFields);
}

export interface RuntimeEvent {
  event: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  traceId?: string;
  spanId?: string;
}

export interface StructuredLogger {
  log(event: RuntimeEvent): void;
  getEvents(): RuntimeEvent[];
  toJSON(): string;
  toOTLP(): OTLPExportPayload;
}

export interface OTLPSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
}

export interface OTLPExportPayload {
  resourceSpans: Array<{
    resource: {
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OTLPSpan[];
    }>;
  }>;
}

function generateId(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createStructuredLogger(
  agentName?: string,
): StructuredLogger {
  const events: RuntimeEvent[] = [];
  const traceId = generateId(16);

  return {
    log(event: RuntimeEvent) {
      events.push({
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
        traceId,
        spanId: generateId(8),
      });
    },
    getEvents() {
      return [...events];
    },
    toJSON() {
      return JSON.stringify(events, null, 2);
    },
    toOTLP(): OTLPExportPayload {
      const spans: OTLPSpan[] = events.map((ev) => {
        const ts = ev.timestamp
          ? (BigInt(new Date(ev.timestamp).getTime()) * 1_000_000n).toString()
          : (BigInt(Date.now()) * 1_000_000n).toString();
        const attributes: OTLPSpan["attributes"] = [
          { key: "aex.event", value: { stringValue: ev.event } },
        ];
        if (ev.data) {
          for (const [key, val] of Object.entries(ev.data)) {
            attributes.push({
              key: `aex.${key}`,
              value: { stringValue: String(val) },
            });
          }
        }
        return {
          traceId: ev.traceId ?? traceId,
          spanId: ev.spanId ?? generateId(8),
          name: ev.event,
          startTimeUnixNano: ts,
          endTimeUnixNano: ts,
          attributes,
        };
      });

      return {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: agentName ?? "aex-runtime" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "@aex-lang/runtime", version: "0.0.1" },
                spans,
              },
            ],
          },
        ],
      };
    },
  };
}

export async function exportToOTLP(
  payload: OTLPExportPayload,
  endpoint: string,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `OTLP export failed: ${response.status.toString()} ${response.statusText}`,
    );
  }
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

export interface RemoteToolRegistry {
  url: string;
  headers?: Record<string, string>;
}

export interface RunOptions {
  inputs?: Record<string, unknown>;
  policy?: RuntimePolicy;
  tools?: ToolRegistry;
  registry?: RemoteToolRegistry;
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

export async function fetchRemoteTools(
  registry: RemoteToolRegistry,
): Promise<ToolRegistry> {
  const response = await fetch(registry.url, {
    headers: {
      Accept: "application/json",
      ...(registry.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Remote registry returned ${response.status.toString()}: ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as {
    tools?: Record<string, { sideEffect?: string; url?: string; description?: string }>;
  };
  if (!payload.tools || typeof payload.tools !== "object") {
    throw new Error("Remote registry response must contain a `tools` object.");
  }
  const result: ToolRegistry = {};
  for (const [name, def] of Object.entries(payload.tools)) {
    const sideEffect = (
      ["none", "read", "write"].includes(def.sideEffect ?? "")
        ? def.sideEffect
        : "write"
    ) as "none" | "read" | "write";
    const toolUrl = def.url;
    if (!toolUrl) {
      continue;
    }
    result[name] = {
      sideEffect,
      handler: createRemoteToolHandler(toolUrl, registry.headers),
    };
  }
  return result;
}

function createRemoteToolHandler(
  url: string,
  headers?: Record<string, string>,
): ToolHandler {
  return async (args) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers ?? {}),
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(
        `Remote tool returned ${response.status.toString()}: ${response.statusText}`,
      );
    }
    return response.json();
  };
}

const KNOWN_TYPES = new Set([
  "str", "num", "int", "bool", "file", "url", "json",
]);

function isKnownType(type: string): boolean {
  if (KNOWN_TYPES.has(type)) return true;
  if (type.endsWith("?")) return isKnownType(type.slice(0, -1));
  const listMatch = /^list\[(.+)\]$/.exec(type);
  if (listMatch) return isKnownType(listMatch[1]);
  return false;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "str") return typeof value === "string";
  if (type === "num") return typeof value === "number" && Number.isFinite(value);
  if (type === "int") return Number.isInteger(value);
  if (type === "bool") return typeof value === "boolean";
  if (type === "json") return true;
  if (type === "file") return typeof value === "string" && value.length > 0;
  if (type === "url") {
    if (typeof value !== "string") return false;
    try { new URL(value); return true; } catch { return false; }
  }
  const listMatch = /^list\[(.+)\]$/.exec(type);
  if (listMatch) {
    return Array.isArray(value) && value.every((item) => matchesType(item, listMatch[1]));
  }
  return false;
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  return typeof value;
}

export interface InputIssue {
  event: "input.missing" | "input.invalid";
  input: string;
  expected: string;
  actual?: string;
  code: string;
}

export function validateInputs(
  needs: Record<string, string>,
  inputs: Record<string, unknown>,
): InputIssue[] {
  const issues: InputIssue[] = [];

  for (const [name, type] of Object.entries(needs)) {
    const optional = type.endsWith("?");
    const expected = optional ? type.slice(0, -1) : type;

    if (!(name in inputs)) {
      if (!optional) {
        issues.push({
          event: "input.missing",
          input: name,
          expected: type,
          code: "AEX030",
        });
      }
      continue;
    }

    if (!matchesType(inputs[name], expected)) {
      issues.push({
        event: "input.invalid",
        input: name,
        expected,
        actual: actualType(inputs[name]),
        code: "AEX031",
      });
    }
  }

  return issues;
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

  const inputIssues = validateInputs(
    validation.task.needs,
    options.inputs ?? {},
  );
  if (inputIssues.length > 0) {
    const logger = options.logger ?? (() => { /* noop */ });
    for (const issue of inputIssues) {
      logger({ event: issue.event, data: { input: issue.input, expected: issue.expected, actual: issue.actual } });
    }
    return {
      status: "blocked",
      issues: inputIssues.map((i) =>
        i.event === "input.missing"
          ? `${i.code}: Missing required input "${i.input}" of type "${i.expected}".`
          : `${i.code}: Input "${i.input}" expected ${i.expected}, got ${i.actual}.`,
      ),
    };
  }

  let mergedTools = options.tools;
  if (options.registry) {
    const remoteTools = await fetchRemoteTools(options.registry);
    mergedTools = { ...(mergedTools ?? {}), ...remoteTools };
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

  const effectiveOptions = mergedTools
    ? { ...options, tools: mergedTools }
    : options;

  const state: ExecutionState = {
    context,
    task: validation.task,
    options: effectiveOptions,
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
    case "if":
      return executeIf(step, state);
    case "for":
      return executeFor(step, state);
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

async function executeIf(
  step: AEXIfStep,
  state: ExecutionState,
): Promise<StepResult> {
  const checkResult = evaluateCheck(step.condition, state);
  state.context.logger({
    event: checkResult.ok ? "if.true" : "if.false",
    data: { condition: step.condition },
  });
  if (!checkResult.ok) {
    return { status: "continue" };
  }
  for (const bodyStep of step.body) {
    const result = await executeStep(bodyStep, state);
    if (result.status !== "continue") {
      return result;
    }
  }
  return { status: "continue" };
}

async function executeFor(
  step: AEXForStep,
  state: ExecutionState,
): Promise<StepResult> {
  const iterable = resolveToken(step.iterable, state);
  if (!Array.isArray(iterable)) {
    return {
      status: "blocked",
      reason: `for loop expects an array for "${step.iterable}", got ${typeof iterable}`,
    };
  }
  state.context.logger({
    event: "for.start",
    data: { variable: step.variable, count: iterable.length },
  });
  for (const item of iterable) {
    state.context.variables.set(step.variable, item);
    for (const bodyStep of step.body) {
      const result = await executeStep(bodyStep, state);
      if (result.status !== "continue") {
        return result;
      }
    }
  }
  state.context.variables.delete(step.variable);
  return { status: "continue" };
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
