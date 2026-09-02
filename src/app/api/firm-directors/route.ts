import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/firm-directors    — list directors / founders / partners
 * POST /api/firm-directors    — add one
 *
 * Owner / compliance only.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
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

const PostBody = z.object({
  name: z.string().min(1).max(160),
  role: z.enum(ROLES).default("director"),
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
  status: z.enum(STATUSES).default("active"),
  documents: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        url: z.string().url(),
        uploadedAt: z.string().optional(),
      })
    )
    .max(20)
    .default([]),
  remarks: z.string().max(4000).nullable().optional(),
});

export async function GET(_req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(firmDirectors)
        .where(eq(firmDirectors.tenantId, session.tenantId))
        .orderBy(firmDirectors.name);
    });
    return NextResponse.json({ directors: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const d = parse.data;
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .insert(firmDirectors)
        .values({
          tenantId: session.tenantId,
          name: d.name,
          role: d.role,
          designation: d.designation || null,
          din: d.din || null,
          panNumber: d.panNumber ? d.panNumber.toUpperCase() : null,
          email: d.email || null,
          phone: d.phone || null,
          shareholdingPct:
            d.shareholdingPct != null ? String(d.shareholdingPct) : null,
          dateOfAppointment: d.dateOfAppointment || null,
          dateOfResignation: d.dateOfResignation || null,
          status: d.status,
          documents: d.documents,
          remarks: d.remarks || null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "firm_director.create",
        entityType: "firm_director",
        entityId: r.id,
        before: null,
        after: r,
        ...meta,
      });
      return r;
    });
    return NextResponse.json({ director: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

// Touch and to suppress unused-import warning
void and;
