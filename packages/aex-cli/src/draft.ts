import { parseAEX } from "@aex-lang/parser";
import { validateText } from "@aex-lang/validator";
import { discoverPolicy } from "@aex-lang/runtime";
import { promises as fs } from "node:fs";
import path from "node:path";
import { callLLM } from "./models/llm.js";

export interface DraftOptions {
  prompt: string;
  model?: string;
  out?: string;
  name?: string;
  policyPath?: string;
  fromPlan?: string;
  maxRetries?: number;
}

export interface DraftResult {
  contract: string;
  outputPath: string;
  valid: boolean;
  diagnostics: string[];
}

const STOP_WORDS = new Set([
  "the", "a", "an", "in", "to", "for", "of", "this", "that", "and", "or",
  "is", "it", "with", "on", "at", "by", "from", "as", "be", "my", "its",
]);

export function deriveName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  const name = words.slice(0, 4).join("_");
  return name.slice(0, 30) || "generated_task";
}

export function stripFences(text: string): string {
  let result = text.trim();
  // Remove opening fence: ```aex, ```AEX, ``` etc.
  result = result.replace(/^```[a-zA-Z]*\n?/, "");
  // Remove closing fence
  result = result.replace(/\n?```\s*$/, "");
  return result.trim();
}

export function generateTimestampPrefix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

const SYNTAX_REFERENCE = `## AEX Syntax Reference

An AEX task contract has this structure:

\`\`\`
task <name> v0

goal "<what this task does>"

use <tool1>, <tool2>
deny <tool3>, <tool4>

need <input_name>: <type>

budget calls=<N>

do <tool>(<arg>=<value>) -> <binding>

make <var>: <type> from <inputs> with:
  - <instruction>
  - <instruction>

check <condition>
confirm before <tool>

do <tool>(<arg>=<value>) -> <binding>

check <binding>.passed

return {
  key: value
}
\`\`\`

Available types for \`need\`: str, num, int, bool, file, url, json, list[T], T?

Check conditions: \`has "string"\`, \`touches only [files]\`, \`is valid diff\`, \`does not include value\`, \`.passed\`

Use \`task\` (not \`agent\`) for the header keyword.`;

const DRAFTING_RULES = `## Rules

- Do not request tools denied by repo policy.
- Use the narrowest useful tool set.
- Use the narrowest useful file paths.
- Include checks that can be mechanically enforced.
- Use \`make\` only for model-generated artifacts (diffs, reviews, summaries).
- \`make\` must NOT perform side effects — it only generates text.
- Do not call file.write before checks and confirmation.
- Include \`confirm before file.write\` when writing files.
- End with a structured \`return\`.
- For code-fix tasks: run tests, read files, make diff, check diff, confirm, write, retest, check passed.
- For review tasks: deny file.write, read diff/files, make review, check sections, return review.`;

const FEW_SHOT_EXAMPLES = `## Examples

### Example 1: Fix a failing test

\`\`\`
task fix_test v0

goal "Fix the failing test with the smallest safe change."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior
  - do not touch unrelated files

check patch is valid diff
check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed

return {
  status: "fixed",
  patch: patch,
  test: final
}
\`\`\`

### Example 2: Review a pull request

\`\`\`
task review_pr v0

goal "Review a pull request for correctness and safety risks."

use git.diff, file.read
deny file.write, network.*, secrets.read

need pr_diff: file
need changed_files: list[file]

do git.diff(path=pr_diff) -> diff
do file.read(paths=changed_files) -> sources

make review: markdown from diff, sources with:
  - identify correctness risks
  - highlight missing tests
  - flag security concerns
  - note style issues

check review has "Blocking issues"

return review
\`\`\``;

export function buildSystemPrompt(policyText?: string): string {
  const parts = [
    "You are drafting an AEX task contract.",
    "Output ONLY valid AEX task syntax.",
    "Do not include Markdown fences, explanations, or surrounding text.",
    "",
    SYNTAX_REFERENCE,
    "",
    DRAFTING_RULES,
  ];

  if (policyText) {
    parts.push(
      "",
      "## Active Policy",
      "",
      "The following repo policy is active. Your contract MUST NOT request tools outside the policy's allow list. Include denied tools from the policy in your deny list.",
      "",
      "```",
      policyText.trim(),
      "```",
    );
  }

  parts.push("", FEW_SHOT_EXAMPLES);

  return parts.join("\n");
}

export async function draftContract(
  options: DraftOptions,
): Promise<DraftResult> {
  // Determine the user prompt
  let userPrompt: string;
  if (options.fromPlan) {
    const planPath = path.isAbsolute(options.fromPlan)
      ? options.fromPlan
      : path.resolve(process.cwd(), options.fromPlan);
    userPrompt = await fs.readFile(planPath, "utf8");
  } else {
    userPrompt = options.prompt;
  }

  // Load policy
  let policyText: string | undefined;
  const policyPath = options.policyPath
    ? path.isAbsolute(options.policyPath)
      ? options.policyPath
      : path.resolve(process.cwd(), options.policyPath)
    : await discoverPolicy();

  if (policyPath) {
    policyText = await fs.readFile(policyPath, "utf8");
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(policyText);

  // Determine task name and output path
  const taskName = options.name ?? deriveName(options.prompt);
  const maxRetries = options.maxRetries ?? 1;

  let contract = "";
  const allDiagnostics: string[] = [];
  let valid = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let prompt = userPrompt;
    if (attempt > 0 && allDiagnostics.length > 0) {
      prompt +=
        "\n\nThe contract you generated has errors:\n" +
        allDiagnostics.map((d) => `- ${d}`).join("\n") +
        "\n\nFix these errors and output the corrected contract.";
    }

    const raw = await callLLM(systemPrompt, prompt, options.model);
    contract = stripFences(raw);

    // Inject/override task name if the model used a different one
    const headerMatch = contract.match(
      /^(task|agent)\s+\S+\s+v[0-9.]+/m,
    );
    if (headerMatch) {
      contract = contract.replace(
        headerMatch[0],
        `task ${taskName} v0`,
      );
    } else if (!contract.match(/^(task|agent)\s/m)) {
      contract = `task ${taskName} v0\n\n${contract}`;
    }

    // Validate
    allDiagnostics.length = 0;
    const parseResult = parseAEX(contract, { tolerant: true });
    for (const d of parseResult.diagnostics) {
      allDiagnostics.push(
        `Line ${d.line ?? "-"}: ${d.message}`,
      );
    }

    const validation = validateText(contract);
    for (const issue of validation.issues) {
      if (issue.severity === "error") {
        allDiagnostics.push(
          `${issue.code ?? ""} ${issue.message}`.trim(),
        );
      }
    }

    if (allDiagnostics.length === 0) {
      valid = true;
      break;
    }
  }

  // Determine output path
  let outputPath: string;
  if (options.out) {
    outputPath = path.isAbsolute(options.out)
      ? options.out
      : path.resolve(process.cwd(), options.out);
  } else {
    const runsDir = path.resolve(process.cwd(), ".aex", "runs");
    await fs.mkdir(runsDir, { recursive: true });
    const timestamp = generateTimestampPrefix();
    outputPath = path.join(
      runsDir,
      `${timestamp}-${taskName}.aex`,
    );
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Write contract
  const finalContract = contract.trimEnd() + "\n";
  await fs.writeFile(outputPath, finalContract, "utf8");

  return {
    contract: finalContract,
    outputPath,
    valid,
    diagnostics: allDiagnostics,
  };
}
