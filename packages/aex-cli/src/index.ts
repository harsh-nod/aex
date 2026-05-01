#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { compileTask, parseFile, ParseError } from "@aex/parser";
import { ValidationIssue, validateText } from "@aex/validator";
import { runTask, RuntimePolicy } from "@aex/runtime";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const program = new Command();

program
  .name("aex")
  .description("Executable contracts for AI agents")
  .version("0.0.1");

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
        `${JSON.stringify(result.task, null, 2)}${EOL_WITH_NEWLINE}`,
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
      process.stdout.write(`${JSON.stringify(ir, null, 2)}${EOL_WITH_NEWLINE}`);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("run")
  .argument("<file>", "AEX file to execute")
  .option("--policy <policy>", "Path to a runtime policy JSON file")
  .option("--inputs <inputs>", "Path to an inputs JSON file")
  .option(
    "--auto-confirm",
    "Automatically approve confirmation gates (use with caution)",
  )
  .description("Execute an AEX contract using the local runtime (experimental)")
  .action(
    async (
      file: string,
      options: {
        policy?: string;
        inputs?: string;
        autoConfirm?: boolean;
      },
    ) => {
      try {
        const inputs = options.inputs
          ? await loadInputs(resolveInput(options.inputs))
          : undefined;
        const result = await runTask(resolveInput(file), {
          policy: options.policy
            ? await loadPolicy(resolveInput(options.policy))
            : undefined,
          inputs,
          confirm: options.autoConfirm ? autoConfirmHandler : undefined,
          logger: logEvent,
        });
        if (result.status === "blocked") {
          process.stderr.write(
            `${chalk.yellow("runtime blocked")}: ${result.issues.join(
              ", ",
            )}${EOL_WITH_NEWLINE}`,
          );
          process.exitCode = 1;
        } else {
          process.stdout.write(`${chalk.green("runtime success")}\n`);
          if (result.output !== undefined) {
            process.stdout.write(
              `${JSON.stringify(result.output, null, 2)}${EOL_WITH_NEWLINE}`,
            );
          }
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

void program.parseAsync(process.argv);

const EOL_WITH_NEWLINE = "\n";

function resolveInput(inputPath: string): string {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

function printDiagnostics(diagnostics: ParseError[]) {
  for (const diagnostic of diagnostics) {
    process.stderr.write(
      `${chalk.yellow("diag")} line ${diagnostic.line || "-"} ${
        diagnostic.message
      }${EOL_WITH_NEWLINE}`,
    );
  }
}

function reportIssues(issues: ValidationIssue[]) {
  if (issues.length === 0) {
    process.stdout.write(`${chalk.green("✔")} Contract is valid\n`);
    return;
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  for (const issue of errors) {
    process.stderr.write(
      `${chalk.red("error")} ${formatIssue(issue)}${EOL_WITH_NEWLINE}`,
    );
  }
  for (const issue of warnings) {
    process.stderr.write(
      `${chalk.yellow("warn")} ${formatIssue(issue)}${EOL_WITH_NEWLINE}`,
    );
  }
  process.exitCode = errors.length > 0 ? 1 : 0;
}

function formatIssue(issue: ValidationIssue): string {
  return issue.line ? `(line ${issue.line}) ${issue.message}` : issue.message;
}

async function loadPolicy(filePath: string): Promise<RuntimePolicy> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as RuntimePolicy;
}

async function loadInputs(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Inputs JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

const autoConfirmHandler = async () => true;

function logEvent(event: { event: string; data?: Record<string, unknown> }) {
  const payload = event.data ? JSON.stringify(event.data) : "";
  process.stdout.write(
    `${chalk.cyan(event.event.padEnd(16))} ${payload}${EOL_WITH_NEWLINE}`,
  );
}

function handleError(error: unknown) {
  if (error instanceof Error) {
    process.stderr.write(`${chalk.red("error")} ${error.message}\n`);
  } else {
    process.stderr.write(`${chalk.red("error")} ${String(error)}\n`);
  }
  process.exitCode = 1;
}
