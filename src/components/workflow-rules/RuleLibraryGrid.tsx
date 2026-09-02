"use client";

/**
 * Rule Library — cards for each predefined rule. "Add to my rules" copies the
 * template into the tenant's workflow_rules (disabled) and opens it in the
 * editor so the owner picks their message template + enables it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PREDEFINED_RULES } from "@/lib/workflow-rules/predefined";

const CATEGORY_TONE: Record<string, string> = {
  SIP: "bg-emerald-50 text-emerald-700",
  Leads: "bg-sky-50 text-sky-700",
  Clients: "bg-violet-50 text-violet-700",
  Service: "bg-amber-50 text-amber-700",
};

export function RuleLibraryGrid() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function activate(key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/workflow-rules/library/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error(j.error ?? "Already added", "Already in your rules");
        return;
      }
      if (!res.ok) {
        toast.error(j.error ?? "Could not add the rule", "Failed");
        return;
      }
      toast.success("Added to your rules — review, pick a template, then enable it.");
      router.push(`/dashboard/workflows/rules/${j.id}`);
    } catch {
      toast.error("Network error — please try again", "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {PREDEFINED_RULES.map((p) => (
        <div key={p.key} className="card-surface p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <span className={`chip ${CATEGORY_TONE[p.category] ?? "bg-secondary text-foreground"}`}>{p.category}</span>
            {p.needsTemplate && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1" title="You'll pick your message template after adding">
                <Sparkles className="size-3" /> needs a template
              </span>
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm">{p.title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{p.description}</p>
          </div>
          <button
            type="button"
            onClick={() => activate(p.key)}
            disabled={busy === p.key}
            className="btn-primary text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {busy === p.key ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add to my rules
          </button>
        </div>
      ))}
    </div>
  );
}
