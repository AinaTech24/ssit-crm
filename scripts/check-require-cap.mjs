#!/usr/bin/env node
/**
 * CI guard — every POST/PUT/PATCH/DELETE handler under src/app/api/**
 * must reference `require(` or `requirePlatform(` so RBAC is enforced.
 *
 * Skips known-legitimate routes (auth, public form tokens, webhooks,
 * health probe, super-admin uses its own gate).
 *
 * Exits with code 1 + a list of offending files if any are found.
 * Use as a pre-commit hook or a GitHub Actions step.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "src", "app", "api");

const SKIP_PREFIXES = [
  "auth/",         // rate-limited, no session yet
  "public/",       // share_tokens are the credential
  "webhooks/",     // HMAC-signed
  "internal/",     // cron-triggered, gated by internal secret
  "super-admin/",  // uses isPlatformAdmin
  "health",        // anonymous probe
];

/**
 * Per-file exemptions — these have explicit, audited reasons not to call
 * requireCap. Adding a line here is a security review checkpoint.
 */
const SKIP_FILES = new Set([
  // Activities — context-aware ownership & assignment checks (verified by RM/owner status)
  "activities/route.ts",
  "activities/[id]/route.ts",
  // AI helpers — read-only text generation, any logged-in user can use them
  "ai/draft-message/route.ts",
  "ai/nl-to-filter/route.ts",
  // Read-only lookups + preview endpoints — commit/save paths are gated
  "leads/check-duplicate/route.ts",
  "segments/preview/route.ts",
  "investors/import/parse/route.ts",
  "leads/import/parse/route.ts",
  "transactions/import/parse/route.ts",
  // Invite acceptance — the invite token is the credential, no session yet
  "employees/accept-invite/route.ts",
  // Investor portal — the signed portal TOKEN is the credential; there is no
  // session and no firm user, so requireCap(session.roles, …) is meaningless.
  // Gated instead by resolvePortalAccess(token) plus an explicit per-request
  // scope check (access.scopes.includes("service_requests")), and every write is
  // hard-scoped to the investor that token resolves to.
  "portal/[token]/service-requests/route.ts",
  // Notifications mark-read — user can only touch their own (scoped to session.userId)
  "notifications/mark-read/route.ts",
  // Support tickets — any logged-in user can raise an internal support ticket
  "support/tickets/route.ts",
  // Self-service — the handler is hard-scoped to session.userId; a user may only
  // ever touch their own row, so a capability check would be meaningless.
  "me/password/route.ts",
  // Calendly — each user connects their OWN Calendly; hard-scoped to session.userId.
  "integrations/calendly/route.ts",
  "me/profile/route.ts",
  // Session keep-alive — re-signs the caller's OWN already-valid, non-revoked
  // token (same claims, same sid); it grants nothing the cookie didn't already.
  "session/keepalive/route.ts",
  // SOP acknowledgement — any user records their OWN read receipt (scoped to
  // session.userId, idempotent unique). Mirrors notifications/mark-read.
  "sops/[id]/acknowledge/route.ts",
  // Read-only AI text generation — any logged-in user can draft a client brief
  // (parity with ai/draft-message, ai/nl-to-filter). No data is mutated.
  "ai/client-brief/[id]/route.ts",
  // Parse/preview only — returns parsed rows; the commit/import path is gated.
  "insurance/import/parse/route.ts",
  // Local-disk storage primitive (S3 fallback). Protected by requireSession +
  // a tenant-prefix match (a user may only read/write within their own tenant's
  // key namespace); callers that mint keys are themselves capability-gated.
  "upload-local/[...key]/route.ts",

  // ── SELF-SCOPED (audited 2026-07-25) ────────────────────────────────────────
  // Each handler is hard-scoped to the caller's own row(s) via session.userId,
  // so a capability check would be meaningless — a user acting on their own
  // chat / dashboard / device / tracker is the entire point. Same rationale as
  // me/profile + notifications/mark-read above.
  "ai/ask/route.ts",
  "ai/chats/route.ts",
  "ai/chats/[id]/route.ts",
  "ai/chats/[id]/messages/route.ts",
  "announcements/[id]/read/route.ts",          // own read receipt

  // Leave decisions are ROW-level, not capability-level: who may approve,
  // reject or cancel one request depends on the applicant (their sub-branch,
  // whether they are themselves a branch head, who they report to) as much as
  // on the caller. A blanket requireCap here would be wrong in both
  // directions — it would lock out the reporting manager and the applicant
  // cancelling their own, while implying the holder may decide anything. The
  // real gate is decideLeaveCheck / cancelLeaveCheck in lib/leave/access.ts,
  // which every caller passes through before any write.
  "leave-applications/[id]/route.ts",
  "command-center/snooze/route.ts",            // own snooze
  "command-center/digest/route.ts",            // own digest
  "daily-tracker/route.ts",                    // own daily tracker
  "dashboards/route.ts",                       // own custom dashboards
  "dashboards/templates/route.ts",
  "dashboards/[id]/clone/route.ts",
  "dashboards/[id]/default/route.ts",
  "dashboards/[id]/restore/route.ts",
  "dashboard/custom-chart/route.ts",
  "devices/route.ts",                          // own device registration
  "me/devices/[id]/route.ts",                  // own device
  "me/session/register/route.ts",              // own session
  "me/sign-out-everywhere/route.ts",           // own sessions
  "nba/draft/route.ts",                        // own NBA draft
  // Calculators — personal what-if maths + the PDF/share of one's own result.
  // No firm data is mutated; save-to-client writes an attachment the user can
  // already create via documents.
  "calculators/pdf/route.ts",
  "calculators/pdf-combined/route.ts",
  "calculators/scenarios/route.ts",
  "calculators/share/route.ts",
  "calculators/save-to-client/route.ts",
]);

