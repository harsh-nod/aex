import {
  parseAEX,
  parseFile,
  ParseResult,
  AEXTask,
  AEXDoStep,
  AEXMakeStep,
} from "@aex/parser";

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
      message: "Task is missing an agent declaration.",
      severity: "error",
      code: "AEX001",
    });
  }

  if (!task.goal) {
    issues.push({
      message: "Task is missing a goal.",
      severity: "error",
      code: "AEX002",
    });
  }

  if (!task.returnStatement) {
    issues.push({
      message: "Task is missing a return statement.",
      severity: "error",
      code: "AEX003",
    });
  }

  const allowedTools = new Set(task.use);
  const deniedTools = new Set(task.deny);
  const knownValues = new Set(Object.keys(task.needs));

  for (const step of task.steps) {
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
      default:
        break;
    }
  }

  return { task, issues };
}

function checkToolPermissions(
  step: AEXDoStep,
  allowedTools: Set<string>,
  deniedTools: Set<string>,
  issues: ValidationIssue[],
) {
  if (!matchesList(step.tool, allowedTools)) {
    issues.push({
      message: `Tool "${step.tool}" is not declared in use.`,
      line: step.line,
      severity: "error",
      code: "AEX010",
    });
  }

  if (matchesList(step.tool, deniedTools)) {
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

function matchesList(value: string, list: Set<string>): boolean {
  if (list.has(value)) {
    return true;
  }
  for (const entry of list) {
    if (entry.endsWith(".*")) {
      const prefix = entry.slice(0, -2);
      if (value.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}
