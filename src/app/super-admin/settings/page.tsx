import Link from "next/link";
import { sql } from "drizzle-orm";
import { Settings as SettingsIcon, Database, MessageCircle, Lock, Webhook, Activity, Bot } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ALL_MODULES } from "@/lib/platform";
import { getAiStatusForAdmin, AI_PROVIDERS } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export default async function PlatformSettingsPage() {
  const session = await requireSession();
  const ai = await getAiStatusForAdmin();
  const aiLabel = AI_PROVIDERS.find((p) => p.value === ai.provider)?.label ?? ai.provider;

  // Health snapshot
  const health = await withPlatformAdmin(session.userId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS tenants,
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM investors) AS investors,
        (SELECT COUNT(*)::int FROM recipes) AS recipes,
        (SELECT COUNT(*)::int FROM workflow_runs WHERE created_at >= now() - interval '24 hours') AS runs_24h,
        (SELECT COUNT(*)::int FROM communications WHERE created_at >= now() - interval '24 hours') AS comms_24h,
        (SELECT COUNT(*)::int FROM events_outbox WHERE processed_at IS NULL) AS outbox_lag
    `);
    return r.rows[0] as any;
  });

  const env: Record<string, "Configured" | "Stub" | "Missing"> = {
    db: process.env.DATABASE_URL ? "Configured" : "Missing",
    redis: process.env.REDIS_URL ? "Configured" : "Missing",
    vartify: process.env.VARTIFY_API_TOKEN && !process.env.VARTIFY_API_TOKEN.includes("xxx") ? "Configured" : "Stub",
    msg91: process.env.MSG91_AUTH_KEY && !process.env.MSG91_AUTH_KEY.includes("xxx") ? "Configured" : "Stub",
    anthropic: process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("xxx") ? "Configured" : "Stub",
    s3: process.env.S3_ACCESS_KEY_ID ? "Configured" : "Stub",
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform settings</h1>
        <p className="text-muted-foreground text-sm">
          SSIT-level configuration, integrations health, and module catalog.
        </p>
      </div>

      <Section title="Platform health (last 24h)" icon={Activity}>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <Stat label="Tenants" value={health.tenants} />
          <Stat label="Users" value={health.users} />
          <Stat label="Investors" value={health.investors} />
          <Stat label="Recipes" value={health.recipes} />
          <Stat label="Workflow runs" value={health.runs_24h} />
          <Stat label="Comms sent" value={health.comms_24h} />
          <Stat label="Outbox lag" value={health.outbox_lag} tone={health.outbox_lag > 0 ? "amber" : "muted"} />
        </div>
      </Section>

      <Section title="Integrations" icon={Webhook}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IntegrationRow icon={Database} label="Postgres database" status={env.db} />
          <IntegrationRow icon={Activity} label="Redis (BullMQ)" status={env.redis} />
          <IntegrationRow icon={MessageCircle} label="Vartify (WhatsApp)" status={env.vartify} />
          <IntegrationRow icon={MessageCircle} label="MSG91 (SMS)" status={env.msg91} />
          <Link href="/super-admin/ai" className="contents">
            <IntegrationRow
              icon={Bot}
              label={`AI · ${aiLabel}${ai.keyConfigured ? "" : " (no key)"}`}
              status={ai.keyConfigured ? "Configured" : "Stub"}
            />
          </Link>
          <IntegrationRow icon={Database} label="AWS S3 (storage)" status={env.s3} />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Status reflects whether real API keys are set in <code className="bg-muted px-1 rounded">.env</code>.
          "Stub" means the adapter falls back to a no-op / mock implementation suitable for dev.
        </p>
      </Section>

      <Section title="Module catalog" icon={SettingsIcon}>
        <p className="text-xs text-muted-foreground mb-3">
          {ALL_MODULES.length} modules available. Each package enables a subset; tenants only see what
          their package allows.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ALL_MODULES.map((m) => (
            <div key={m} className="text-xs px-2.5 py-1.5 rounded border bg-background font-mono">
              {m}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Danger zone" icon={Lock}>
        <p className="text-xs text-muted-foreground mb-3">
          Cross-tenant operations. All actions audit-logged.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <button className="rounded border px-3 py-2 text-left hover:bg-accent" disabled>
            Re-run schema migrations (coming soon)
          </button>
          <button className="rounded border px-3 py-2 text-left hover:bg-accent" disabled>
            Force outbox replay (coming soon)
          </button>
          <button className="rounded border px-3 py-2 text-left hover:bg-accent" disabled>
            Resync Vartify WhatsApp templates for all tenants
          </button>
          <button className="rounded border px-3 py-2 text-left hover:bg-accent" disabled>
            Recompute DDQ scores
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h2>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "rose" | "muted" }) {
  const color = tone === "amber" && value > 0 ? "text-amber-600" : tone === "rose" && value > 0 ? "text-rose-600" : "text-foreground";
  return (
    <div className="border rounded-md p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function IntegrationRow({
  icon: Icon,
  label,
  status,
}: {
  icon: any;
  label: string;
  status: "Configured" | "Stub" | "Missing";
}) {
  const color = status === "Configured" ? "bg-emerald-50 text-emerald-700" : status === "Stub" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return (
    <div className="border rounded-md p-3 flex items-center gap-3">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-sm flex-1">{label}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{status}</span>
    </div>
  );
}
