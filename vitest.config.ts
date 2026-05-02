import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  test: {
    include: ["packages/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  },
  resolve: {
    alias: {
      "@aex-lang/parser": `${rootDir}packages/aex-parser/src/index.ts`,
      "@aex-lang/validator": `${rootDir}packages/aex-validator/src/index.ts`,
      "@aex-lang/runtime": `${rootDir}packages/aex-runtime/src/index.ts`
    }
  }
});