const MUTATION = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/g;
// A route is gated if it uses one of the project's audited gate idioms:
//   require(roles, cap)          - tenant capability check
//   requireCap(...)              - alias from rbac.ts
//   requireAny(roles, [caps])    - pass-if-any caps
//   requirePlatform(...)         - platform-admin capability
//   isPlatformAdmin(roles)       - inline platform check + 403 in route
//   isManager(roles)             - owner/branch_head manager gate (widely used)
//   loadEditableLead/Viewable…   - lead ownership gate (throws 403/404)
//   ["owner", …] / .includes("owner") - inline owner/manager role allowlist
// Keep this in lock-step with the real gating vocabulary so the guard catches
// genuinely UNGATED mutations, not false-positive on a non-require idiom.
const HAS_REQUIRE =
  /\b(?:require|requireCap|requireAny|requirePlatform|isPlatformAdmin|isManager|loadEditableLead|loadViewableLead)\s*\(|\.includes\(\s*["']owner["']\s*\)|\[\s*["']owner["']/;

// `can(roles, cap)` + an explicit 403 is an equally valid gate — several routes
// (rta/import, team/targets, integrations/rta-mailback, …) use it to return a
// custom message instead of the generic thrown 403. Both parts are required:
// a bare `can()` may just be a UI hint, so it only counts as a gate when the
// handler actually refuses with a 403.
const HAS_CAN_403 = (src) => /\bcan\s*\(/.test(src) && /\b403\b/.test(src);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const offenders = [];

for (const file of await walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
  if (SKIP_FILES.has(rel)) continue;
  const src = await readFile(file, "utf8");
  if (!MUTATION.test(src)) continue;
  MUTATION.lastIndex = 0;
  if (!HAS_REQUIRE.test(src) && !HAS_CAN_403(src)) {
    offenders.push(rel);
  }
}

if (offenders.length === 0) {
  console.log("[check-require-cap] ✓ every mutation route is gated");
  process.exit(0);
}

console.error(
  `[check-require-cap] ✗ ${offenders.length} route(s) have a mutation handler without require(...)`
);
for (const f of offenders) console.error(`  - src/app/api/${f}`);
console.error(
  "\nAdd a requireCap(session.roles, \"<capability>\") line after requireSession() in each."
);
process.exit(1);
