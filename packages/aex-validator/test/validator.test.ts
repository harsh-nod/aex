import { describe, expect, it } from "vitest";
import { parseAEX } from "@aex/parser";
import { validateParsed, ValidationIssue } from "@aex/validator";

const BASE_CONTRACT = `agent sample v0

goal "Demo"

use file.read, tests.run
deny secrets.read

need path: file

do file.read(paths=path) -> content

return content
`;

describe("validator", () => {
  it("passes a valid contract", () => {
    const parsed = parseAEX(BASE_CONTRACT, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues.filter(isError)).toHaveLength(0);
  });

  it("flags tool usage that is not declared", () => {
    const invalid = `agent sample v0

goal "Demo"

use file.read

do file.write(diff=patch) -> result

return result
`;
    const parsed = parseAEX(invalid, { tolerant: true });
    const result = validateParsed(parsed);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: 'Tool "file.write" is not declared in use.',
        }),
      ]),
    );
  });

  it("flags denied tools even if declared", () => {
    const invalid = `agent sample v0

goal "Demo"

use file.read, network.fetch
deny network.*

do network.fetch(url="https://example.com") -> result

return result
`;
    const parsed = parseAEX(invalid, { tolerant: true });
    const result = validateParsed(parsed);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: 'Tool "network.fetch" is denied by the contract.',
        }),
      ]),
    );
  });

  it("flags make steps that reference unknown values", () => {
    const invalid = `agent sample v0

goal "Demo"

use model.make

make report: markdown from summary with:
  - present overview

return report
`;
    const parsed = parseAEX(invalid, { tolerant: true });
    const result = validateParsed(parsed);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining('references unknown value "summary"'),
        }),
      ]),
    );
  });

  it("requires a return statement", () => {
    const invalid = `agent sample v0

goal "Demo"

use file.read

do file.read(paths="README.md") -> content
`;

    const parsed = parseAEX(invalid, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "Task is missing a return statement.",
        }),
      ]),
    );
  });
});

function isError(issue: ValidationIssue): boolean {
  return issue.severity === "error";
}
