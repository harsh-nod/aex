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
  mergePolicyAndTask,
  extractPolicyLayer,
  discoverPolicy,
  EffectivePermissions,
  evaluateGate,
  readBudgetState,
  writeBudgetState,
  resolvebudgetState,
  GateInput,
} from "@aex-lang/runtime";
import { AEXProxy } from "@aex-lang/mcp-gateway";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
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
import { draftContract } from "./draft.js";
import {
  buildReviewSummary,
  formatReviewText,
  executeAfterApproval,
} from "./review.js";

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
  .option("--policy", "Scaffold a .aex/policy.aex ambient policy file")
  .description("Scaffold a starter AEX contract with inputs and policy files")
  .action(async (options: { task?: string; policy?: boolean }) => {
    if (options.policy) {
      const aexDir = resolveInput(".aex");
      await fs.mkdir(aexDir, { recursive: true });
      const policyPath = path.join(aexDir, "policy.aex");
      await writeIfMissing(policyPath, SAMPLE_POLICY_AEX);
      process.stdout.write(
        `${c.green("✔")} Policy created at ${path.relative(process.cwd(), policyPath)}\n`,
      );
      return;
    }

    const taskName = (options.task ?? "sample-task").replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
    const tasksDir = resolveInput("tasks");
    await fs.mkdir(tasksDir, { recursive: true });

    const taskPath = path.join(tasksDir, `${taskName}.aex`);
    const inputsPath = path.join(tasksDir, `${taskName}.inputs.json`);
    const policyPath = path.join(tasksDir, `${taskName}.policy.json`);

    await writeIfMissing(
      taskPath,
      SAMPLE_CONTRACT.replace(/sample_task/g, taskName),
    );
    await writeIfMissing(
      inputsPath,
      `${JSON.stringify(SAMPLE_INPUTS, null, 2)}\n`,
    );
    await writeIfMissing(
      policyPath,
      `${JSON.stringify(SAMPLE_POLICY, null, 2)}\n`,
    );

    process.stdout.write(
      `${c.green("✔")} Starter files created under ${tasksDir}\n`,
    );
  });

