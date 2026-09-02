/**
 * Dev-only preview launcher for the Claude preview tool.
 *
 * Runs `next dev --turbopack` with NO_AUTH=1 so the authenticated dashboard
 * renders without a login step during a UI review. NO_AUTH is HARD-DISABLED in
 * production builds by src/middleware.ts, so this only ever works in dev — it
 * cannot leak a session in prod. Not used by `npm run dev`; only the preview
 * tool invokes it.
 *
 * Resolves the Next CLI via node directly (no `next.cmd` on PATH) so it works
 * regardless of how the preview tool sets up its environment.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.PORT || "3030";

const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "-p", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NO_AUTH: "1",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=3072`.trim(),
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
