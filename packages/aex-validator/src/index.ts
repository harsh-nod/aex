import {
  parseAEX,
  parseFile,
  ParseResult,
  AEXTask,
  AEXStep,
  AEXDoStep,
  AEXMakeStep,
  matchesAny,
} from "@aex-lang/parser";

export interface ValidationIssue {
  message: string;
  line?: number;
  severity: "error" | "warning";
  code?: string;
}

export interface ValidationResult {
  task: AEXTask;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  tolerantParse?: boolean;
}

export async function validateFile(
  filePath: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const parsed = await parseFile(filePath, {
    tolerant: options.tolerantParse ?? true,
  });
  return validateParsed(parsed);
}

export function validateText(
  source: string,
  options: ValidateOptions = {},
): ValidationResult {
  const parsed = parseAEX(source, {
    tolerant: options.tolerantParse ?? true,
  });
  return validateParsed(parsed);
}

export function validateParsed(parsed: ParseResult): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { task } = parsed;

  for (const diagnostic of parsed.diagnostics) {
    issues.push({
      message: diagnostic.message,
      line: diagnostic.line,
      severity: "error",
      code: "AEX100",
    });
  }

  if (!task.agent) {
    issues.push({
      message: task.isPolicy
        ? "Policy is missing a policy declaration."
        : "Task is missing an agent declaration.",
      severity: "error",
      code: "AEX001",
    });
  }

  if (!task.goal) {
    issues.push({
      message: task.isPolicy
        ? "Policy is missing a goal."
        : "Task is missing a goal.",
      severity: "error",
      code: "AEX002",
    });
  }

  if (task.isPolicy) {
    // Policy-specific validation
    if (Object.keys(task.needs).length > 0) {
      issues.push({
        message: "Policy files cannot have need declarations.",
        severity: "error",
        code: "AEX033",
      });
    }
    const execSteps = task.steps.filter(
      (s) => s.kind === "do" || s.kind === "make" || s.kind === "return" || s.kind === "check" || s.kind === "if" || s.kind === "for",
    );
    if (execSteps.length > 0) {
      issues.push({
        message: "Policy files cannot have execution steps.",
        severity: "error",
        code: "AEX034",
      });
    }
    return { task, issues };
  }

  // Task-specific validation
  if (!task.returnStatement) {
    issues.push({
      message: "Task is missing a return statement.",
      severity: "error",
      code: "AEX003",
    });
  }

  checkNeedTypes(task.needs, issues);

  const allowedTools = new Set(task.use);
  const deniedTools = new Set(task.deny);
  const knownValues = new Set(Object.keys(task.needs));

  validateSteps(task.steps, allowedTools, deniedTools, knownValues, issues);

  return { task, issues };
}

const KNOWN_TYPES = new Set([
  "str", "num", "int", "bool", "file", "url", "json",
]);

function isKnownBaseType(type: string): boolean {
  if (KNOWN_TYPES.has(type)) return true;
  if (type.endsWith("?")) return isKnownBaseType(type.slice(0, -1));
  const listMatch = /^list\[(.+)\]$/.exec(type);
  if (listMatch) return isKnownBaseType(listMatch[1]);
  return false;
}

function checkNeedTypes(
  needs: Record<string, string>,
  issues: ValidationIssue[],
) {
  for (const [name, type] of Object.entries(needs)) {
    if (!isKnownBaseType(type)) {
      issues.push({
        message: `Input "${name}" declares unknown type "${type}". Known types: str, num, int, bool, file, url, json, list[T], T?.`,
        severity: "error",
        code: "AEX032",
      });
    }
  }
}

function validateSteps(
  steps: AEXStep[],
  allowedTools: Set<string>,
  deniedTools: Set<string>,
  knownValues: Set<string>,
  issues: ValidationIssue[],
) {
  for (const step of steps) {
    switch (step.kind) {
      case "do":
        checkToolPermissions(step, allowedTools, deniedTools, issues);
        if (step.bind) {
          knownValues.add(step.bind);
        }
        break;
      case "make":
        checkInputs(step, knownValues, issues);
        knownValues.add(step.bind);
        break;
      case "if":
        validateSteps(step.body, allowedTools, deniedTools, knownValues, issues);
        break;
      case "for": {
        const scopedValues = new Set(knownValues);
        scopedValues.add(step.variable);
        validateSteps(step.body, allowedTools, deniedTools, scopedValues, issues);
        break;
      }
      default:
        break;
    }
  }
}

function checkToolPermissions(
  step: AEXDoStep,
  allowedTools: Set<string>,
  deniedTools: Set<string>,
  issues: ValidationIssue[],
) {
  if (!matchesAny(step.tool, allowedTools)) {
    issues.push({
      message: `Tool "${step.tool}" is not declared in use.`,
      line: step.line,
      severity: "error",
      code: "AEX010",
    });
  }

  if (matchesAny(step.tool, deniedTools)) {
    issues.push({
      message: `Tool "${step.tool}" is denied by the contract.`,
      line: step.line,
      severity: "error",
      code: "AEX011",
    });
  }
}

function checkInputs(
  step: AEXMakeStep,
  knownValues: Set<string>,
  issues: ValidationIssue[],
) {
  for (const input of step.inputs) {
    const identifier = input.replace(/^\$+/, "").trim();
    if (!identifier) continue;
    if (!knownValues.has(identifier)) {
      issues.push({
        message: `Make step "${step.bind}" references unknown value "${identifier}".`,
        line: step.line,
        severity: "error",
        code: "AEX020",
      });
    }
  }
}
