#!/usr/bin/env node

import { Command } from "commander";
import { compileTask, parseFile, ParseError } from "@aex-lang/parser";
import { ValidationIssue, validateText } from "@aex-lang/validator";
import {
  runTask,
  RuntimePolicy,
  ConfirmationHandler,
  resolvePolicy,
  createStructuredLogger,
  exportToOTLP,
} from "@aex-lang/runtime";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import irSchema from "../../../schemas/aex-ir.schema.json" with { type: "json" };
import policySchema from "../../../schemas/policy.schema.json" with { type: "json" };
import { formatFile } from "./formatter.js";
import {
  createSignature,
  verifySignature,
  SignatureMetadata,
} from "./signing.js";
import { resolveModelHandler } from "./models/index.js";

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0" &&
  (process.stdout.isTTY ?? false);

const c = {
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const program = new Command();

program
  .name("aex")
  .description("Executable contracts for AI agents")
  .version("0.0.1");

program
  .command("init")
  .option("--task <name>", "Task name", "sample-task")
  .description("Scaffold a starter AEX contract with inputs and policy files")
  .action(async (options: { task?: string }) => {
    const taskName = (options.task ?? "sample-task").replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
    const tasksDir = resolveInput("tasks");
    await fs.mkdir(tasksDir, { recursive: true });

    const taskPath = path.join(tasksDir, `${taskName}.aex`);
    const inputsPath = path.join(tasksDir, `${taskName}.inputs.json`);
    const policyPath = path.join(tasksDir, `${taskName}.policy.json`);

    await writeIfMissing(taskPath, SAMPLE_CONTRACT.replace(/sample_task/g, taskName));
    await writeIfMissing(inputsPath, `${JSON.stringify(SAMPLE_INPUTS, null, 2)}\n`);
    await writeIfMissing(policyPath, `${JSON.stringify(SAMPLE_POLICY, null, 2)}\n`);

    process.stdout.write(
      `${c.green("✔")} Starter files created under ${tasksDir}\n`,
    );
  });

program
  .command("parse")
  .argument("<file>", "AEX file to parse")
  .option("--tolerant", "Return diagnostics instead of throwing on parse errors")
  .description("Parse an AEX contract and emit the intermediate representation")
  .action(async (file: string, options: { tolerant?: boolean }) => {
    try {
      const result = await parseFile(resolveInput(file), {
        tolerant: Boolean(options.tolerant),
      });
      printDiagnostics(result.diagnostics);
      process.stdout.write(
        `${JSON.stringify(result.task, null, 2)}\n`,
      );
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("check")
  .argument("<file>", "AEX file to validate")
  .description("Validate an AEX contract for semantic correctness")
  .action(async (file: string) => {
    try {
      const source = await fs.readFile(resolveInput(file), "utf8");
      const result = validateText(source);
      reportIssues(result.issues);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("compile")
  .argument("<file>", "AEX file to compile into JSON IR")
  .description("Compile an AEX contract into its JSON intermediate representation")
  .action(async (file: string) => {
    try {
      const result = await parseFile(resolveInput(file), { tolerant: true });
      printDiagnostics(result.diagnostics);
      const ir = compileTask(result.task);
      const issues = validateIR(ir);
      if (issues.length > 0) {
        for (const issue of issues) {
          process.stderr.write(`${c.red("error")} ${issue}\n`);
        }
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${JSON.stringify(ir, null, 2)}\n`);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("fmt")
  .argument("<files...>", "AEX files to format")
  .option("--check", "Check whether files are already formatted without writing")
  .description("Format AEX contracts")
  .action(async (files: string[], options: { check?: boolean }) => {
    let failed = false;
    let changed = false;

    for (const file of files) {
      const resolved = resolveInput(file);
      let result;
      try {
        result = await formatFile(resolved);
      } catch (error) {
        handleError(error);
        failed = true;
        continue;
      }

      const { errors, warnings } = partitionIssues(result.issues);
      for (const warning of warnings) {
        process.stderr.write(
          `${c.yellow("warn")} ${formatIssue(warning)}\n`,
        );
      }
      if (errors.length > 0) {
        for (const issue of errors) {
          process.stderr.write(
            `${c.red("error")} ${formatIssue(issue)}\n`,
          );
        }
        failed = true;
        continue;
      }

      if (options.check) {
        if (result.formatted !== result.original) {
          process.stderr.write(
            `${c.red("diff")} ${resolved} is not formatted\n`,
          );
          failed = true;
        }
        continue;
      }

      if (result.formatted !== result.original) {
        await fs.writeFile(resolved, result.formatted, "utf8");
        process.stdout.write(
          `${c.green("formatted")} ${resolved}\n`,
        );
        changed = true;
      }
    }

    if (options.check && !failed) {
      process.stdout.write(`${c.green("✔")} All files are formatted\n`);
    }

    if (failed) {
      process.exitCode = 1;
    } else if (changed && !options.check) {
      process.stdout.write(`${c.green("✔")} Formatting applied\n`);
    }
  });

program
  .command("sign")
  .argument("<file>", "AEX file to sign")
  .requiredOption("--id <signer>", "Signer identifier")
  .option("--key <secret>", "Signing secret (use cautiously)")
  .option("--key-file <path>", "Path to signing secret file")
  .option(
    "--output <file>",
    "Destination for signature metadata (defaults to <file>.signature.json)",
  )
  .description("Create provenance metadata for an AEX contract")
  .action(
    async (
      file: string,
      options: { id: string; key?: string; keyFile?: string; output?: string },
    ) => {
      try {
        const secret = await resolveKey(options);
        if (!secret) {
          throw new Error("Provide --key or --key-file for signing.");
        }
        const resolved = resolveInput(file);
        const metadata = await createSignature(resolved, options.id, secret);
        const outputPath = resolveInput(
          options.output ?? `${resolved}.signature.json`,
        );
        await fs.writeFile(
          outputPath,
          `${JSON.stringify(metadata, null, 2)}\n`,
          "utf8",
        );
        process.stdout.write(
          `${c.green("signed")} ${resolved} -> ${outputPath}\n`,
        );
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("verify")
  .argument("<file>", "AEX file to verify")
  .requiredOption("--signature <file>", "Signature metadata JSON file")
  .option("--id <signer>", "Expected signer identifier")
  .option("--key <secret>", "Verification secret")
  .option("--key-file <path>", "Path to verification secret file")
  .description("Verify a signed AEX contract against provenance metadata")
  .action(
    async (
      file: string,
      options: {
        signature: string;
        id?: string;
        key?: string;
        keyFile?: string;
      },
    ) => {
      try {
        const secret = await resolveKey(options);
        if (!secret) {
          throw new Error("Provide --key or --key-file for verification.");
        }
        const resolved = resolveInput(file);
        const signaturePath = resolveInput(options.signature);
        const payload = JSON.parse(
          await fs.readFile(signaturePath, "utf8"),
        ) as SignatureMetadata;
        if (options.id && payload.signer !== options.id) {
          throw new Error(
            `Signature signer mismatch: expected ${options.id}, found ${payload.signer}`,
          );
        }
        const valid = await verifySignature(resolved, payload, secret);
        if (valid) {
          process.stdout.write(
            `${c.green("✔")} Signature verified for ${resolved}\n`,
          );
        } else {
          process.stderr.write(
            `${c.red("invalid")} Signature verification failed\n`,
          );
          process.exitCode = 1;
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("run")
  .argument("<file>", "AEX file to execute")
  .option("--policy <policy>", "Path to a runtime policy JSON file")
  .option("--inputs <inputs>", "Path to an inputs JSON file")
  .option(
    "--auto-confirm",
    "Automatically approve confirmation gates (use with caution)",
  )
  .option("--model <provider>", "Model provider for make steps (openai, anthropic)")
  .option("--model-handler <path>", "Path to a custom model handler module")
  .option("--registry <url>", "URL of a remote tool registry")
  .option("--otlp-endpoint <url>", "OpenTelemetry collector endpoint for trace export")
  .option("--log-json", "Output structured log events as JSON")
  .description("Execute an AEX contract using the local runtime (experimental)")
  .action(
    async (
      file: string,
      options: {
        policy?: string;
        inputs?: string;
        autoConfirm?: boolean;
        model?: string;
        modelHandler?: string;
        registry?: string;
        otlpEndpoint?: string;
        logJson?: boolean;
      },
    ) => {
      try {
        const inputs = options.inputs
          ? await loadInputs(resolveInput(options.inputs))
          : undefined;
        let policy = options.policy
          ? await loadPolicy(resolveInput(options.policy))
          : undefined;
        if (policy) {
          policy = await resolvePolicy(policy);
        }
        const confirmHandler = options.autoConfirm
          ? alwaysApproveConfirmation
          : createPromptConfirmHandler();
        const modelHandler = await resolveModelHandler(
          options.model,
          options.modelHandler,
        );
        const registry = options.registry
          ? { url: options.registry }
          : undefined;
        const structuredLog = createStructuredLogger();
        const logFn = options.logJson
          ? (event: { event: string; data?: Record<string, unknown> }) =>
              structuredLog.log(event)
          : logEvent;
        const result = await runTask(resolveInput(file), {
          policy,
          inputs,
          model: modelHandler,
          confirm: confirmHandler,
          logger: logFn,
          registry,
        });
        if (options.logJson) {
          process.stdout.write(structuredLog.toJSON() + "\n");
        }
        if (options.otlpEndpoint) {
          await exportToOTLP(structuredLog.toOTLP(), options.otlpEndpoint);
          process.stdout.write(
            `${c.green("✔")} Traces exported to ${options.otlpEndpoint}\n`,
          );
        }
        if (result.status === "blocked") {
          process.stderr.write(
            `${c.yellow("runtime blocked")}: ${result.issues.join(
              ", ",
            )}\n`,
          );
          process.exitCode = 1;
        } else {
          process.stdout.write(`${c.green("runtime success")}\n`);
          if (result.output !== undefined) {
            process.stdout.write(
              `${JSON.stringify(result.output, null, 2)}\n`,
            );
          }
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

void program.parseAsync(process.argv);

function resolveInput(inputPath: string): string {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

function printDiagnostics(diagnostics: ParseError[]) {
  for (const diagnostic of diagnostics) {
    process.stderr.write(
      `${c.yellow("diag")} line ${diagnostic.line || "-"} ${
        diagnostic.message
      }\n`,
    );
  }
}

function partitionIssues(issues: ValidationIssue[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { errors, warnings };
}

function reportIssues(issues: ValidationIssue[]) {
  if (issues.length === 0) {
    process.stdout.write(`${c.green("✔")} Contract is valid\n`);
    return;
  }
  const { errors, warnings } = partitionIssues(issues);
  for (const issue of errors) {
    process.stderr.write(
      `${c.red("error")} ${formatIssue(issue)}\n`,
    );
  }
  for (const issue of warnings) {
    process.stderr.write(
      `${c.yellow("warn")} ${formatIssue(issue)}\n`,
    );
  }
  process.exitCode = errors.length > 0 ? 1 : 0;
}

function formatIssue(issue: ValidationIssue): string {
  const parts = [];
  if (issue.code) parts.push(issue.code);
  if (issue.line) parts.push(`line ${issue.line}`);
  parts.push(issue.message);
  return parts.join(" · ");
}

function validateIR(data: unknown): string[] {
  const issues: string[] = [];
  if (!data || typeof data !== "object") {
    issues.push("IR must be an object.");
    return issues;
  }
  const ir = data as Record<string, unknown>;
  const schema = irSchema as Record<string, unknown>;
  const required = (schema.required ?? []) as string[];
  for (const field of required) {
    if (!(field in ir)) {
      issues.push(`IR is missing required field "${field}".`);
    }
  }
  if (!Array.isArray(ir.steps)) {
    issues.push('IR "steps" must be an array.');
  }
  if (ir.permissions && typeof ir.permissions === "object") {
    const perms = ir.permissions as Record<string, unknown>;
    if (!Array.isArray(perms.use)) issues.push('"permissions.use" must be an array.');
    if (!Array.isArray(perms.deny)) issues.push('"permissions.deny" must be an array.');
  }
  return issues;
}

function validatePolicyData(data: unknown): string[] {
  const issues: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    issues.push("Policy must be an object.");
    return issues;
  }
  const policy = data as Record<string, unknown>;
  const _schema = policySchema;
  const allowedKeys = new Set(["allow", "deny", "require_confirmation", "budget", "extends"]);
  for (const key of Object.keys(policy)) {
    if (!allowedKeys.has(key)) {
      issues.push(`Unknown policy field "${key}".`);
    }
  }
  for (const arrayField of ["allow", "deny", "require_confirmation"]) {
    if (arrayField in policy && !Array.isArray(policy[arrayField])) {
      issues.push(`"${arrayField}" must be an array.`);
    }
  }
  if ("budget" in policy) {
    if (!policy.budget || typeof policy.budget !== "object" || Array.isArray(policy.budget)) {
      issues.push('"budget" must be an object.');
    } else {
      const budget = policy.budget as Record<string, unknown>;
      for (const [key, value] of Object.entries(budget)) {
        if (typeof value !== "number" || value < 0) {
          issues.push(`Budget "${key}" must be a non-negative number.`);
        }
      }
    }
  }
  return issues;
}

async function loadPolicy(filePath: string): Promise<RuntimePolicy> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const issues = validatePolicyData(parsed);
  if (issues.length > 0) {
    for (const issue of issues) {
      process.stderr.write(`${c.red("error")} ${issue}\n`);
    }
    throw new Error("Policy file failed validation.");
  }
  return parsed as RuntimePolicy;
}

async function loadInputs(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Inputs JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

async function resolveKey(options: {
  key?: string;
  keyFile?: string;
}): Promise<string | undefined> {
  if (options.key && options.keyFile) {
    throw new Error("Provide either --key or --key-file, not both.");
  }
  if (options.keyFile) {
    const resolved = resolveInput(options.keyFile);
    return (await fs.readFile(resolved, "utf8")).trim();
  }
  return options.key;
}

const alwaysApproveConfirmation: ConfirmationHandler = async () => true;

function createPromptConfirmHandler(): ConfirmationHandler | undefined {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }
  return async (toolName) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await rl.question(
        `${c.yellow("confirm")} Allow tool "${toolName}"? [y/N]: `,
      );
      return answer.trim().toLowerCase().startsWith("y");
    } finally {
      rl.close();
    }
  };
}

function logEvent(event: { event: string; data?: Record<string, unknown> }) {
  const payload = event.data ? JSON.stringify(event.data) : "";
  process.stdout.write(
    `${c.cyan(event.event.padEnd(16))} ${payload}\n`,
  );
}

function handleError(error: unknown) {
  if (error instanceof Error) {
    process.stderr.write(`${c.red("error")} ${error.message}\n`);
  } else {
    process.stderr.write(`${c.red("error")} ${String(error)}\n`);
  }
  process.exitCode = 1;
}

async function writeIfMissing(filePath: string, contents: string) {
  try {
    await fs.access(filePath);
    process.stderr.write(
      `${c.yellow("skip")} ${path.relative(process.cwd(), filePath)} already exists\n`,
    );
  } catch {
    await fs.writeFile(filePath, contents, "utf8");
  }
}

const SAMPLE_CONTRACT = `agent sample_task v0

goal "Describe what this task should accomplish."

use model.make
deny secrets.read, network.*

need topic: str

make draft: markdown from topic with:
  - summarize the key points
  - keep it concise

return draft
`;

const SAMPLE_INPUTS = {
  topic: "Replace this with your task topic"
};

const SAMPLE_POLICY = {
  allow: ["model.make"],
  deny: ["secrets.read", "network.*"],
  require_confirmation: [],
  budget: {
    calls: 20
  }
};
