"use client";

/**
 * Speaker-rota admin for Dhandho: upload the month's Excel sheet, add or replace
 * a single day, and remove a day. Shown only to people with dhandho.manage.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { useToast } from "@/components/ui/Toast";

type ImportResult = { saved: number; unmatched: string[]; skipped: Array<{ row: number; reason: string }> };

export function DhandhoAdmin() {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [date, setDate] = useState("");
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState("");
  const [topic, setTopic] = useState("");

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr("Choose an Excel file first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dhandho/import", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Upload failed (${res.status})`);
        return;
      }
      setResult(j);
      toast.success(`${j.saved} day${j.saved === 1 ? "" : "s"} added to the speaker rota.`, "Rota uploaded");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addOne() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/dhandho", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionDate: date,
          speakerUserId: speakerId || undefined,
          speakerName: speakerId ? undefined : speakerName || undefined,
          topic: topic || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success("Speaker saved for that day.", "Rota updated");
      setDate("");
      setSpeakerId(null);
      setSpeakerName("");
      setTopic("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-sm">Manage the speaker rota</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Upload the month&apos;s sheet once. On each day, 30 minutes before the session, everyone is told who is speaking
          and the speaker gets a reminder of their own — as a pop-up and by email.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium">Upload Excel</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-sm" />
          <button
            onClick={upload}
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload
          </button>
          <a href="/api/dhandho/template" className="text-xs text-brand-cyan hover:underline flex items-center gap-1">
            <Download className="size-3.5" /> Download template
          </a>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Columns: <b>Date</b>, <b>Speaker</b> (name or email), <b>Topic</b> (optional). A date that already has a speaker
          is replaced. Sundays and past dates are skipped.
        </p>
      </div>

      {result && (
        <div className="rounded-md border bg-secondary/40 p-3 text-xs space-y-1">
          <div className="font-medium">{result.saved} day(s) saved.</div>
          {result.unmatched.length > 0 && (
            <div className="text-amber-800">
              Not matched to a CRM user (announced to everyone, but no personal reminder): {result.unmatched.join(", ")}
            </div>
          )}
          {result.skipped.length > 0 && (
            <ul className="text-rose-800 list-disc pl-4">
              {result.skipped.slice(0, 12).map((p, i) => (
                <li key={i}>Row {p.row}: {p.reason}</li>
              ))}
              {result.skipped.length > 12 && <li>…and {result.skipped.length - 12} more</li>}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="text-xs font-medium">Add or change one day</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" />
          <RmSelector
            value={speakerId}
            onChange={setSpeakerId}
            placeholder="Speaker (team member)"
          />
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (optional)"
            maxLength={300}
            className="input-base"
          />
        </div>
        {!speakerId && (
          <input
            value={speakerName}
            onChange={(e) => setSpeakerName(e.target.value)}
            placeholder="…or type a speaker who is not in the CRM"
            maxLength={200}
            className="input-base"
          />
        )}
        <button
          onClick={addOne}
          disabled={busy || !date || (!speakerId && !speakerName.trim())}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          Save day
        </button>
      </div>

      {err && <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-xs">{err}</div>}
    </div>
  );
}

export function DeleteSessionButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      title="Remove this day"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/dhandho/${id}`, { method: "DELETE" });
          if (res.ok) router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="text-muted-foreground hover:text-rose-600 disabled:opacity-50"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
