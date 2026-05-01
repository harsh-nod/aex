import { promises as fs } from "node:fs";

export interface ParseError {
  message: string;
  line: number;
}

export interface AEXAgent {
  name: string;
  version: string;
}

export interface AEXTask {
  agent?: AEXAgent;
  goal?: string;
  use: string[];
  deny: string[];
  needs: Record<string, string>;
  budget?: Record<string, number>;
  steps: AEXStep[];
  returnStatement?: string;
}

export type AEXStep =
  | AEXDoStep
  | AEXMakeStep
  | AEXCheckStep
  | AEXConfirmStep
  | AEXReturnStep;

export interface AEXDoStep {
  kind: "do";
  tool: string;
  args: Record<string, string>;
  bind?: string;
  line: number;
}

export interface AEXMakeStep {
  kind: "make";
  bind: string;
  type: string;
  inputs: string[];
  instructions: string[];
  line: number;
}

export interface AEXCheckStep {
  kind: "check";
  condition: string;
  line: number;
}

export interface AEXConfirmStep {
  kind: "confirm";
  before: string;
  line: number;
}

export interface AEXReturnStep {
  kind: "return";
  expression: string;
  line: number;
}

export interface ParseOptions {
  tolerant?: boolean;
}

export interface ParseResult {
  task: AEXTask;
  diagnostics: ParseError[];
}

export async function parseFile(
  filePath: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const contents = await fs.readFile(filePath, "utf8");
  return parseAEX(contents, options);
}

export function parseAEX(
  source: string,
  options: ParseOptions = {},
): ParseResult {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const task: AEXTask = {
    use: [],
    deny: [],
    needs: {},
    steps: [],
  };
  const diagnostics: ParseError[] = [];

  let currentLine = 0;
  let pendingMake: AEXMakeStep | undefined;
  let pendingReturn: { expression: string; depth: number } | undefined;

  const flushPendingMake = () => {
    if (pendingMake) {
      task.steps.push(pendingMake);
      pendingMake = undefined;
    }
  };

  for (const rawLine of lines) {
    currentLine += 1;
    const trimmed = rawLine.trim();

    if (pendingReturn) {
      pendingReturn.expression += `\n${rawLine}`;
      pendingReturn.depth += countOccurrences(rawLine, "{");
      pendingReturn.depth -= countOccurrences(rawLine, "}");
      if (pendingReturn.depth <= 0) {
        task.steps.push({
          kind: "return",
          expression: pendingReturn.expression.trim(),
          line: currentLine,
        });
        task.returnStatement = pendingReturn.expression.trim();
        pendingReturn = undefined;
      }
      continue;
    }

    if (!trimmed) {
      flushPendingMake();
      continue;
    }

    if (trimmed.startsWith("#")) {
      flushPendingMake();
      continue;
    }

    if (trimmed.startsWith("-") && pendingMake) {
      pendingMake.instructions.push(trimmed.replace(/^-+\s*/, "").trim());
      continue;
    }

    flushPendingMake();

    if (trimmed.startsWith("agent ")) {
      const match = /^agent\s+([A-Za-z0-9_-]+)\s+v([0-9.]+)$/.exec(trimmed);
      if (!match) {
        diagnostics.push({
          message: "Invalid agent declaration",
          line: currentLine,
        });
      } else {
        task.agent = { name: match[1], version: match[2] };
      }
      continue;
    }

    if (trimmed.startsWith("goal ")) {
      const match = /^goal\s+"(.*)"$/.exec(trimmed);
      if (!match) {
        diagnostics.push({
          message: "Goal must be a quoted string",
          line: currentLine,
        });
      } else {
        task.goal = match[1];
      }
      continue;
    }

    if (trimmed.startsWith("use ")) {
      task.use.push(...splitList(trimmed.substring(4)));
      continue;
    }

    if (trimmed.startsWith("deny ")) {
      task.deny.push(...splitList(trimmed.substring(5)));
      continue;
    }

    if (trimmed.startsWith("need ")) {
      const match = /^need\s+([A-Za-z0-9_.-]+)\s*:\s*(.+)$/.exec(trimmed);
      if (!match) {
        diagnostics.push({
          message: "Invalid need declaration",
          line: currentLine,
        });
      } else {
        task.needs[match[1]] = match[2];
      }
      continue;
    }

    if (trimmed.startsWith("budget ")) {
      const parts = splitList(trimmed.substring(7));
      const budget = task.budget ?? {};
      for (const part of parts) {
        const [key, value] = part.split("=");
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          diagnostics.push({
            message: `Invalid numeric budget value for "${part}"`,
            line: currentLine,
          });
        } else {
          budget[key.trim()] = numeric;
        }
      }
      task.budget = budget;
      continue;
    }

    if (trimmed.startsWith("do ")) {
      const match =
        /^do\s+([A-Za-z0-9._*]+)\s*\((.*)\)\s*(?:->\s*([A-Za-z0-9_.-]+))?$/.exec(
          trimmed,
        );
      if (!match) {
        diagnostics.push({
          message: "Invalid do statement",
          line: currentLine,
        });
      } else {
        task.steps.push({
          kind: "do",
          tool: match[1],
          args: parseArgs(match[2]),
          bind: match[3],
          line: currentLine,
        });
      }
      continue;
    }

    if (trimmed.startsWith("make ")) {
      const match =
        /^make\s+([A-Za-z0-9_.-]+)\s*:\s*([A-Za-z0-9_.-]+)\s+from\s+(.+?)\s+with\s*:?\s*$/.exec(
          trimmed,
        );
      if (!match) {
        diagnostics.push({
          message: "Invalid make statement",
          line: currentLine,
        });
      } else {
        pendingMake = {
          kind: "make",
          bind: match[1],
          type: match[2],
          inputs: splitList(match[3]),
          instructions: [],
          line: currentLine,
        };
      }
      continue;
    }

    if (trimmed.startsWith("check ")) {
      task.steps.push({
        kind: "check",
        condition: trimmed.substring(6).trim(),
        line: currentLine,
      });
      continue;
    }

    if (trimmed.startsWith("confirm before ")) {
      task.steps.push({
        kind: "confirm",
        before: trimmed.substring("confirm before ".length).trim(),
        line: currentLine,
      });
      continue;
    }

    if (trimmed.startsWith("return ")) {
      const expression = trimmed.substring(7).trim();
      const depth =
        countOccurrences(expression, "{") - countOccurrences(expression, "}");
      if (depth > 0 && !expression.endsWith("}")) {
        pendingReturn = { expression, depth };
      } else {
        task.steps.push({
          kind: "return",
          expression,
          line: currentLine,
        });
        task.returnStatement = expression;
      }
      continue;
    }

    diagnostics.push({
      message: `Unrecognized line: "${trimmed}"`,
      line: currentLine,
    });
  }

  flushPendingMake();

  if (pendingReturn) {
    diagnostics.push({
      message: "Return block was not closed",
      line: currentLine,
    });
  }

  if (!task.agent) {
    diagnostics.push({ message: "Missing agent declaration", line: 0 });
  }
  if (!task.goal) {
    diagnostics.push({ message: "Missing goal declaration", line: 0 });
  }

  if (!options.tolerant && diagnostics.length > 0) {
    throw new ParseFailure(diagnostics);
  }

  return { task, diagnostics };
}

