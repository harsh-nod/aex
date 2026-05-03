import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildReviewSummary, formatReviewText } from "../src/review.js";

const SAMPLE_TASK = `task fix_test v0

goal "Fix the failing test."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=["src/foo.ts"]) -> sources

make patch: diff from failure, sources with:
  - fix the failing test

check patch is valid diff
confirm before file.write

do file.write(diff=patch) -> result

return {
  status: "fixed",
  patch: patch
}
`;

const SAMPLE_POLICY = `policy workspace v0

goal "Default boundary."

allow file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=50
`;

async function writeTempFiles(
  task: string,
  policy?: string,
): Promise<{ taskPath: string; policyPath?: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "aex-review-"));
  const taskPath = path.join(dir, "task.aex");
  await fs.writeFile(taskPath, task, "utf8");

  let policyPath: string | undefined;
  if (policy) {
    const aexDir = path.join(dir, ".aex");
    await fs.mkdir(aexDir, { recursive: true });
    policyPath = path.join(aexDir, "policy.aex");
    await fs.writeFile(policyPath, policy, "utf8");
  }

  return { taskPath, policyPath, dir };
}

describe("buildReviewSummary", () => {
  it("extracts task metadata", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);

    expect(summary.task).toBe("fix_test");
    expect(summary.goal).toBe("Fix the failing test.");
    expect(summary.requested).toContain("file.read");
    expect(summary.requested).toContain("file.write");
    expect(summary.requested).toContain("tests.run");
    expect(summary.denied).toContain("network.*");
    expect(summary.denied).toContain("secrets.read");
  });

  it("collects checks from task", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);

    expect(summary.checks).toContain("patch is valid diff");
  });

  it("collects make steps", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);

    expect(summary.makeSteps).toHaveLength(1);
    expect(summary.makeSteps[0]).toContain("make patch");
  });

  it("collects confirm requirements", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);

    expect(summary.confirmRequired).toContain("file.write");
  });

  it("reports valid task", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);

    expect(summary.valid).toBe(true);
  });

  it("computes effective permissions with policy", async () => {
    const { taskPath, policyPath } = await writeTempFiles(
      SAMPLE_TASK,
      SAMPLE_POLICY,
    );
    const summary = await buildReviewSummary(taskPath, policyPath);

    // Effective allow = intersection of task use and policy use
    expect(summary.effective.allow).toContain("file.read");
    expect(summary.effective.allow).toContain("file.write");
    expect(summary.effective.allow).toContain("tests.run");
    // git.* is in policy but not task, so not in effective
    expect(summary.effective.allow).not.toContain("git.*");

    // Effective deny = union
    expect(summary.effective.deny).toContain("network.*");
    expect(summary.effective.deny).toContain("secrets.read");

    // Budget from policy
    expect(summary.effective.budget).toBe(50);
  });
});

describe("formatReviewText", () => {
  it("includes task name and goal", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);
    const text = formatReviewText(summary, false);

    expect(text).toContain("fix_test");
    expect(text).toContain("Fix the failing test.");
  });

  it("shows requested tools", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);
    const text = formatReviewText(summary, false);

    expect(text).toContain("file.read");
    expect(text).toContain("file.write");
    expect(text).toContain("tests.run");
  });

  it("shows checks", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);
    const text = formatReviewText(summary, false);

    expect(text).toContain("patch is valid diff");
  });

  it("shows status lines", async () => {
    const { taskPath } = await writeTempFiles(SAMPLE_TASK);
    const summary = await buildReviewSummary(taskPath);
    const text = formatReviewText(summary, false);

    expect(text).toContain("Valid task.");
  });
});
