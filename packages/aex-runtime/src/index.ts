import { validateAEX } from "@aex/validator";

export interface RunResult {
  ok: boolean;
  issues: string[];
}

export function runAEX(source: string): RunResult {
  const validation = validateAEX(source);
  return { ok: validation.issues.length === 0, issues: validation.issues };
}
