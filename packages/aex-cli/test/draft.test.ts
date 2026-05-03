import { describe, expect, it } from "vitest";
import {
  deriveName,
  stripFences,
  buildSystemPrompt,
  generateTimestampPrefix,
} from "../src/draft.js";

describe("deriveName", () => {
  it("extracts meaningful words from a prompt", () => {
    expect(deriveName("fix the failing test in auth")).toBe(
      "fix_failing_test_auth",
    );
  });

  it("removes stop words", () => {
    expect(deriveName("update the config for this project")).toBe(
      "update_config_project",
    );
  });

  it("truncates to 30 characters", () => {
    const long =
      "refactor the entire authentication system to use jwt tokens";
    const name = deriveName(long);
    expect(name.length).toBeLessThanOrEqual(30);
  });

  it("returns fallback for empty-ish prompt", () => {
    expect(deriveName("the a in")).toBe("generated_task");
  });

  it("strips punctuation", () => {
    expect(deriveName("fix bug #123 in auth!")).toBe("fix_bug_123_auth");
  });
});

describe("stripFences", () => {
  it("removes ```aex fences", () => {
    const input = '```aex\ntask foo v0\n\ngoal "hi"\n\nreturn true\n```';
    expect(stripFences(input)).toBe('task foo v0\n\ngoal "hi"\n\nreturn true');
  });

  it("removes plain ``` fences", () => {
    const input = '```\ntask bar v0\n```';
    expect(stripFences(input)).toBe("task bar v0");
  });

  it("handles text without fences", () => {
    const input = 'task baz v0\n\ngoal "test"';
    expect(stripFences(input)).toBe(input);
  });

  it("handles uppercase AEX", () => {
    const input = '```AEX\ntask foo v0\n```';
    expect(stripFences(input)).toBe("task foo v0");
  });
});

describe("buildSystemPrompt", () => {
  it("includes syntax reference", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("AEX Syntax Reference");
    expect(prompt).toContain("task <name> v0");
  });

  it("includes rules", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("confirm before file.write");
  });

  it("includes examples", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("fix_test");
    expect(prompt).toContain("review_pr");
  });

  it("includes policy when provided", () => {
    const policy = `policy workspace v0\n\ngoal "test"\n\nallow file.read\ndeny network.*`;
    const prompt = buildSystemPrompt(policy);
    expect(prompt).toContain("Active Policy");
    expect(prompt).toContain("allow file.read");
    expect(prompt).toContain("deny network.*");
  });

  it("omits policy section when not provided", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain("Active Policy");
  });
});

describe("generateTimestampPrefix", () => {
  it("returns a timestamp-shaped string", () => {
    const ts = generateTimestampPrefix();
    // Format: YYYYMMDD-HHmmss
    expect(ts).toMatch(/^\d{8}-\d{6}$/);
  });
});
