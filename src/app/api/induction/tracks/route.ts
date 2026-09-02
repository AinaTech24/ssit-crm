/**
 * Track + lesson + question admin, and manual enrolment.
 *
 * Everything here needs `induction.manage`. Note the third argument to
 * requireCap — several existing routes omitted `session.permissions` and
 * silently ignored custom per-user grants.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  inductionEnrolments,
  inductionLessons,
  inductionQuestions,
  inductionTracks,
  users,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { ensureEnrolment, sanitizeModuleHrefs } from "@/lib/induction/engine";

export const dynamic = "force-dynamic";

const TrackBody = z.object({
  action: z.literal("track"),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  targetRoles: z.array(z.string()).default([]),
  passMark: z.number().int().min(1).max(100).default(70),
  maxAttempts: z.number().int().min(1).max(20).nullable().optional(),
  cooldownHours: z.number().int().min(0).max(720).default(24),
  issueLetter: z.boolean().default(true),
  validDays: z.number().int().min(1).max(3650).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});

const LessonBody = z.object({
  action: z.literal("lesson"),
  id: z.string().uuid().optional(),
  trackId: z.string().uuid(),
  position: z.number().int().min(1).max(500),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).optional().nullable(),
  kind: z.enum(["video", "document", "kb_article", "link", "checklist"]).default("video"),
  videoUrl: z.string().url().max(1000).optional().nullable(),
  videoKey: z.string().max(500).optional().nullable(),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 12).optional().nullable(),
  bodyMd: z.string().max(20000).optional().nullable(),
  unlocksModules: z.array(z.string()).default([]),
  required: z.boolean().default(true),
});

const QuestionBody = z.object({
  action: z.literal("question"),
  id: z.string().uuid().optional(),
  trackId: z.string().uuid(),
  lessonId: z.string().uuid().nullable().optional(),
  prompt: z.string().min(1).max(2000),
  options: z.array(z.object({ key: z.string().min(1).max(8), text: z.string().min(1).max(500) })).min(2),
  correctKeys: z.array(z.string()).min(1),
  explanation: z.string().max(2000).optional().nullable(),
  points: z.number().int().min(1).max(20).default(1),
  active: z.boolean().default(true),
});

const EnrolBody = z.object({
  action: z.literal("enrol"),
  trackId: z.string().uuid(),
  userId: z.string().uuid(),
});

const Body = z.discriminatedUnion("action", [TrackBody, LessonBody, QuestionBody, EnrolBody]);

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "induction.manage", session.permissions);

    const data = await withTenant(session.tenantId, async (tx) => {
      const tracks = await tx
        .select()
        .from(inductionTracks)
        .orderBy(asc(inductionTracks.createdAt));
      const lessons = await tx.select().from(inductionLessons).orderBy(asc(inductionLessons.position));
      const questions = await tx.select().from(inductionQuestions);

      // Per-track enrolment progress for the team view.
      const progress = await tx.execute(sql`
        SELECT e.id, e.track_id, e.user_id, e.status, e.completed_at, u.name AS user_name,
               (SELECT count(*) FROM induction_progress p
                 WHERE p.enrolment_id = e.id AND p.completed_at IS NOT NULL) AS done_count
        FROM induction_enrolments e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE e.tenant_id = ${session.tenantId}::uuid
        ORDER BY u.name ASC
      `);

      const team = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.status, "active"))
        .orderBy(asc(users.name));

      return { tracks, lessons, questions, enrolments: progress.rows, team };
    });

    return NextResponse.json(data);
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "induction.manage", session.permissions);
    const input = Body.parse(await req.json());

    const out = await withTenant(session.tenantId, async (tx) => {
      if (input.action === "track") {
        const values = {
          tenantId: session.tenantId,
          name: input.name,
          description: input.description ?? null,
          targetRoles: input.targetRoles,
          passMark: input.passMark,
          maxAttempts: input.maxAttempts ?? null,
          cooldownHours: input.cooldownHours,
          issueLetter: input.issueLetter,
          validDays: input.validDays ?? null,
          status: input.status,
          createdBy: session.userId,
          updatedAt: new Date(),
        };
        if (input.id) {
          await tx.update(inductionTracks).set(values).where(eq(inductionTracks.id, input.id));
          return { id: input.id };
        }
        const [row] = await tx.insert(inductionTracks).values(values).returning();
        return { id: row.id };
      }

      if (input.action === "lesson") {
        const values = {
          tenantId: session.tenantId,
          trackId: input.trackId,
          position: input.position,
          title: input.title,
          summary: input.summary ?? null,
          kind: input.kind,
          videoUrl: input.videoUrl ?? null,
          videoKey: input.videoKey ?? null,
          durationSeconds: input.durationSeconds ?? null,
          bodyMd: input.bodyMd ?? null,
          // Only real sidebar hrefs may be granted.
          unlocksModules: sanitizeModuleHrefs(input.unlocksModules),
          required: input.required,
          updatedAt: new Date(),
        };
        if (input.id) {
          await tx.update(inductionLessons).set(values).where(eq(inductionLessons.id, input.id));
          return { id: input.id };
        }
        const [row] = await tx.insert(inductionLessons).values(values).returning();
        return { id: row.id };
      }

      if (input.action === "question") {
        const keys = new Set(input.options.map((o) => o.key));
        const bad = input.correctKeys.filter((k) => !keys.has(k));
        if (bad.length) throw Object.assign(new Error(`correct key not in options: ${bad.join(", ")}`), { status: 400 });

        const values = {
          tenantId: session.tenantId,
          trackId: input.trackId,
          lessonId: input.lessonId ?? null,
          prompt: input.prompt,
          options: input.options,
          correctKeys: input.correctKeys,
          explanation: input.explanation ?? null,
          points: input.points,
          active: input.active,
          updatedAt: new Date(),
        };
        if (input.id) {
          await tx.update(inductionQuestions).set(values).where(eq(inductionQuestions.id, input.id));
          return { id: input.id };
        }
        const [row] = await tx.insert(inductionQuestions).values(values).returning();
        return { id: row.id };
      }

      // enrol
      const row = await ensureEnrolment(tx, session.tenantId, input.trackId, input.userId, session.userId);
      return { id: row.id };
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "induction.manage", session.permissions);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const id = url.searchParams.get("id");
    if (!id || !kind) return NextResponse.json({ error: "kind and id required" }, { status: 400 });

    await withTenant(session.tenantId, async (tx) => {
      if (kind === "lesson") await tx.delete(inductionLessons).where(eq(inductionLessons.id, id));
      else if (kind === "question") await tx.delete(inductionQuestions).where(eq(inductionQuestions.id, id));
      else if (kind === "track") await tx.delete(inductionTracks).where(eq(inductionTracks.id, id));
      else if (kind === "enrolment")
        await tx.delete(inductionEnrolments).where(eq(inductionEnrolments.id, id));
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}
