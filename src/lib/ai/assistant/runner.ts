/**
 * SSIT Assistant — the agentic runner.
 *
 * Runs a bounded tool-use loop against Anthropic Claude: the model answers from
 * the live firm snapshot when it can, and calls our read-only tools (tools.ts)
 * for anything else. Non-streaming per turn (the UI animates its own
 * Thinking → Fetching → Generating phases), so it works reliably behind the
 * proxy. Tool executors each open their own short RLS-scoped read — no long-held
 * transaction spans the multi-round LLM conversation.
 *
 * Only the Anthropic provider gets the tool-using assistant. When the tenant is
 * on Gemini/OpenAI (or no key), `assistantAvailable()` returns false and the
 * caller falls back to the snapshot-grounded, single-shot path.
 */

import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { loadAiConfig } from "@/lib/ai/provider";
import { firmSnapshot } from "@/lib/ai/firm-snapshot";
import { buildSystemPrompt } from "./instructions";
import { ANTHROPIC_TOOLS, runAssistantTool, type AssistantCtx } from "./tools";

const MAX_ROUNDS = 7;
const MAX_TOKENS = 2200;

export async function assistantAvailable(): Promise<boolean> {
  const cfg = await loadAiConfig();
  return cfg.provider === "anthropic" && !!cfg.apiKey;
}

export type AssistantTurn = { role: "user" | "assistant"; content: string };

/**
 * Answer the latest turn. `history` is the conversation so far (last item is the
 * new user message). Returns the assistant's Markdown answer.
 */
export async function runAssistant(opts: {
  ctx: AssistantCtx;
  userName: string;
  roleLabel: string;
  history: AssistantTurn[];
}): Promise<{ text: string; toolsUsed: string[] }> {
  const cfg = await loadAiConfig();
  if (cfg.provider !== "anthropic" || !cfg.apiKey) {
    throw new Error("assistant: not anthropic");
  }
  const client = new Anthropic({ apiKey: cfg.apiKey });
  // Try the reasoning model first; if it errors (e.g. the key/org can't access
  // that model, or an overload), degrade to the fast model rather than falling
  // all the way back to the deterministic answer. Errors are logged so a
  // persistent failure (bad key, model access) is visible in the server logs.
  const modelChain = [cfg.reasoningModel, cfg.fastModel].filter((m, i, arr) => m && arr.indexOf(m) === i);
  async function create(params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">) {
    let lastErr: any;
    for (const model of modelChain) {
      try {
        return await client.messages.create({ ...params, model } as any);
      } catch (e: any) {
        lastErr = e;
        console.error(`[assistant] model ${model} failed (status=${e?.status ?? "?"}): ${e?.message ?? e}`);
      }
    }
    throw lastErr;
  }

  const { snapshot, firmName } = await withTenant(
    opts.ctx.tenantId,
    async (tx) => {
      const snap = await firmSnapshot(tx, opts.ctx.tenantId);
      const r = await tx.execute(sql`SELECT display_name FROM tenants WHERE id = ${opts.ctx.tenantId}::uuid LIMIT 1`);
      return { snapshot: snap, firmName: ((r.rows[0] as any)?.display_name as string) || "your firm" };
    },
    { userId: opts.ctx.userId, branchId: opts.ctx.branchId ?? undefined, roles: opts.ctx.roles }
  );

  const system = buildSystemPrompt({
    userName: opts.userName,
    firmName,
    roleLabel: opts.roleLabel,
    todayLabel: new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    snapshotJson: JSON.stringify(snapshot, null, 2),
  });

  const messages: Anthropic.MessageParam[] = opts.history
    .filter((m) => m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length) return { text: "Hi! Ask me anything about your clients, AUM, SIPs, leads, tasks or business.", toolsUsed: [] };

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await create({
      max_tokens: MAX_TOKENS,
      system,
      tools: ANTHROPIC_TOOLS as any,
      messages,
    });

    const toolUses = res.content.filter((b: any) => b.type === "tool_use") as any[];

    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return { text: text || "I couldn't find an answer for that — try rephrasing?", toolsUsed };
    }

    // Record the assistant's tool-call turn verbatim, then run each tool.
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolsUsed.push(tu.name);
      const out = await runAssistantTool(opts.ctx, tu.name, tu.input);
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(out).slice(0, 12000),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: "I pulled the data but ran out of steps composing the answer — please ask again.", toolsUsed };
}
