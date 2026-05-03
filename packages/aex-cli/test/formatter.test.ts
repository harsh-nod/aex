import { describe, expect, it } from "vitest";
import { parseAEX } from "@aex-lang/parser";
import { formatTask } from "../src/formatter.js";

describe("formatter", () => {
  it("normalizes contract layout", () => {
    const source = `task sample_agent v1

goal "Example"

use tests.run,file.write
deny network.*

need test_cmd: str
need file_path: str

do tests.run(cmd=test_cmd)->result
check result.passed

make patch: diff from result with:
- ensure all tests pass

confirm before file.write

do file.write(path=file_path, contents="ok") -> write_result

return { status: "done", files: write_result.written }
`;

    const parsed = parseAEX(source, { tolerant: true });
    const formatted = formatTask(parsed.task);
    expect(formatted).toMatchInlineSnapshot(`
"task sample_agent v1

goal \"Example\"

use tests.run, file.write
deny network.*

need test_cmd: str
need file_path: str

do tests.run(cmd=test_cmd) -> result

check result.passed

make patch: diff from result with:
  - ensure all tests pass

confirm before file.write

do file.write(contents=\"ok\", path=file_path) -> write_result

return { status: \"done\", files: write_result.written }"
`);
  });

  it("uses allow keyword for policy files", () => {
    const source = `policy workspace v0

goal "Security boundary."

allow file.read, file.write
deny network.*

budget calls=50
`;

    const parsed = parseAEX(source, { tolerant: true });
    const formatted = formatTask(parsed.task);
    expect(formatted).toContain("allow file.read, file.write");
    expect(formatted).not.toContain("use file.read");
  });

  it("preserves budget declarations", () => {
    const source = `task budgeted v0

goal "Budget test"

use web.search

need question: str

budget calls=8

do web.search(q=question) -> hits

return hits
`;

    const parsed = parseAEX(source, { tolerant: true });
    const formatted = formatTask(parsed.task);
    expect(formatted).toContain("budget calls=8");
  });
});
