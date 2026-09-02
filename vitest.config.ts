import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // tsconfig uses Next's `jsx: "preserve"`, which Vite can't parse when a test
  // import-chain reaches a .tsx file (e.g. the React Email renderer) — compile
  // JSX with the automatic runtime in the test pipeline instead.
  esbuild: {
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    // DB-backed tests gate themselves on TEST_DATABASE_URL and skip when absent,
    // so `vitest run` is green on a laptop with no Postgres.
    testTimeout: 20_000,
  },
});
