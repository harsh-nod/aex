#!/usr/bin/env node

import { Command } from "commander";
import { parseAEX } from "@aex/parser";
import { validateAEX } from "@aex/validator";
import { runAEX } from "@aex/runtime";
import { promises as fs } from "node:fs";

const program = new Command();

program.name("aex").description("Executable contracts for AI agents");

program
  .command("parse")
  .argument("<file>")
  .action(async (file) => {
    const source = await fs.readFile(file, "utf8");
    const parsed = parseAEX(source);
    process.stdout.write(JSON.stringify(parsed, null, 2));
  });

program
  .command("check")
  .argument("<file>")
  .action(async (file) => {
    const source = await fs.readFile(file, "utf8");
    const result = validateAEX(source);
    if (result.issues.length === 0) {
      process.stdout.write("Contract is valid\n");
    } else {
      process.stderr.write(result.issues.join("\n"));
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .argument("<file>")
  .action(async (file) => {
    const source = await fs.readFile(file, "utf8");
    const result = runAEX(source);
    if (result.ok) {
      process.stdout.write("Run complete\n");
    } else {
      process.stderr.write(result.issues.join("\n"));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
