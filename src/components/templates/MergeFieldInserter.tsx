"use client";

/**
 * Merge-field inserter (adopted from Sanchay's "Target Module + User Fields").
 *
 * Pick a target module, then a field — it inserts a correctly-pathed
 * {{module.field}} token into the body and hands back a precise variable
 * declaration (source + type) so the template's variable schema is right at
 * send time (instead of the old guess-from-token-name behaviour).
 */

import { useState } from "react";
import { Braces } from "lucide-react";

export type VarType = "string" | "number" | "currency" | "date" | "boolean" | "url";
export type VarDecl = { key: string; type: VarType; source: string; required: boolean };

type FieldDef = { key: string; label: string; type: VarType };

const MODULES: Array<{ key: string; label: string; fields: FieldDef[] }> = [
  {
    key: "investor",
    label: "Investor (client)",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "pan", label: "PAN", type: "string" },
      { key: "email", label: "Email", type: "string" },
      { key: "phone", label: "Mobile", type: "string" },
      { key: "segment_tag", label: "Segment", type: "string" },
      { key: "aum", label: "Current AUM", type: "currency" },
      { key: "active_sip_amount", label: "Monthly SIP", type: "currency" },
      { key: "kyc_status", label: "KYC status", type: "string" },
      { key: "risk_profile", label: "Risk profile", type: "string" },
      { key: "nominee_name", label: "Nominee name", type: "string" },
      { key: "next_review_at", label: "Next review date", type: "date" },
    ],
  },
  {
    key: "lead",
    label: "Lead",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "phone", label: "Phone", type: "string" },
      { key: "email", label: "Email", type: "string" },
      { key: "stage", label: "Stage", type: "string" },
      { key: "source", label: "Source", type: "string" },
      { key: "owner_name", label: "Owner (RM)", type: "string" },
    ],
  },
  {
    key: "transaction",
    label: "Transaction",
    fields: [
      { key: "scheme_name", label: "Scheme", type: "string" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "units", label: "Units", type: "number" },
      { key: "transaction_date", label: "Date", type: "date" },
      { key: "folio_number", label: "Folio", type: "string" },
    ],
  },
  {
    key: "tenant",
    label: "Firm (tenant)",
    fields: [
      { key: "displayName", label: "Firm name", type: "string" },
      { key: "legalName", label: "Legal name", type: "string" },
      { key: "arn", label: "ARN", type: "string" },
      { key: "principalEuin", label: "EUIN", type: "string" },
    ],
  },
];

export function MergeFieldInserter({ onInsert }: { onInsert: (token: string, decl: VarDecl) => void }) {
  const [mod, setMod] = useState(MODULES[0].key);
  const fields = MODULES.find((m) => m.key === mod)!.fields;

  return (
    <div className="card-surface p-3 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-foreground/80">
        <Braces className="size-3.5 text-brand-cyan" /> Insert merge field
      </span>
      <select value={mod} onChange={(e) => setMod(e.target.value)} className="input-base text-xs w-44">
        {MODULES.map((m) => (
          <option key={m.key} value={m.key}>{m.label}</option>
        ))}
      </select>
      <select
        value=""
        onChange={(e) => {
          const f = fields.find((x) => x.key === e.target.value);
          if (!f) return;
          const path = `${mod}.${f.key}`;
          onInsert(`{{${path}}}`, { key: path, type: f.type, source: path, required: false });
          e.currentTarget.value = "";
        }}
        className="input-base text-xs w-56"
      >
        <option value="">— pick a field to insert —</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <span className="text-[11px] text-muted-foreground">
        inserts e.g. <code className="bg-muted px-1 rounded">{`{{investor.name}}`}</code> + declares it
      </span>
    </div>
  );
}
