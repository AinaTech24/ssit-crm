import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Copy, ShieldCheck, Users, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DuplicateGroup, FamilyDuplicateGroup } from "@/components/investors/DuplicateMerge";
import { ignoredDuplicates } from "@/db/schema";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

type MemberRow = { kind: string; gkey: string; id: string; name: string; pan: string | null; phone: string | null; email: string | null; aum: number; rm_name: string | null };
type FamRow = { gkey: string; id: string; name: string; member_count: number; family_aum: number };

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  if (!isManager(session.roles)) {
    return <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">Duplicate detection &amp; merge is for owners and branch heads.</div>;
  }
  const sp = await searchParams;
  const mod = sp.module === "family" ? "family" : "client";

  const { data, ignoredList } = await withTenant(session.tenantId, async (tx) => {
    let fam: FamRow[] = [];
    let cli: MemberRow[] = [];

    if (mod === "family") {
      const r = await tx.execute(sql`
        WITH base AS (
          SELECT f.id, COALESCE(f.family_name, f.head_name) AS name,
                 lower(trim(COALESCE(f.family_name, f.head_name))) AS nkey,
                 COUNT(i.id) FILTER (WHERE i.status = 'active')::int AS member_count,
                 COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_aum
          FROM families f LEFT JOIN investors i ON i.family_id = f.id
          WHERE f.tenant_id = ${session.tenantId}::uuid
          GROUP BY f.id
        )
        SELECT nkey AS gkey, id, name, member_count, family_aum FROM base b
        WHERE nkey <> '' AND (SELECT count(*) FROM base b2 WHERE b2.nkey = b.nkey) > 1
      `);
      fam = r.rows as FamRow[];
    } else {
      const r = await tx.execute(sql`
        WITH base AS (
          SELECT i.id, i.name, i.pan, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name
          FROM investors i LEFT JOIN users u ON u.id = i.rm_id
          WHERE i.tenant_id = ${session.tenantId}::uuid AND i.merged_into_id IS NULL
        ),
        pan_g AS (SELECT 'PAN' AS kind, upper(pan) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY upper(pan)) AS grp FROM base WHERE pan IS NOT NULL AND pan <> ''),
        phone_g AS (SELECT 'Phone' AS kind, regexp_replace(phone,'\D','','g') AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY regexp_replace(phone,'\D','','g')) AS grp FROM base WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10),
        email_g AS (SELECT 'Email' AS kind, lower(email) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(email)) AS grp FROM base WHERE email IS NOT NULL AND email <> ''),
        name_g AS (SELECT 'Name' AS kind, lower(trim(name)) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(trim(name))) AS grp FROM base WHERE name IS NOT NULL AND trim(name) <> '')
        SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM pan_g WHERE grp > 1
        UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM phone_g WHERE grp > 1
        UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM email_g WHERE grp > 1
        UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM name_g WHERE grp > 1
      `);
      cli = r.rows as MemberRow[];
    }

    const ignored = await tx
      .select({
        key1: ignoredDuplicates.key1,
        key2: ignoredDuplicates.key2,
        entityType: ignoredDuplicates.entityType,
      })
      .from(ignoredDuplicates)
      // Tenant predicate — under the RLS-bypass model this would otherwise read
      // every tenant's ignored pairs.
      .where(eq(ignoredDuplicates.tenantId, session.tenantId));

    return { data: { fam, cli }, ignoredList: ignored };
  });

  const isIgnoredPair = (id1: string, id2: string, type: "client" | "family") => {
    const [k1, k2] = id1 < id2 ? [id1, id2] : [id2, id1];
    return ignoredList.some((ig) => ig.entityType === type && ig.key1 === k1 && ig.key2 === k2);
  };

  const isClusterIgnored = (members: { id: string }[], type: "client" | "family") => {
    if (members.length < 2) return true;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!isIgnoredPair(members[i].id, members[j].id, type)) {
          return false;
        }
      }
    }
    return true;
  };

  // Group client rows by (kind, gkey).
  const cliGroups = new Map<string, { kind: string; gkey: string; members: Map<string, MemberRow> }>();
  for (const row of data.cli) {
    const key = `${row.kind}::${row.gkey}`;
    if (!cliGroups.has(key)) cliGroups.set(key, { kind: row.kind, gkey: row.gkey, members: new Map() });
    cliGroups.get(key)!.members.set(row.id, row);
  }
  const RULE_ORDER: Record<string, number> = { PAN: 0, Email: 1, Phone: 2, Name: 3 };
  const cliClusters = [...cliGroups.values()]
    .map((g) => ({ kind: g.kind, gkey: g.gkey, members: [...g.members.values()] }))
    .filter((g) => g.members.length > 1)
    .filter((g) => !isClusterIgnored(g.members, "client"))
    .sort((a, b) => (RULE_ORDER[a.kind] ?? 9) - (RULE_ORDER[b.kind] ?? 9) || b.members.length - a.members.length);
  const ruleCounts = cliClusters.reduce((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {} as Record<string, number>);

  // Group family rows by name key.
  const famGroups = new Map<string, FamRow[]>();
  for (const row of data.fam) {
    if (!famGroups.has(row.gkey)) famGroups.set(row.gkey, []);
    famGroups.get(row.gkey)!.push(row);
  }
  const famClusters = [...famGroups.entries()]
    .map(([gkey, members]) => ({ gkey, members }))
    .filter((g) => g.members.length > 1)
    .filter((g) => !isClusterIgnored(g.members, "family"));

  const clusterTotal = mod === "family" ? famClusters.length : cliClusters.length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Copy className="size-6 text-brand-cyan" /> Find Duplicate Records</h1>
      </div>

      {/* Module toggle */}
      <div className="flex gap-2">
        <Tab active={mod === "client"} href="/dashboard/duplicates?module=client" icon={Users} label="Clients" />
        <Tab active={mod === "family"} href="/dashboard/duplicates?module=family" icon={HeartHandshake} label="Families" />
      </div>

      {mod === "client" && Object.keys(ruleCounts).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {["PAN", "Email", "Phone", "Name"].filter((k) => ruleCounts[k]).map((k) => (
            <span key={k} className="chip bg-secondary">{k}: <strong className="ml-1">{ruleCounts[k]}</strong></span>
          ))}
        </div>
      )}

      {clusterTotal === 0 ? (
        <div className="card-surface p-12 text-center">
          <ShieldCheck className="size-10 mx-auto text-emerald-500" />
          <div className="mt-3 font-medium">No duplicate {mod === "family" ? "families" : "clients"} found.</div>
          <p className="text-sm text-muted-foreground mt-1">{mod === "family" ? "Your family groupings are clean on name." : "Your client book is clean on PAN, phone, email, and name."}</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">{clusterTotal} duplicate group{clusterTotal === 1 ? "" : "s"} found.</div>
          <div className="space-y-3">
            {mod === "client"
              ? cliClusters.map((c) => <DuplicateGroup key={`${c.kind}-${c.gkey}`} kind={c.kind} gkey={c.gkey} members={c.members.map((m) => ({ ...m, aum: Number(m.aum) }))} />)
              : famClusters.map((c) => <FamilyDuplicateGroup key={c.gkey} gkey={c.gkey} members={c.members.map((m) => ({ ...m, member_count: Number(m.member_count), family_aum: Number(m.family_aum) }))} />)}
          </div>
          <p className="text-[11px] text-muted-foreground italic">Merging is irreversible and fully audit-logged. {mod === "family" ? "The duplicate grouping is removed once its members move." : "The duplicate client is retired (status “inactive”, marked merged)."}</p>
        </>
      )}
    </div>
  );
}

function Tab({ active, href, icon: Icon, label }: { active: boolean; href: string; icon: any; label: string }) {
  return (
    <Link href={href} className={`px-3 py-1.5 rounded-md text-sm font-medium border inline-flex items-center gap-1.5 ${active ? "bg-brand-cyan text-white border-brand-cyan" : "border-border text-muted-foreground hover:bg-secondary"}`}>
      <Icon className="size-4" /> {label}
    </Link>
  );
}
