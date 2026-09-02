"use client";

/**
 * Read-only-ish claim document checklist + manager for a single insurance claim.
 * Renders an expected-document checklist (✓ present / ✗ missing), the current
 * documents list, and an "add document" row (name + docType + URL paste).
 * Add/remove PATCHes the full `documents` array back to the claim API.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Loader2, Plus, Trash2, Paperclip } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type ClaimDoc = { name: string; docType?: string; url?: string; uploadedAt?: string };

/** Default checklist of expected documents per claim. Death/life claims get the
 *  estate-specific extras appended. Each entry's `key` is the stored `docType`. */
const BASE_CHECKLIST: { key: string; label: string }[] = [
  { key: "claim_form", label: "Claim form" },
  { key: "hospital_bills", label: "Hospital bills / Final bill" },
  { key: "discharge_summary", label: "Discharge summary" },
  { key: "kyc", label: "KYC (PAN / Aadhaar)" },
  { key: "bank_proof", label: "Bank proof / Cancelled cheque" },
  { key: "policy_copy", label: "Policy copy" },
];

const DEATH_CHECKLIST: { key: string; label: string }[] = [
  { key: "death_certificate", label: "Death certificate" },
  { key: "nominee_kyc", label: "Nominee KYC" },
];

function checklistFor(claimType?: string): { key: string; label: string }[] {
  // Life / death-style claims (rider claims on life policies, "other") get the
  // estate docs too. We can't perfectly infer life vs health from claimType, so
  // include the death docs for rider/other where a life payout is plausible.
  const wantsDeath = claimType === "rider" || claimType === "other";
  return wantsDeath ? [...BASE_CHECKLIST, ...DEATH_CHECKLIST] : BASE_CHECKLIST;
}

export function ClaimDocuments({
  claimId,
  initialDocuments,
  claimType,
}: {
  claimId: string;
  initialDocuments: ClaimDoc[];
  claimType?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<ClaimDoc[]>(initialDocuments ?? []);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const checklist = checklistFor(claimType);
  const present = new Set(docs.map((d) => d.docType).filter(Boolean) as string[]);

  async function persist(next: ClaimDoc[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/insurance-claims/${claimId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documents: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Save failed");
      }
      setDocs(next);
      router.refresh();
      return true;
    } catch (e: any) {
      toast.error(e.message ?? "Could not update documents", "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addDoc() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warning("Give the document a name first.");
      return;
    }
    const next: ClaimDoc[] = [
      ...docs,
      {
        name: trimmed,
        docType: docType || undefined,
        url: url.trim() || undefined,
        uploadedAt: new Date().toISOString(),
      },
    ];
    if (await persist(next)) {
      setName("");
      setDocType("");
      setUrl("");
      toast.success("Document added.");
    }
  }

  async function removeDoc(i: number) {
    const next = docs.filter((_, idx) => idx !== i);
    if (await persist(next)) toast.success("Document removed.");
  }

  const docTypeLabel = (k?: string) =>
    checklist.find((c) => c.key === k)?.label ?? (k ? k.replace(/_/g, " ") : "");

  return (
    <div className="card-surface p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
          <Paperclip className="size-3.5 text-brand-cyan-deep" />
        </div>
        <h2 className="section-title">Documents</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          {present.size}/{checklist.length} required on file
        </span>
      </div>

      {/* Checklist */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {checklist.map((item) => {
          const have = present.has(item.key);
          return (
            <li
              key={item.key}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                have
                  ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
                  : "border-border/70 bg-background text-muted-foreground"
              }`}
            >
              {have ? (
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
              ) : (
                <Circle className="size-4 text-muted-foreground/50 shrink-0" />
              )}
              <span className={have ? "font-medium" : ""}>{item.label}</span>
            </li>
          );
        })}
      </ul>

      {/* Current documents */}
      {docs.length > 0 && (
        <ul className="space-y-2 mb-4">
          {docs.map((d, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
            >
              <Paperclip className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{d.name}</div>
                {(d.docType || d.uploadedAt) && (
                  <div className="text-[11px] text-muted-foreground">
                    {d.docType ? docTypeLabel(d.docType) : ""}
                    {d.docType && d.uploadedAt ? " · " : ""}
                    {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : ""}
                  </div>
                )}
              </div>
              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-cyan-deep hover:underline text-xs flex items-center gap-1 shrink-0"
                >
                  Open <ExternalLink className="size-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => removeDoc(i)}
                disabled={busy}
                className="text-muted-foreground hover:text-rose-600 shrink-0 disabled:opacity-50"
                aria-label="Remove document"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add document */}
      <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div className="sm:col-span-4">
            <div className="text-[11px] font-medium mb-1 text-muted-foreground">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Final hospital bill"
              className="input-base"
            />
          </div>
          <div className="sm:col-span-3">
            <div className="text-[11px] font-medium mb-1 text-muted-foreground">Type</div>
            <SelectField value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Type…">
              <option value="">— type —</option>
              {checklist.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              <option value="other">Other</option>
            </SelectField>
          </div>
          <div className="sm:col-span-3">
            <div className="text-[11px] font-medium mb-1 text-muted-foreground">URL</div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="input-base"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={addDoc}
              disabled={busy || !name.trim()}
              className="btn-primary w-full justify-center"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
