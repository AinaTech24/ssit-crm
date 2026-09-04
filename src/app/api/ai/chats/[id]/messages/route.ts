import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/ai/chats/[id]/messages  — the conversation
 * POST /api/ai/chats/[id]/messages  — send a message (or regenerate the last
 *   answer). The reply is grounded ONLY in a live, RLS-scoped metric snapshot
 *   (the model never writes SQL and cannot mutate anything — strictly read-only,
 *   CRM-scoped). Both turns are persisted.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { aiChats, aiChatMessages } from "@/db/schema";
import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";
import { firmSnapshot, assistantSystemPrompt, type FirmSnapshot } from "@/lib/ai/firm-snapshot";
import { assistantAvailable, runAssistant } from "@/lib/ai/assistant/runner";
import { answerLocally, suggestTitle } from "@/lib/ai/assistant/engine";
import { findLearnedIntent, logInteractions, type LogRow } from "@/lib/ai/assistant/learning";

export const dynamic = "force-dynamic";

const Body = z.object({
  content: z.string().min(1).max(2000).optional(),
  model: z.enum(["fast", "reasoning"]).optional(),
  regenerate: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => {
      const [chat] = await tx
        .select({ id: aiChats.id, title: aiChats.title, model: aiChats.model, archivedAt: aiChats.archivedAt })
        .from(aiChats)
        .where(and(eq(aiChats.id, id), eq(aiChats.userId, session.userId)))
        .limit(1);
      if (!chat) return null;
      const messages = await tx
        .select()
        .from(aiChatMessages)
        .where(eq(aiChatMessages.chatId, id))
        .orderBy(asc(aiChatMessages.createdAt))
        .limit(500);
      return { chat, messages };
    });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { model = "reasoning", regenerate } = parse.data;

    // ── Phase 1 (short tx): ownership, resolve the prompt, persist the user turn,
    // compute the live snapshot, and read back the conversation history. ──────
    const prep = await withTenant(session.tenantId, async (tx) => {
      const [chat] = await tx
        .select({ id: aiChats.id, title: aiChats.title })
        .from(aiChats)
        .where(and(eq(aiChats.id, id), eq(aiChats.userId, session.userId)))
        .limit(1);
      if (!chat) return { notFound: true as const };

      let prompt = (parse.data.content ?? "").trim();
      if (regenerate) {
        const recent = await tx
          .select()
          .from(aiChatMessages)
          .where(eq(aiChatMessages.chatId, id))
          .orderBy(desc(aiChatMessages.createdAt))
          .limit(2);
        const last = recent[0];
        if (last?.role === "assistant") {
          await tx.delete(aiChatMessages).where(eq(aiChatMessages.id, last.id));
        }
        const lastUser = recent.find((m) => m.role === "user") ?? last;
        prompt = lastUser?.content ?? prompt;
      }
      if (!prompt) return { badRequest: true as const };

      if (!regenerate) {
        await tx.insert(aiChatMessages).values({
          tenantId: session.tenantId,
          chatId: id,
          role: "user",
          content: prompt,
        } as any);
      }

      const snapshot = await firmSnapshot(tx, session.tenantId);
      const fr = await tx.execute(sql`SELECT display_name FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1`);
      const firmName = ((fr.rows[0] as any)?.display_name as string) || "your firm";

      const persisted = await tx
        .select({ role: aiChatMessages.role, content: aiChatMessages.content })
        .from(aiChatMessages)
        .where(eq(aiChatMessages.chatId, id))
        .orderBy(asc(aiChatMessages.createdAt))
        .limit(500);
      const history = persisted
        .slice(-16)
        .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content }));

      return { chat, prompt, snapshot, history, firmName };
    });

    if ((prep as any)?.notFound) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ((prep as any)?.badRequest) return NextResponse.json({ error: "empty message" }, { status: 400 });
    const { chat, prompt, snapshot, history, firmName } = prep as Extract<typeof prep, { snapshot: FirmSnapshot }>;

    const ctx = { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles };
    const userName = (session.name ?? "there").split(" ")[0];

    // ── Phase 2 (NO open tx): answer the message. The LOCAL engine handles the
    // common questions on our own server (free, private, reliable). Only when it
    // can't fully parse a question do we optionally hand off to an external LLM;
    // if that's unavailable/fails, the engine's best-effort still answers. ─────
    let answer = "";
    let answerTitle: string | null = null;
    const logRows: LogRow[] = [];
    try {
      const local = await answerLocally(ctx, {
        question: prompt,
        userName,
        firmName,
        snapshot,
        learnedIntent: (part) => findLearnedIntent(ctx, part),
      });
      logRows.push(...local.log);
      answerTitle = local.title;
      if (local.handled) {
        answer = local.text;
      } else {
        // The engine couldn't fully handle it — try the optional external LLM.
        if (await assistantAvailable()) {
          try {
            const out = await runAssistant({
              ctx,
              userName,
              roleLabel: (session.roles?.[0] ?? "team member").replace(/_/g, " "),
              history,
            });
            answer = out.text;
            if (answer) logRows.push({ question: prompt, handled: true, intent: null, source: "llm" });
          } catch (e: any) {
            console.error("[assistant] llm failed:", e?.status ?? "", e?.message ?? e);
          }
        } else if (await isAiConfigured()) {
          try {
            const res = await aiMessagesClient().messages.create({
              model,
              max_tokens: 1400,
              system: assistantSystemPrompt(snapshot),
              messages: history.length ? history : [{ role: "user", content: prompt }],
            });
            answer = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
          } catch (e: any) {
            console.error("[assistant] provider failed:", e?.status ?? "", e?.message ?? e);
          }
        }
        // Nothing external answered → fall back to the engine's own reply.
        if (!answer) answer = local.text;
      }
    } catch (e: any) {
      console.error("[assistant] generation failed:", e?.status ?? "", e?.message ?? e);
      /* fall through to deterministic */
    }
    if (!answer) answer = deterministicMarkdown(prompt, snapshot, await isAiConfigured());

    // Record this turn in the copilot's learning memory (self-safe; never blocks).
    await logInteractions(ctx, logRows);

    // ── Phase 3 (short tx): persist the assistant turn + bump the chat. ───────
    const result = await withTenant(session.tenantId, async (tx) => {
      const [asst] = await tx
        .insert(aiChatMessages)
        .values({
          tenantId: session.tenantId,
          chatId: id,
          role: "assistant",
          content: answer,
          metrics: snapshot as any,
          model,
        } as any)
        .returning();

      // Auto-title from the first substantive question — never the raw greeting
      // ("hi" stays "New chat" until a real question arrives).
      const generated = answerTitle ?? suggestTitle(prompt, null);
      const title = chat.title === "New chat" ? (generated ?? chat.title) : chat.title;
      await tx
        .update(aiChats)
        .set({ title, model, lastMessageAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(aiChats.id, id));

      return { message: asst, title };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const inr = (n: any) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** Real-data Markdown answer when the LLM is unavailable — keyword-matched to the
 *  question, always grounded in the live snapshot. */
function deterministicMarkdown(question: string, s: FirmSnapshot, configured: boolean): string {
  const q = question.toLowerCase();
  const has = (...k: string[]) => k.some((x) => q.includes(x));
  const note = configured ? "" : "\n\n_AI model isn't configured yet — showing live figures straight from your data. Ask your admin to set it in Equitywala Admin → AI & Models._";

  if (has("aum", "assets under")) {
    if (has("rm", "manager")) {
      const rows = (s.aum_by_rm ?? []).map((r) => `| ${r.rm} | ${inr(r.aum_inr)} | ${r.clients} |`).join("\n");
      return `**AUM by RM**\n\n| RM | AUM | Clients |\n| --- | ---: | ---: |\n${rows || "| — | — | — |"}\n\n[Open Business MIS](/dashboard/reports/business-mis)${note}`;
    }
    return `Your total **AUM is ${inr(s.total_aum_inr)}** across **${s.active_clients}** active clients (avg ${inr(s.avg_aum_per_client_inr)} per client). [Open Clients](/dashboard/investors)${note}`;
  }
  if (has("top", "biggest", "largest")) {
    const rows = (s.top_clients_by_aum ?? []).map((t, i) => `| ${i + 1} | ${t.name} | ${inr(t.aum_inr)} |`).join("\n");
    return `**Top clients by AUM**\n\n| # | Client | AUM |\n| ---: | --- | ---: |\n${rows || "| — | — | — |"}\n\n[Open Clients](/dashboard/investors)${note}`;
  }
  if (has("kyc")) {
    const rows = (s.kyc_status_breakdown ?? []).map((k) => `| ${k.status} | ${k.clients} |`).join("\n");
    return `**${s.kyc_pending_clients}** clients are KYC-pending.\n\n| KYC status | Clients |\n| --- | ---: |\n${rows}\n\n[Open KYC tracker](/dashboard/reports/kyc-tracker)${note}`;
  }
  if (has("sip")) return `You have **${s.active_sips}** active SIPs — a monthly SIP book of **${inr(s.monthly_sip_book_inr)}**. [Open SIPs](/dashboard/sips)${note}`;
  if (has("nominee")) return `**${s.clients_without_nominee}** clients have no nominee on file. [Open Nominee tracker](/dashboard/reports/nomination-tracker)${note}`;
  if (has("dormant")) return `**${s.dormant_clients}** clients are dormant (no transaction in ${s.dormancy_window_days} days). [Open Churn risk](/dashboard/reports/churn-risk)${note}`;
  if (has("lead")) return `**${s.open_leads}** open leads in the pipeline. [Open Leads](/dashboard/leads)${note}`;
  if (has("task")) return `**${s.open_tasks}** open tasks (${s.overdue_tasks} overdue). [Open Tasks](/dashboard/tasks)${note}`;
  if (has("insurance", "policy", "policies")) return `**${s.active_insurance_policies}** active policies — ${inr(s.active_insurance_annual_premium_inr)} annual premium. [Open Insurance](/dashboard/insurance)${note}`;
  if (has("meeting")) return `**${s.upcoming_meetings}** upcoming meetings scheduled. [Open Meetings](/dashboard/review-meetings)${note}`;
  if (has("new", "this month")) return `**${s.new_clients_this_month}** new clients this month (${s.new_clients_last_30d} in the last 30 days). [Open Clients](/dashboard/investors)${note}`;

  return `**Your firm right now**\n\n| Metric | Value |\n| --- | ---: |\n| Active clients | ${s.active_clients} |\n| Total AUM | ${inr(s.total_aum_inr)} |\n| Monthly SIP book | ${inr(s.monthly_sip_book_inr)} |\n| Active SIPs | ${s.active_sips} |\n| Open leads | ${s.open_leads} |\n| Open tasks | ${s.open_tasks} (${s.overdue_tasks} overdue) |\n| KYC pending | ${s.kyc_pending_clients} |\n\nAsk me about AUM, top clients, KYC, SIPs, dormant clients, leads, tasks, insurance and more.${note}`;
}
