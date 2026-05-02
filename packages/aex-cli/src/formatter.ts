import { promises as fs } from "node:fs";
import { parseFile, ParseResult, AEXStep, AEXTask } from "@aex/parser";
import { validateParsed } from "@aex/validator";

export interface FormatResult {
  formatted: string;
  original: string;
  issues: ReturnType<typeof validateParsed>["issues"];
}

export async function formatFile(filePath: string): Promise<FormatResult> {
  const original = await fs.readFile(filePath, "utf8");
  const parsed = await parseFile(filePath, { tolerant: true });
  const validation = validateParsed(parsed);
  const formatted = formatTask(validation.task).trimEnd() + "\n";
  return { formatted, original, issues: validation.issues };
}

export function formatTask(task: AEXTask): string {
  const lines: string[] = [];

  if (task.agent) {
    lines.push(`agent ${task.agent.name} v${task.agent.version}`);
  }

  if (task.goal) {
    lines.push("", `goal "${task.goal}"`);
  }

  if (task.use.length > 0) {
    lines.push("", `use ${task.use.join(", ")}`);
  }

  if (task.deny.length > 0) {
    lines.push(`deny ${task.deny.join(", ")}`);
  }

  const needEntries = Object.entries(task.needs);
  if (needEntries.length > 0) {
    lines.push("");
    for (const [name, type] of needEntries) {
      lines.push(`need ${name}: ${type}`);
    }
  }

  if (task.budget && Object.keys(task.budget).length > 0) {
    const budgetParts = Object.entries(task.budget)
      .map(([key, value]) => `${key}=${value}`);
    lines.push("", `budget ${budgetParts.join(", ")}`);
  }

  const knownValues = new Set<string>(Object.keys(task.needs));

  task.steps.forEach((step) => {
    lines.push("", ...formatStep(step, knownValues));
    if (step.kind === "do" && step.bind) {
      knownValues.add(step.bind);
    }
    if (step.kind === "make") {
      knownValues.add(step.bind);
    }
  }
  );

  return lines.filter((line, index, array) => !(line === "" && array[index - 1] === "")).join("\n").replace(/^\n+/, "");
}

function formatStep(step: AEXStep, knownValues: Set<string>): string[] {
  switch (step.kind) {
    case "do": {
      const pairs = Object.entries(step.args)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, value]) =>
            `${key}=${formatArgValue(value, knownValues)}`,
        );
      const suffix = step.bind ? ` -> ${step.bind}` : "";
      return [`do ${step.tool}(${pairs.join(", ")})${suffix}`];
    }
    case "make": {
      const sources = step.inputs.join(", ");
      const header = `make ${step.bind}: ${step.type} from ${sources} with:`;
      const instructions = step.instructions.map((item) => `  - ${item}`);
      return [header, ...instructions];
    }
    case "check":
      return [`check ${step.condition}`];
    case "confirm":
      return [`confirm before ${step.before}`];
    case "return": {
      const expression = step.expression.trim();
      if (expression.includes("\n")) {
        const body = expression
          .split("\n")
          .map((line, index) => (index === 0 ? line : `  ${line}`));
        return [`return ${body.shift()}`, ...body];
      }
      return [`return ${expression}`];
    }
    default:
      return [];
  }
}

function formatArgValue(value: string, knownValues: Set<string>): string {
  const trimmed = value.trim();
  if (trimmed === "") return trimmed;
  if (/^[0-9.+-]+$/.test(trimmed) && !Number.isNaN(Number(trimmed))) {
    return trimmed;
  }
  if (trimmed === "true" || trimmed === "false") {
    return trimmed;
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return trimmed;
  }
  const root = trimmed.split(".")[0] ?? trimmed;
  if (knownValues.has(root)) {
    return trimmed;
  }
  if (/^['"].*['"]$/.test(trimmed)) {
    return `"${trimmed.slice(1, -1)}"`;
  }
  return `"${trimmed}"`;
}
