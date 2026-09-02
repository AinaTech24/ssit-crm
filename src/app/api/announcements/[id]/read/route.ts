import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/announcements/[id]/read — mark an announcement read (and, when
 * `acknowledge` is true, acknowledged) for the current user. Idempotent upsert.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const Body = z.object({ acknowledge: z.boolean().default(false) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    const acknowledge = parse.success ? parse.data.acknowledge : false;

    await withTenant(session.tenantId, async (tx) => {
      // Upsert the read row; set acknowledged_at when acknowledging (and never
      // clear it once set).
      await tx.execute(sql`
        INSERT INTO announcement_reads (tenant_id, announcement_id, user_id, read_at, acknowledged_at)
        VALUES (${session.tenantId}::uuid, ${id}::uuid, ${session.userId}::uuid, now(), ${acknowledge ? sql`now()` : sql`NULL`})
        ON CONFLICT (announcement_id, user_id) DO UPDATE SET
          read_at = COALESCE(announcement_reads.read_at, now()),
          acknowledged_at = COALESCE(announcement_reads.acknowledged_at, EXCLUDED.acknowledged_at)
      `);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
