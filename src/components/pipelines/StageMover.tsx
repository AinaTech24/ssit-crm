"use client";

/** StageMover — move a lead within (stage) or across (pipeline) the board. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PIPELINES, PIPELINE_KEYS, firstStage, type PipelineKey } from "@/lib/pipelines/config";
import { SelectField } from "@/components/ui/SelectField";

export function StageMover({ leadId, pipeline, stage }: { leadId: string; pipeline: PipelineKey; stage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: any) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/pipeline`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <SelectField value={stage} disabled={busy} onChange={(e) => patch({ pipelineStage: e.target.value })} size="sm" className="flex-1">
        {PIPELINES[pipeline].stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </SelectField>
      <SelectField value={pipeline} disabled={busy} onChange={(e) => { const p = e.target.value as PipelineKey; patch({ pipeline: p, pipelineStage: firstStage(p) }); }} size="sm" className="w-20">
        {PIPELINE_KEYS.map((p) => <option key={p} value={p}>{PIPELINES[p].label.split(" ")[0]}</option>)}
      </SelectField>
      {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
