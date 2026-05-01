import { parseFile } from "@aex/parser";
import { validateParsed, ValidationIssue } from "@aex/validator";

export interface RuntimePolicy {
  allow?: string[];
  deny?: string[];
  require_confirmation?: string[];
  budget?: Record<string, number>;
}

export interface RunOptions {
  inputs?: Record<string, unknown>;
  policy?: RuntimePolicy;
  logger?: (event: RuntimeEvent) => void;
}

export interface RuntimeEvent {
  event: string;
  data?: Record<string, unknown>;
}

export interface RunResult {
  status: "success" | "blocked";
  issues: string[];
}

export async function runTask(
  filePath: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const parsed = await parseFile(filePath, { tolerant: true });
  const validation = validateParsed(parsed);

  const errors = validation.issues
    .filter((issue) => issue.severity === "error")
    .map(formatIssue);

  if (errors.length > 0) {
    return { status: "blocked", issues: errors };
  }

  options.logger?.({
    event: "run.started",
    data: { agent: validation.task.agent?.name },
  });

  options.logger?.({
    event: "run.finished",
    data: { status: "not_implemented" },
  });

  return {
    status: "blocked",
    issues: [
      "Runtime execution is not implemented yet. The contract passed validation.",
    ],
  };
}

function formatIssue(issue: ValidationIssue): string {
  return issue.line ? `line ${issue.line}: ${issue.message}` : issue.message;
}