export class ParseFailure extends Error {
  constructor(public diagnostics: ParseError[]) {
    super(
      diagnostics[0]
        ? `AEX parse failed: ${diagnostics[0].message} (line ${diagnostics[0].line})`
        : "AEX parse failed",
    );
    this.name = "ParseFailure";
  }
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseArgs(value: string): Record<string, string> {
  const args: Record<string, string> = {};
  const trimmed = value.trim();
  if (!trimmed) {
    return args;
  }
  for (const part of splitArgs(trimmed)) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      args[part.trim()] = "";
    } else {
      const key = part.substring(0, eqIndex).trim();
      const raw = part.substring(eqIndex + 1).trim();
      args[key] = stripQuotes(raw);
    }
  }
  return args;
}

function splitArgs(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

export interface AEXIR {
  version: string;
  agent: string;
  goal?: string;
  permissions: {
    use: string[];
    deny: string[];
  };
  needs: Record<string, string>;
  budget?: Record<string, number>;
  steps: AEXIRStep[];
  return?: string;
}

export type AEXIRStep =
  | {
      op: "call";
      tool: string;
      args: Record<string, string>;
      bind?: string;
    }
  | {
      op: "make";
      bind: string;
      type: string;
      inputs: string[];
      instructions: string[];
    }
  | {
      op: "check";
      condition: string;
    }
  | {
      op: "confirm";
      tool: string;
    }
  | {
      op: "return";
      value: string;
    };

export function compileTask(task: AEXTask): AEXIR {
  const agentName = task.agent?.name ?? "unknown_agent";
  const agentVersion = task.agent?.version ?? "0";

  const steps: AEXIRStep[] = task.steps.map((step) => {
    switch (step.kind) {
      case "do":
        return {
          op: "call",
          tool: step.tool,
          args: step.args,
          bind: step.bind,
        };
      case "make":
        return {
          op: "make",
          bind: step.bind,
          type: step.type,
          inputs: step.inputs,
          instructions: step.instructions,
        };
      case "check":
        return {
          op: "check",
          condition: step.condition,
        };
      case "confirm":
        return {
          op: "confirm",
          tool: step.before,
        };
      case "return":
        return {
          op: "return",
          value: step.expression,
        };
      default:
        return {
          op: "check",
          condition: `unsupported step ${(step as AEXStep).kind}`,
        };
    }
  });

  return {
    version: agentVersion,
    agent: agentName,
    goal: task.goal,
    permissions: {
      use: task.use,
      deny: task.deny,
    },
    needs: task.needs,
    budget: task.budget,
    steps,
    return: task.returnStatement,
  };
}
