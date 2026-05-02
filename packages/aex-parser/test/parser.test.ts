import { describe, expect, it } from "vitest";
import { parseAEX, ParseFailure, compileTask } from "@aex-lang/parser";

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
    expect(task.use).toEqual(["file.read", "file.write", "tests.run"]);
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

  it("captures budget declarations as numeric values", () => {
    const source = `agent demo v0

goal "Budget check"

use tests.run

budget calls=10, dollars=25

return result
`;

    const { task } = parseAEX(source);
    expect(task.budget).toEqual({ calls: 10, dollars: 25 });
  });

  it("collects instructions for make steps and errors on malformed syntax", () => {
    const valid = `agent writer v0

goal "Compose"

use model.make

make draft: markdown from notes with:
  - include intro
  - add summary

return draft
`;

    const { task } = parseAEX(valid);
    const make = task.steps.find((step) => step.kind === "make");
    expect(make).toBeDefined();
    if (make?.kind === "make") {
      expect(make.instructions).toEqual(["include intro", "add summary"]);
      expect(make.inputs).toEqual(["notes"]);
    }

    const invalid = `agent writer v0

goal "Compose"

use model.make

make draft markdown from notes with:

return draft
`;

    const { diagnostics } = parseAEX(invalid, { tolerant: true });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Invalid make statement",
        }),
      ]),
    );
  });

  it("tracks confirmation gates and multi-line return blocks", () => {
    const source = `agent confirmation v0

goal "Test confirms"

use file.write

confirm before file.write

return {
  status: "ok",
  details: {
    approved: true
  }
}
`;

    const { task } = parseAEX(source);
    const confirm = task.steps.find((step) => step.kind === "confirm");
    expect(confirm).toBeDefined();
    if (confirm?.kind === "confirm") {
      expect(confirm.before).toBe("file.write");
    }
    const returnStep = task.steps.at(-1);
    expect(returnStep?.kind).toBe("return");
    expect(task.returnStatement).toContain("approved: true");
  });

  it("reports unclosed return blocks", () => {
    const source = `agent sample v0

goal "broken return"

return {
  status: "bad"
`;

    const { diagnostics } = parseAEX(source, { tolerant: true });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Return block was not closed",
        }),
      ]),
    );
  });

  it("compiles a parsed task into IR", () => {
    const { task } = parseAEX(SAMPLE_TASK);
    const ir = compileTask(task);

    expect(ir.agent).toBe("fix_test");
    expect(ir.version).toBe("0");
    expect(ir.permissions.use).toContain("tests.run");
    expect(ir.steps[0]).toEqual(
      expect.objectContaining({
        op: "call",
        tool: "tests.run",
      }),
    );
    expect(ir.steps.at(-1)).toEqual(
      expect.objectContaining({
        op: "return",
      }),
    );
  });

  it("parses if statements with indented body", () => {
    const source = `agent cond v0

goal "Conditional"

use tests.run, file.read

need value: str

do tests.run(cmd=value) -> result

if result.failed
  do file.read(paths=value) -> content
  check content

return result
`;

    const { task, diagnostics } = parseAEX(source);
    expect(diagnostics).toHaveLength(0);

    const ifStep = task.steps.find((s) => s.kind === "if");
    expect(ifStep).toBeDefined();
    if (ifStep?.kind === "if") {
      expect(ifStep.condition).toBe("result.failed");
      expect(ifStep.body).toHaveLength(2);
      expect(ifStep.body[0].kind).toBe("do");
      expect(ifStep.body[1].kind).toBe("check");
    }
  });

  it("parses for statements with indented body", () => {
    const source = `agent loop v0

goal "Loop"

use file.read

need files: list[file]

for f in files
  do file.read(path=f) -> content
  check content

return done
`;

    const { task, diagnostics } = parseAEX(source);
    expect(diagnostics).toHaveLength(0);

    const forStep = task.steps.find((s) => s.kind === "for");
    expect(forStep).toBeDefined();
    if (forStep?.kind === "for") {
      expect(forStep.variable).toBe("f");
      expect(forStep.iterable).toBe("files");
      expect(forStep.body).toHaveLength(2);
      expect(forStep.body[0].kind).toBe("do");
      expect(forStep.body[1].kind).toBe("check");
    }
  });

  it("parses nested if inside for", () => {
    const source = `agent nested v0

goal "Nested"

use file.read, tests.run

need items: list[str]

for item in items
  do tests.run(cmd=item) -> result
  if result.failed
    do file.read(path=item) -> content

return done
`;

    const { task, diagnostics } = parseAEX(source);
    expect(diagnostics).toHaveLength(0);

    const forStep = task.steps.find((s) => s.kind === "for");
    expect(forStep).toBeDefined();
    if (forStep?.kind === "for") {
      expect(forStep.body).toHaveLength(2);
      expect(forStep.body[0].kind).toBe("do");
      const nestedIf = forStep.body[1];
      expect(nestedIf.kind).toBe("if");
      if (nestedIf.kind === "if") {
        expect(nestedIf.condition).toBe("result.failed");
        expect(nestedIf.body).toHaveLength(1);
        expect(nestedIf.body[0].kind).toBe("do");
      }
    }
  });

  it("compiles if and for to IR", () => {
    const source = `agent ctrl v0

goal "Control flow"

use file.read

need files: list[file]

for f in files
  do file.read(path=f) -> content
  if content
    check content

return done
`;

    const { task } = parseAEX(source);
    const ir = compileTask(task);

    const forOp = ir.steps.find((s) => s.op === "for");
    expect(forOp).toBeDefined();
    if (forOp && "steps" in forOp) {
      expect(forOp.steps).toHaveLength(2);
      const ifOp = forOp.steps.find((s) => s.op === "if");
      expect(ifOp).toBeDefined();
      if (ifOp && "steps" in ifOp) {
        expect(ifOp.steps).toHaveLength(1);
        expect(ifOp.steps[0].op).toBe("check");
      }
    }
  });
});
