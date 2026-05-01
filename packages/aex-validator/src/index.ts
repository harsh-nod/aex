import { parseAEX, ParseResult } from "@aex/parser";

export interface ValidationResult {
  parsed: ParseResult;
  issues: string[];
}

export function validateAEX(source: string): ValidationResult {
  const parsed = parseAEX(source);
  return { parsed, issues: [] };
}
