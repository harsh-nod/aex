import { describe, expect, it } from "vitest";
import { parseAEX } from "@aex-lang/parser";
import { validateParsed, ValidationIssue } from "@aex-lang/validator";

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

  it("flags unknown need types", () => {
    const invalid = `agent sample v0

goal "Demo"

use file.read

need data: hashmap

do file.read(paths="README.md") -> content

return content
`;
    const parsed = parseAEX(invalid, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "AEX032",
          message: expect.stringContaining('unknown type "hashmap"'),
        }),
      ]),
    );
  });

  it("accepts all known need types", () => {
    const valid = `agent sample v0

goal "Demo"

use file.read

need a: str
need b: num
need c: int
need d: bool
need e: file
need f: url
need g: json
need h: list[str]
need i: str?
need j: list[file]

do file.read(paths="README.md") -> content

return content
`;
    const parsed = parseAEX(valid, { tolerant: true });
    const result = validateParsed(parsed);
    const typeErrors = result.issues.filter((i) => i.code === "AEX032");
    expect(typeErrors).toHaveLength(0);
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

describe("policy validation", () => {
  it("passes a valid policy file", () => {
    const policy = `policy workspace v0

goal "Default security boundary for this repo."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100
`;
    const parsed = parseAEX(policy, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues.filter(isError)).toHaveLength(0);
    expect(result.task.isPolicy).toBe(true);
  });

  it("does not require a return statement for policies", () => {
    const policy = `policy workspace v0

goal "No return needed."

use file.read
deny network.*
`;
    const parsed = parseAEX(policy, { tolerant: true });
    const result = validateParsed(parsed);
    const returnErrors = result.issues.filter(
      (i) => i.code === "AEX003" && i.severity === "error",
    );
    expect(returnErrors).toHaveLength(0);
  });

  it("flags need declarations in policy files via parser diagnostic", () => {
    const policy = `policy workspace v0

goal "Policy with need"

use file.read

need path: file

confirm before file.read
`;
    const parsed = parseAEX(policy, { tolerant: true });
    // Parser catches need in policy files as a diagnostic (AEX100)
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("AEX120"),
        }),
      ]),
    );
    // Validator surfaces parser diagnostics as AEX100 errors
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "AEX100",
        }),
      ]),
    );
  });

  it("flags execution steps in policy files via parser diagnostic", () => {
    const policy = `policy workspace v0

goal "Policy with do step"

use file.read

do file.read(paths="README.md") -> content

return content
`;
    const parsed = parseAEX(policy, { tolerant: true });
    // Parser catches execution steps in policy files
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("AEX120"),
        }),
      ]),
    );
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "AEX100",
        }),
      ]),
    );
  });

  it("requires goal in policy files (AEX002)", () => {
    const policy = `policy workspace v0

use file.read
deny network.*
`;
    const parsed = parseAEX(policy, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "AEX002",
          message: "Policy is missing a goal.",
        }),
      ]),
    );
  });

  it("requires policy declaration (AEX001)", () => {
    const bad = `goal "Orphaned goal"

use file.read
`;
    const parsed = parseAEX(bad, { tolerant: true });
    const result = validateParsed(parsed);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "AEX001",
        }),
      ]),
    );
  });
});

function isError(issue: ValidationIssue): boolean {
  return issue.severity === "error";
}
