/**
 * SSIT CRM Copilot — eval suite (pure, no DB).
 *
 * Guards the safety-critical behaviour that must never regress: the scope gate
 * (off-topic refusals + investment-advice declines), chat-title generation, PII
 * redaction before logging, and the message-drafting templates. DB access is
 * mocked so this runs fast in CI with `vitest run`.
 */

import { describe, it, expect, vi } from "vitest";

// Neutralise the DB layer so importing the engine graph never opens a pool.
vi.mock("@/db/client", () => ({
  withTenant: async () => { throw new Error("no db in unit test"); },
  withSystem: async () => { throw new Error("no db in unit test"); },
  db: {},
  pool: {},
}));

import { classifyScope } from "@/lib/ai/assistant/scope";
import { draftMessage } from "@/lib/ai/assistant/drafts";
import { isHowToQuestion, findHowTo } from "@/lib/ai/assistant/howto";
import { redactPII, normalizeQ } from "@/lib/ai/assistant/learning";
import { suggestTitle } from "@/lib/ai/assistant/engine";

describe("scope gate", () => {
  it("refuses clearly off-topic questions", () => {
    for (const q of ["what is chatgpt?", "who won the match yesterday", "tell me a joke", "what's the weather", "write me python code", "capital of france"]) {
      expect(classifyScope(q)).toBe("out_of_scope");
    }
  });

  it("routes investment advice to the compliant decline", () => {
    for (const q of ["which fund should I buy?", "best mutual fund to invest", "should i sell my holdings", "what's the nifty target tomorrow"]) {
      expect(classifyScope(q)).toBe("investment_advice");
    }
  });

  it("keeps genuine CRM questions in scope", () => {
    for (const q of ["top 10 clients by AUM", "how many clients are KYC pending", "net business this month", "dormant clients", "renewals due in 30 days", "AUM by segment", "draft a whatsapp for a client"]) {
      expect(classifyScope(q)).toBe("in_scope");
    }
  });

  it("defaults ambiguous small talk to in_scope (engine answers it)", () => {
    expect(classifyScope("how are you")).toBe("in_scope");
    expect(classifyScope("hello")).toBe("in_scope");
  });
});

describe("chat title generation", () => {
  it("never titles from a greeting / ack / refusal", () => {
    for (const q of ["hi", "hello there", "thanks a lot", "ok", "cool"]) expect(suggestTitle(q, null)).toBeNull();
    expect(suggestTitle("hi", "greeting")).toBeNull();
    expect(suggestTitle("what is chatgpt?", "refusal")).toBeNull();
  });

  it("titles a real question in sentence case", () => {
    expect(suggestTitle("top 10 clients by AUM", "client_list")).toBe("Top 10 clients by AUM");
    expect(suggestTitle("how many clients are KYC-pending?", "metric")).toBe("How many clients are KYC-pending");
  });
});

describe("PII redaction before logging", () => {
  it("masks PAN, email, phone and aadhaar", () => {
    expect(redactPII("my PAN is ABCDE1234F")).toContain("[pan]");
    expect(redactPII("mail me at a.b@example.com")).toContain("[email]");
    expect(redactPII("call me on 9876543210")).toContain("[phone]");
    expect(redactPII("aadhaar 123412341234 please")).toContain("[aadhaar]");
  });

  it("normalizeQ redacts and lowercases", () => {
    const n = normalizeQ("PAN ABCDE1234F for Rahul");
    expect(n).toContain("[pan]");
    expect(n).toBe(n.toLowerCase());
  });
});

describe("CRM process knowledge (how-to)", () => {
  it("recognises how-to phrasing", () => {
    for (const q of [
      "so i want to create an lead and then convert to client, how should i do this, can you please give me step by step process?",
      "how do i add a client",
      "what's the process for risk profiling",
      "walk me through importing from cams",
      "where do i add a team member",
    ]) {
      expect(isHowToQuestion(q)).toBe(true);
    }
  });

  it("does NOT hijack plain data questions", () => {
    for (const q of ["how many open leads", "top 10 clients by AUM", "net business this month", "how many clients are KYC pending"]) {
      expect(isHowToQuestion(q)).toBe(false);
    }
  });

  it("routes the lead→client question to the conversion guide (not a lead count)", () => {
    const g = findHowTo("so i want to create an lead and then convert to client, how should i do this, can you please give me step by step process?");
    expect(g?.id).toBe("lead_to_client");
    expect(g?.body).toMatch(/PAN is mandatory/i);
    expect(g?.body).toContain("converted");
  });

  it("maps other common asks to the right guide", () => {
    expect(findHowTo("how do i risk profile a client")?.id).toBe("risk_profile");
    expect(findHowTo("how do i import from cams")?.id).toBe("import_rta");
    expect(findHowTo("how do i set up an automation")?.id).toBe("automation");
    expect(findHowTo("how do i fix duplicate clients")?.id).toBe("duplicates");
  });
});

describe("message drafting", () => {
  it("drafts an email SIP reminder carrying the market-risk disclaimer", () => {
    const out = draftMessage("write an email for a sip reminder to Rahul Sharma", { userName: "Priya", firmName: "Acme Wealth" });
    expect(out).toMatch(/Email draft/i);
    expect(out).toContain("Rahul Sharma");
    expect(out).toContain("market risks");
    expect(out).toMatch(/don't send/i);
  });

  it("drafts a WhatsApp birthday wish without a disclaimer", () => {
    const out = draftMessage("draft a whatsapp birthday wish", { userName: "Priya", firmName: "Acme Wealth" });
    expect(out).toMatch(/WhatsApp draft/i);
    expect(out).toMatch(/birthday/i);
    expect(out).not.toContain("market risks");
  });
});
