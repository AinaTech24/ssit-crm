/**
 * Pipeline definitions (Zoho "Multiple Pipelines" parity) — separate sales
 * stage flows for an MFD who also sells insurance. The board reads/writes the
 * leads.pipeline + leads.pipeline_stage columns; the 30-stage blueprint is
 * untouched.
 */

export const PIPELINE_KEYS = ["mf", "insurance", "general"] as const;
export type PipelineKey = (typeof PIPELINE_KEYS)[number];
export type PipelineStage = { key: string; label: string; won?: boolean; lost?: boolean };

export const PIPELINES: Record<PipelineKey, { label: string; stages: PipelineStage[] }> = {
  mf: {
    label: "Mutual Fund",
    stages: [
      { key: "new", label: "New" },
      { key: "contacted", label: "Contacted" },
      { key: "risk_profiled", label: "Risk profiled" },
      { key: "proposal", label: "Proposal sent" },
      { key: "docs", label: "Docs / KYC" },
      { key: "won", label: "Won", won: true },
      { key: "lost", label: "Lost", lost: true },
    ],
  },
  insurance: {
    label: "Insurance",
    stages: [
      { key: "inquiry", label: "New inquiry" },
      { key: "needs_analysis", label: "Needs analysis" },
      { key: "quoted", label: "Quoted" },
      { key: "proposal", label: "Proposal sent" },
      { key: "underwriting", label: "Underwriting" },
      { key: "issued", label: "Issued", won: true },
      { key: "lost", label: "Lost", lost: true },
    ],
  },
  general: {
    label: "General",
    stages: [
      { key: "new", label: "New" },
      { key: "working", label: "Working" },
      { key: "won", label: "Won", won: true },
      { key: "lost", label: "Lost", lost: true },
    ],
  },
};

export const isPipeline = (v: string | undefined): v is PipelineKey => (PIPELINE_KEYS as readonly string[]).includes(v ?? "");
export const firstStage = (p: PipelineKey) => PIPELINES[p].stages[0].key;
