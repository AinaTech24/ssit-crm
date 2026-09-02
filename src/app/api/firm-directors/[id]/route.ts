import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/firm-directors/[id]
 * PATCH  /api/firm-directors/[id]
 * DELETE /api/firm-directors/[id]  — soft-resign
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { firmDirectors } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ROLES = [
  "founder",
  "director",
  "partner",
  "designated_partner",
  "managing_director",
  "whole_time_director",
  "independent_director",
  "authorized_signatory",
  "proprietor",
  "karta",
  "other",
] as const;
const STATUSES = ["active", "resigned"] as const;

const PatchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  role: z.enum(ROLES).optional(),
  designation: z.string().max(120).nullable().optional(),
  din: z
    .string()
    .regex(/^\d{8}$/, "DIN format: 8 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/i, "PAN format: ABCDE1234F")
    .nullable()
    .optional()
    .or(z.literal("")),
  email: z.string().email().nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional(),
  shareholdingPct: z.number().min(0).max(100).nullable().optional(),
  dateOfAppointment: z.string().nullable().optional(),
  dateOfResignation: z.string().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  documents: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        url: z.string().url(),
        uploadedAt: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
  remarks: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(firmDirectors)
        .where(eq(firmDirectors.id, id))
        .limit(1);
      return r;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ director: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const body = parse.data;
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(firmDirectors)
        .where(eq(firmDirectors.id, id));
      if (!existing) return null;
      const patch: any = { updatedAt: new Date() };
      for (const k of Object.keys(body) as Array<keyof typeof body>) {
        if (body[k] === undefined) continue;
        if (k === "panNumber") {
          patch.panNumber = body.panNumber ? body.panNumber.toUpperCase() : null;
        } else if (k === "shareholdingPct") {
          patch.shareholdingPct =
            body.shareholdingPct != null ? String(body.shareholdingPct) : null;
        } else if (k === "status" && body.status === "resigned") {
          patch.status = "resigned";
          if (!existing.dateOfResignation) {
            patch.dateOfResignation = new Date().toISOString().slice(0, 10);
          }
        } else {
          patch[k] = body[k] === "" ? null : body[k];
        }
      }
      const [next] = await tx
        .update(firmDirectors)
        .set(patch)
        .where(eq(firmDirectors.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "firm_director.update",
        entityType: "firm_director",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ director: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(firmDirectors)
        .where(eq(firmDirectors.id, id));
      if (!existing) return null;
      const today = new Date().toISOString().slice(0, 10);
      const [next] = await tx
        .update(firmDirectors)
        .set({
          status: "resigned",
          dateOfResignation: today,
          updatedAt: new Date(),
        } as any)
        .where(eq(firmDirectors.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "firm_director.resign",
        entityType: "firm_director",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ director: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
