import path from "node:path";
import { parseFile, AEXTask, AEXStep } from "@aex-lang/parser";
import { validateParsed } from "@aex-lang/validator";

export interface LangGraphNode {
  id: string;
  kind: AEXStep["kind"];
  data: Record<string, unknown>;
  next?: string;
  line: number;
}

export interface LangGraphPlan {
  start: string | null;
  nodes: Record<string, LangGraphNode>;
  metadata: {
    agent?: string;
    goal?: string;
    source?: string;
  };
}

export interface CompileOptions {
  tolerant?: boolean;
}

export async function compileFileToLangGraph(
  filePath: string,
  options: CompileOptions = {},
): Promise<LangGraphPlan> {
  const parsed = await parseFile(filePath, {
    tolerant: options.tolerant ?? true,
  });
  const validation = validateParsed(parsed);
  const errors = validation.issues.filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length > 0) {
    const formatted = errors
      .map((issue) =>
        issue.line ? `line ${issue.line}: ${issue.message}` : issue.message,
      )
      .join("\n");
    throw new Error(`Unable to compile AEX contract: ${formatted}`);
  }

  const plan = taskToLangGraph(validation.task);
  plan.metadata.source = path.resolve(filePath);
  return plan;
}

export function taskToLangGraph(task: AEXTask): LangGraphPlan {
  const nodes: Record<string, LangGraphNode> = {};
  let previousId: string | undefined;
  let start: string | null = null;

  task.steps.forEach((step, index) => {
    const id = generateNodeId(step, index, nodes);
    const node: LangGraphNode = {
      id,
      kind: step.kind,
      data: serializeStep(step),
      line: step.line,
    };
    nodes[id] = node;
    if (!start) {
      start = id;
    }
    if (previousId) {
      nodes[previousId].next = id;
    }
    previousId = id;
  });

  return {
    start,
    nodes,
    metadata: {
      agent: task.agent?.name,
      goal: task.goal,
    },
  };
}

function generateNodeId(
  step: AEXStep,
  index: number,
  existing: Record<string, LangGraphNode>,
): string {
  const base =
    step.kind === "do"
      ? (step.bind ?? `${step.tool}-${index}`)
      : step.kind === "make"
        ? step.bind
        : `${step.kind}-${index}`;
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "-") || `${step.kind}-${index}`;
  if (!existing[safe]) return safe;
  let counter = 1;
  while (existing[`${safe}-${counter}`]) {
    counter += 1;
  }
  return `${safe}-${counter}`;
}

function serializeStep(step: AEXStep): Record<string, unknown> {
  switch (step.kind) {
    case "do":
      return {
        tool: step.tool,
        args: step.args,
        bind: step.bind ?? null,
      };
    case "make":
      return {
        bind: step.bind,
        generator: step.type,
        inputs: step.inputs,
        instructions: step.instructions,
      };
    case "check":
      return {
        condition: step.condition,
      };
    case "confirm":
      return {
        before: step.before,
      };
    case "return":
      return {
        expression: step.expression,
      };
    default:
      return {};
  }
}
