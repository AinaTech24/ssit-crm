import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Build rev: 2025-12 — trigger middleware reload (public form whitelist).

/**
 * A stamp identifying THIS build, so `/api/health` can answer "what is actually
 * deployed?" — previously unanswerable, which made it impossible to tell whether
 * a fix had reached production without reading server logs.
 *
 * Deploys ship a tarball that is built on the server, where `.git` may be
 * absent — so the git SHA is best-effort and we always fall back to the build
 * timestamp, which is available everywhere. Evaluated once at config load,
 * i.e. at BUILD time, not per request.
 */
function resolveBuildStamp(): { sha: string | null; builtAt: string } {
  let sha: string | null = null;
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    // No git on the build host (tarball deploy) — the timestamp still identifies it.
  }
  return { sha, builtAt: new Date().toISOString() };
}
const BUILD = resolveBuildStamp();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Surfaced by /api/health. NEXT_PUBLIC_ is deliberately avoided: this is
  // server-only diagnostics, not something the browser bundle needs.
  env: {
    BUILD_SHA: BUILD.sha ?? "",
    BUILD_AT: BUILD.builtAt,
  },
  generateBuildId: async () => BUILD.sha ?? `t-${Date.parse(BUILD.builtAt)}`,
  // Types are checked with `npx tsc --noEmit` before every deploy, so the
  // in-build re-check is redundant — and on the 4GB prod box it added ~2 min and
  // a memory spike that briefly starved the serving container during deploys.
  // Skipping it keeps deploys fast + smooth. (No ESLint config exists, so
  // ignoreDuringBuilds is a safe future-proof no-op.)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  compiler: {
    // Strip console.* (keep warn/error) from production client bundles.
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    // 50mb so large RTA mailbacks (e.g. a CAMS R9 folio-master zip ~11-25mb)
    // upload without the body being truncated → req.formData() "expected
    // multipart/form-data" failure. Uploads are gated behind an authed,
    // capability-checked route, so the larger ceiling isn't a DoS surface.
    serverActions: { bodySizeLimit: "50mb" },
    // Scale the build's static-analysis workers to available memory instead of
    // spawning one per CPU — prevents the page-data collection phase from
    // OOM-killing a worker on memory-constrained machines. Build-time only.
    memoryBasedWorkersCount: true,
    // Barrel-import tree-shaking. These libs export hundreds of symbols from a
    // single entry; without this, importing one icon/util can pull a large
    // chunk into a route's bundle. lucide-react matters most — the sidebar
    // alone imports ~45 icons and ships on every page.
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-toast",
      "@xyflow/react",
    ],
  },
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
