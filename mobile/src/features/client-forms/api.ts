/**
 * Client forms — "send the client something to fill in", from the field.
 *
 * POST /api/client-forms/send mints the login-free link and delivers it by
 * WhatsApp + email through the comms pipeline. Because the pipeline is consent
 * and session gated, a proactive WhatsApp can legitimately be skipped (Meta's
 * 24h rule) — so the response always carries `waMeUrl`, letting the RM send from
 * their own WhatsApp instead of hitting a dead end.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { FeatherName } from "../calculators/types";

export type FormKind = "risk_profile" | "document_collection" | "financial_discovery" | "portfolio_view";

export interface SendFormResult {
  ok: boolean;
  kind: FormKind;
  label: string;
  url: string;
  waMeUrl: string | null;
  summary: string;
  emailed: boolean;
  whatsapped: boolean;
  waStatus: string;
  /** Set when a WhatsApp template was auto-provisioned so future sends deliver. */
  templateNote?: string;
  emailError?: string;
}

export interface SendFormBody {
  subjectType: "investor" | "lead";
  subjectId: string;
  kind: FormKind;
  channel?: "whatsapp" | "email" | "both";
}

export function useSendClientForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: SendFormBody) => api.post<SendFormResult>("/api/client-forms/send", b),
    onSuccess: () => {
      // The send lands a communications row + may advance the lead blueprint.
      qc.invalidateQueries({ queryKey: ["activity-timeline"] });
      qc.invalidateQueries({ queryKey: ["investor"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
    },
  });
}

/** What an RM can send, in the order they'd reach for it. */
export const CLIENT_FORMS: { kind: FormKind; label: string; blurb: string; icon: FeatherName }[] = [
  { kind: "risk_profile", label: "Risk profile", blurb: "SEBI questionnaire — needed before you recommend", icon: "shield" },
  { kind: "document_collection", label: "KYC / documents", blurb: "Client uploads PAN, Aadhaar, bank proof", icon: "upload" },
  { kind: "financial_discovery", label: "Financial health check", blurb: "Short fact-find before a meeting", icon: "clipboard" },
  { kind: "portfolio_view", label: "Portfolio link", blurb: "Login-free read-only view of holdings", icon: "pie-chart" },
];
