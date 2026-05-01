import { describe, expect, it } from "vitest";
import { parseAEX, ParseFailure } from "@aex/parser";

const SAMPLE_TASK = `agent fix_test v0

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
`;

describe("parseAEX", () => {
  it("parses a well-formed contract into structured steps", () => {
    const { task, diagnostics } = parseAEX(SAMPLE_TASK);

    expect(diagnostics).toHaveLength(0);
    expect(task.agent).toEqual({ name: "fix_test", version: "0" });
    expect(task.goal).toBe(
      "Fix the failing test with the smallest safe change.",
    );
    expect(task.use).toEqual([
      "file.read",
      "file.write",
      "tests.run",
    ]);
    expect(task.deny).toEqual(["network.*", "secrets.read"]);
    expect(task.needs).toEqual({
      test_cmd: "str",
      target_files: "list[file]",
    });

    const makeStep = task.steps.find(
      (step) => step.kind === "make" && step.bind === "patch",
    );
    expect(makeStep).toBeDefined();
    if (makeStep?.kind === "make") {
      expect(makeStep.instructions).toEqual([
        "fix the failing test",
        "preserve public behavior",
        "do not touch unrelated files",
      ]);
      expect(makeStep.inputs).toEqual(["failure", "sources"]);
    }

    const returnStep = task.steps.at(-1);
    expect(returnStep?.kind).toBe("return");
    if (returnStep?.kind === "return") {
      expect(returnStep.expression).toContain('status: "fixed"');
      expect(task.returnStatement).toEqual(returnStep.expression);
    }
  });

  it("raises a parse failure when required declarations are missing", () => {
    const source = `use file.read`;
    expect(() => parseAEX(source, { tolerant: false })).toThrow(ParseFailure);

    try {
      parseAEX(source, { tolerant: false });
    } catch (error) {
      if (error instanceof ParseFailure) {
        expect(error.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ message: "Missing agent declaration" }),
            expect.objectContaining({ message: "Missing goal declaration" }),
          ]),
        );
      } else {
        throw error;
      }
    }
  });
});