program
  .command("parse")
  .argument("<file>", "AEX file to parse")
  .option(
    "--tolerant",
    "Return diagnostics instead of throwing on parse errors",
  )
  .description("Parse an AEX contract and emit the intermediate representation")
  .action(async (file: string, options: { tolerant?: boolean }) => {
    try {
      const result = await parseFile(resolveInput(file), {
        tolerant: Boolean(options.tolerant),
      });
      printDiagnostics(result.diagnostics);
      process.stdout.write(`${JSON.stringify(result.task, null, 2)}\n`);
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
  .description(
    "Compile an AEX contract into its JSON intermediate representation",
  )
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
  .option(
    "--check",
    "Check whether files are already formatted without writing",
  )
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
        process.stderr.write(`${c.yellow("warn")} ${formatIssue(warning)}\n`);
      }
      if (errors.length > 0) {
        for (const issue of errors) {
          process.stderr.write(`${c.red("error")} ${formatIssue(issue)}\n`);
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
        process.stdout.write(`${c.green("formatted")} ${resolved}\n`);
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
  .command("effective")
  .option("--contract <file>", "Path to a task contract .aex file")
  .option(
    "--policy <file>",
    "Path to a policy .aex file (auto-discovers if omitted)",
  )
  .description(
    "Show effective permissions after merging policy and task contract",
  )
  .action(async (options: { contract?: string; policy?: string }) => {
    try {
      const policyPath = options.policy
        ? resolveInput(options.policy)
        : await discoverPolicy();

      if (!policyPath) {
        process.stderr.write(
          `${c.yellow("warn")} No policy found. Looked for .aex/policy.aex and aex.policy.aex\n`,
        );
        if (!options.contract) {
          process.exitCode = 1;
          return;
        }
      }

      let policyLayer;
      if (policyPath) {
        const policyParsed = await parseFile(policyPath, { tolerant: true });
        if (policyParsed.diagnostics.length > 0) {
          printDiagnostics(policyParsed.diagnostics);
        }
        policyLayer = extractPolicyLayer(policyParsed.task);
      }

      let taskLayer;
      let contractPath: string | undefined;
      if (options.contract) {
        contractPath = resolveInput(options.contract);
        const taskParsed = await parseFile(contractPath, { tolerant: true });
        if (taskParsed.diagnostics.length > 0) {
          printDiagnostics(taskParsed.diagnostics);
        }
        taskLayer = extractPolicyLayer(taskParsed.task);
      }

      if (!policyLayer && !taskLayer) {
        process.stderr.write(
          `${c.red("error")} No policy or contract to analyze.\n`,
        );
        process.exitCode = 1;
        return;
      }

      const effective = policyLayer
        ? mergePolicyAndTask(policyLayer, taskLayer)
        : mergePolicyAndTask(taskLayer!);

      // Print header
      if (policyPath) {
        process.stdout.write(
          `${c.cyan("Policy:")}   ${path.relative(process.cwd(), policyPath)}\n`,
        );
      }
      if (contractPath) {
        process.stdout.write(
          `${c.cyan("Contract:")} ${path.relative(process.cwd(), contractPath)}\n`,
        );
      }
      process.stdout.write("\n");

      // Print effective permissions
      if (effective.allow.length > 0) {
        process.stdout.write(`${c.green("Allowed:")}\n`);
        for (const tool of effective.allow) {
          process.stdout.write(`  ${tool}\n`);
        }
        process.stdout.write("\n");
      }

      if (effective.deny.length > 0) {
        process.stdout.write(`${c.red("Denied:")}\n`);
        for (const tool of effective.deny) {
          process.stdout.write(`  ${tool}\n`);
        }
        process.stdout.write("\n");
      }

      if (effective.confirm.length > 0) {
        process.stdout.write(`${c.yellow("Confirmation required:")}\n`);
        for (const tool of effective.confirm) {
          process.stdout.write(`  ${tool}\n`);
        }
        process.stdout.write("\n");
      }

      if (effective.budget !== undefined) {
        process.stdout.write(`${c.cyan("Budget:")}\n`);
        process.stdout.write(`  calls=${effective.budget}\n`);
        process.stdout.write("\n");
      }
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("run")
  .argument("<file>", "AEX file to execute")
  .option(
    "--policy <policy>",
    "Path to a runtime policy JSON or .aex file (auto-discovers .aex/policy.aex if omitted)",
  )
  .option("--inputs <inputs>", "Path to an inputs JSON file")
  .option(
    "--auto-confirm",
    "Automatically approve confirmation gates (use with caution)",
  )
  .option(
    "--model <provider>",
    "Model provider for make steps (openai, anthropic)",
  )
  .option("--model-handler <path>", "Path to a custom model handler module")
  .option("--registry <url>", "URL of a remote tool registry")
  .option(
    "--otlp-endpoint <url>",
    "OpenTelemetry collector endpoint for trace export",
  )
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
        const resolvedFile = resolveInput(file);
        const inputs = options.inputs
          ? await loadInputs(resolveInput(options.inputs))
          : undefined;

        // Policy resolution: explicit flag, auto-discover .aex, or none
        let policy: RuntimePolicy | undefined;
        if (options.policy) {
          const policyFile = resolveInput(options.policy);
          if (policyFile.endsWith(".aex")) {
            policy = await loadAEXPolicy(policyFile);
          } else {
            policy = await loadPolicy(policyFile);
          }
        } else {
          // Auto-discover .aex/policy.aex
          const discovered = await discoverPolicy();
          if (discovered) {
            policy = await loadAEXPolicy(discovered);
          }
        }
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
        const auditEvents: Array<{
          event: string;
          data?: Record<string, unknown>;
        }> = [];
        const logFn = options.logJson
          ? (event: { event: string; data?: Record<string, unknown> }) => {
              structuredLog.log(event);
              auditEvents.push(event);
            }
          : (event: { event: string; data?: Record<string, unknown> }) => {
              logEvent(event);
              auditEvents.push(event);
            };
        const result = await runTask(resolvedFile, {
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

        // Write audit log for .aex/runs/ tasks
        if (resolvedFile.includes(path.join(".aex", "runs"))) {
          const auditPath = resolvedFile.replace(/\.aex$/, ".audit.jsonl");
          const auditContent =
            auditEvents
              .map((e) =>
                JSON.stringify({ ...e, timestamp: new Date().toISOString() }),
              )
              .join("\n") + "\n";
          await fs.writeFile(auditPath, auditContent, "utf8");
          process.stdout.write(
            `${c.cyan("audit")} Log written to ${path.relative(process.cwd(), auditPath)}\n`,
          );
        }

        if (result.status === "blocked") {
          process.stderr.write(
            `${c.yellow("runtime blocked")}: ${result.issues.join(", ")}\n`,
          );
          process.exitCode = 1;
        } else {
          process.stdout.write(`${c.green("runtime success")}\n`);
          if (result.output !== undefined) {
            process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
          }
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("proxy")
  .option(
    "--upstream <cmd>",
    "Command to spawn as the upstream MCP server (deprecated, use -- instead)",
  )
  .option("--contract <file>", "Path to a task contract .aex file")
  .option(
    "--policy <file>",
    "Path to a policy .aex file (auto-discovers if omitted)",
  )
  .option("--auto-confirm", "Automatically approve confirmation gates")
  .allowUnknownOption(true)
  .description(
    "Start an MCP stdio proxy that enforces AEX policy on every tool call",
  )
  .action(
    async (
      options: {
        upstream?: string;
        contract?: string;
        policy?: string;
        autoConfirm?: boolean;
      },
      cmd: Command,
    ) => {
      try {
        // Support both: `aex proxy -- npx server --flag` and legacy `aex proxy --upstream "cmd"`
        const rawArgs = cmd.args;
        let upstreamParts: string[];

        if (rawArgs.length > 0) {
          // Everything after -- is the upstream command
          upstreamParts = rawArgs;
        } else if (options.upstream) {
          // Legacy --upstream "cmd string"
          upstreamParts = options.upstream.split(/\s+/).filter(Boolean);
        } else {
          process.stderr.write(
            `${c.red("error")} No upstream command. Use: aex proxy -- <command>\n`,
          );
          process.exitCode = 1;
          return;
        }

        const policyPath = options.policy
          ? resolveInput(options.policy)
          : await discoverPolicy();

        if (!policyPath) {
          process.stderr.write(
            `${c.red("error")} No policy found. Use --policy or create .aex/policy.aex\n`,
          );
          process.exitCode = 1;
          return;
        }

        const policyParsed = await parseFile(policyPath, { tolerant: true });
        const policyLayer = extractPolicyLayer(policyParsed.task);

        let taskLayer;
        if (options.contract) {
          const taskParsed = await parseFile(resolveInput(options.contract), {
            tolerant: true,
          });
          taskLayer = extractPolicyLayer(taskParsed.task);
        }

        const effective = mergePolicyAndTask(policyLayer, taskLayer);

        // Log effective permissions to stderr
        process.stderr.write(
          `${c.cyan("proxy")} Policy: ${path.relative(process.cwd(), policyPath)}\n`,
        );
        if (options.contract) {
          process.stderr.write(
            `${c.cyan("proxy")} Contract: ${options.contract}\n`,
          );
        }
        process.stderr.write(
          `${c.cyan("proxy")} Allow: ${effective.allow.join(", ") || "(none)"}\n`,
        );
        process.stderr.write(
          `${c.cyan("proxy")} Deny: ${effective.deny.join(", ") || "(none)"}\n`,
        );
        if (effective.budget !== undefined) {
          process.stderr.write(
            `${c.cyan("proxy")} Budget: ${effective.budget} calls\n`,
          );
        }

        // Spawn upstream
        const child = spawn(upstreamParts[0], upstreamParts.slice(1), {
          stdio: ["pipe", "pipe", "inherit"],
        });

        const logger = (event: {
          event: string;
          data?: Record<string, unknown>;
        }) => {
          process.stderr.write(
            JSON.stringify({ ...event, timestamp: new Date().toISOString() }) +
              "\n",
          );
        };

        const proxy = new AEXProxy({
          permissions: effective,
          autoConfirm: options.autoConfirm,
          logger,
          cwd: process.cwd(),
        });

        process.stderr.write(
          `${c.green("proxy")} Started. Proxying stdin/stdout to upstream.\n`,
        );

        await proxy.start(process.stdin, process.stdout, child);

        process.stderr.write(
          `${c.yellow("proxy")} Upstream exited. ${proxy.callCount} calls made.\n`,
        );
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("gate")
  .option("--contract <file>", "Path to a task contract .aex file")
  .option(
    "--policy <file>",
    "Path to a policy .aex file (auto-discovers if omitted)",
  )
  .option(
    "--allow-no-policy",
    "Allow all tool calls when no policy is found (default: deny)",
  )
  .description(
    "Claude Code PreToolUse hook: evaluate tool calls against AEX policy",
  )
  .action(
    async (options: {
      contract?: string;
      policy?: string;
      allowNoPolicy?: boolean;
    }) => {
      try {
        // Read stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString("utf8").trim();

        let input: GateInput;
        try {
          input = JSON.parse(raw) as GateInput;
        } catch {
          process.stderr.write("aex gate: invalid JSON on stdin\n");
          process.exitCode = 2;
          return;
        }

        if (!input.tool_name) {
          process.stderr.write("aex gate: missing tool_name in input\n");
          process.exitCode = 2;
          return;
        }

        // Discover policy
        const policyPath = options.policy
          ? resolveInput(options.policy)
          : await discoverPolicy(input.cwd || undefined);

        if (!policyPath) {
          if (options.allowNoPolicy) {
            // Explicitly opted into fail-open
            process.stdout.write(
              JSON.stringify({ permissionDecision: "allow" }) + "\n",
            );
          } else {
            // Fail closed — no policy means deny
            process.stdout.write(
              JSON.stringify({
                permissionDecision: "deny",
                reason:
                  "No AEX policy found. Create one with `aex init --policy` or pass --allow-no-policy to allow all.",
              }) + "\n",
            );
          }
          return;
        }

        // Parse policy and extract layer
        const policyParsed = await parseFile(policyPath, { tolerant: true });
        const policyLayer = extractPolicyLayer(policyParsed.task);

        // Optionally merge with contract
        let taskLayer;
        if (options.contract) {
          const taskParsed = await parseFile(resolveInput(options.contract), {
            tolerant: true,
          });
          taskLayer = extractPolicyLayer(taskParsed.task);
        }

        const effective = mergePolicyAndTask(policyLayer, taskLayer);

        // Budget tracking
        let budgetState;
        if (effective.budget !== undefined && input.session_id) {
          const dir = input.cwd || process.cwd();
          const existing = await readBudgetState(dir);
          budgetState = resolvebudgetState(existing, input.session_id);
        }

        // Evaluate
        const result = evaluateGate(input, effective, budgetState);

        // Persist budget state
        if (result.budgetState && input.cwd) {
          await writeBudgetState(input.cwd, result.budgetState);
        }

        process.stdout.write(JSON.stringify(result.output) + "\n");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`aex gate: ${msg}\n`);
        process.exitCode = 2;
      }
    },
  );

program
  .command("draft")
  .argument("<prompt>", "Natural language description of the task")
  .option(
    "--model <provider>",
    "Model provider (openai, anthropic, or provider:model)",
  )
  .option(
    "--out <file>",
    "Output file path (defaults to .aex/runs/<timestamp>-<name>.aex)",
  )
  .option("--name <name>", "Task name in snake_case")
  .option(
    "--policy <file>",
    "Policy file to constrain against (auto-discovers if omitted)",
  )
  .option("--from-plan <file>", "Read plan text from file instead of prompt")
  .option("--max-retries <n>", "Max retries on validation failure", "1")
  .description(
    "Generate a draft AEX task contract from a natural language prompt",
  )
  .action(
    async (
      prompt: string,
      options: {
        model?: string;
        out?: string;
        name?: string;
        policy?: string;
        fromPlan?: string;
        maxRetries?: string;
      },
    ) => {
      try {
        const result = await draftContract({
          prompt,
          model: options.model,
          out: options.out,
          name: options.name,
          policyPath: options.policy,
          fromPlan: options.fromPlan,
          maxRetries: options.maxRetries ? parseInt(options.maxRetries, 10) : 1,
        });

        const relPath = path.relative(process.cwd(), result.outputPath);

        if (result.valid) {
          process.stdout.write(`${c.green("✔")} Draft saved to ${relPath}\n`);
        } else {
          process.stdout.write(
            `${c.yellow("⚠")} Draft saved to ${relPath} (has validation issues)\n`,
          );
          for (const d of result.diagnostics) {
            process.stderr.write(`${c.red("error")} ${d}\n`);
          }
          process.exitCode = 1;
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("review")
  .argument("<file>", "AEX task file to review")
  .option("--json", "Output machine-readable JSON summary")
  .option("--run", "Prompt for approval then execute the task")
  .option("--yes", "Skip approval prompt (with --run)")
  .option("--policy <file>", "Policy file (auto-discovers if omitted)")
  .option("--model <provider>", "Model provider for make steps (with --run)")
  .option("--model-handler <path>", "Custom model handler (with --run)")
  .option("--inputs <file>", "Inputs JSON file (with --run)")
  .option("--auto-confirm", "Auto-approve confirmation gates during execution")
  .description("Review an AEX task contract and optionally execute it")
  .action(
    async (
      file: string,
      options: {
        json?: boolean;
        run?: boolean;
        yes?: boolean;
        policy?: string;
        model?: string;
        modelHandler?: string;
        inputs?: string;
        autoConfirm?: boolean;
      },
    ) => {
      try {
        const resolved = resolveInput(file);
        const summary = await buildReviewSummary(resolved, options.policy);

        if (options.json) {
          process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
        } else {
          process.stdout.write(formatReviewText(summary, useColor) + "\n");
        }

        if (options.run) {
          if (!summary.valid) {
            process.stderr.write(
              `${c.red("error")} Cannot run: task has validation errors.\n`,
            );
            process.exitCode = 1;
            return;
          }

          if (!summary.runsUnderPolicy) {
            process.stderr.write(
              `${c.red("error")} Cannot run: task exceeds current policy.\n`,
            );
            process.exitCode = 1;
            return;
          }

          // Prompt for approval unless --yes
          if (!options.yes) {
            if (process.stdin.isTTY && process.stdout.isTTY) {
              const rl = createInterface({
                input: process.stdin,
                output: process.stdout,
              });
              try {
                const answer = await rl.question(
                  `\n${c.yellow("Approve and run?")} [y/N]: `,
                );
                if (!answer.trim().toLowerCase().startsWith("y")) {
                  process.stdout.write("Cancelled.\n");
                  return;
                }
              } finally {
                rl.close();
              }
            } else {
              process.stderr.write(
                `${c.red("error")} Non-interactive terminal. Use --yes to skip approval.\n`,
              );
              process.exitCode = 1;
              return;
            }
          }

          process.stdout.write(`\n${c.cyan("Executing...")} ${file}\n`);
          const result = await executeAfterApproval(resolved, options);

          if (result.status === "blocked") {
            process.stderr.write(`${c.yellow("runtime blocked")}\n`);
            process.exitCode = 1;
          } else {
            process.stdout.write(`${c.green("runtime success")}\n`);
            if (result.output !== undefined) {
              process.stdout.write(
                JSON.stringify(result.output, null, 2) + "\n",
              );
            }
          }
        }
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("classify")
  .argument("<prompt>", "Natural language prompt to classify")
  .description(
    "Classify a prompt as exploratory, contract_recommended, or contract_required",
  )
  .action((prompt: string) => {
    const lower = prompt.toLowerCase();

    const exploratoryWords = [
      "explain",
      "summarize",
      "find",
      "inspect",
      "understand",
      "search",
      "describe",
      "what",
      "where",
      "how",
      "why",
      "show",
      "list",
      "read",
      "look",
      "check",
      "tell",
      "help",
    ];
    const contractRequiredWords = [
      "deploy",
      "production",
      "payment",
      "send",
      "email",
      "admin",
      "secrets",
      "migration",
      "publish",
      "release",
    ];
    const contractRecommendedWords = [
      "fix",
      "update",
      "modify",
      "edit",
      "write",
      "delete",
      "create",
      "add",
      "remove",
      "refactor",
      "change",
      "rename",
      "move",
      "install",
      "upgrade",
      "patch",
      "migrate",
    ];

    let mode = "contract_recommended";
    let reason = "default classification for ambiguous prompts";

    const words = lower.split(/\s+/);

    if (contractRequiredWords.some((w) => words.includes(w))) {
      mode = "contract_required";
      reason = "prompt implies high-risk side effects";
    } else if (contractRecommendedWords.some((w) => words.includes(w))) {
      mode = "contract_recommended";
      reason = "prompt implies file modifications or code changes";
    } else if (exploratoryWords.some((w) => words.includes(w))) {
      mode = "exploratory";
      reason = "prompt implies read-only exploration, no side effects required";
    }

    process.stdout.write(JSON.stringify({ mode, reason }, null, 2) + "\n");
  });

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
    process.stderr.write(`${c.red("error")} ${formatIssue(issue)}\n`);
  }
  for (const issue of warnings) {
    process.stderr.write(`${c.yellow("warn")} ${formatIssue(issue)}\n`);
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
    if (!Array.isArray(perms.use))
      issues.push('"permissions.use" must be an array.');
    if (!Array.isArray(perms.deny))
      issues.push('"permissions.deny" must be an array.');
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
  const allowedKeys = new Set([
    "allow",
    "deny",
    "require_confirmation",
    "budget",
    "extends",
  ]);
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
    if (
      !policy.budget ||
      typeof policy.budget !== "object" ||
      Array.isArray(policy.budget)
    ) {
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

async function loadAEXPolicy(filePath: string): Promise<RuntimePolicy> {
  const parsed = await parseFile(filePath, { tolerant: true });
  const layer = extractPolicyLayer(parsed.task);
  return {
    allow: layer.use,
    deny: layer.deny,
    require_confirmation: layer.confirm,
    budget: layer.budget !== undefined ? { calls: layer.budget } : undefined,
  };
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
  process.stdout.write(`${c.cyan(event.event.padEnd(16))} ${payload}\n`);
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
  topic: "Replace this with your task topic",
};

const SAMPLE_POLICY = {
  allow: ["model.make"],
  deny: ["secrets.read", "network.*"],
  require_confirmation: [],
  budget: {
    calls: 20,
  },
};

const SAMPLE_POLICY_AEX = `policy workspace v0

goal "Default security boundary for this repository."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
`;
