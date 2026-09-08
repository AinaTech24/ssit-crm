"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Mail, MessageCircle, Loader2, Check, Link2, CalendarClock, Receipt, Sheet } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

/**
 * Client-360 actions for the live valuation statement + transparency:
 *   - Download / Email PDF / WhatsApp summary (live valueInvestor)
 *   - Share a login-free live portfolio link via WhatsApp
 *   - Set the auto-statement cadence (off / monthly / quarterly)
 */
export function StatementActions({
  investorId,
  statementCadence = "off",
}: {
  investorId: string;
  statementCadence?: "off" | "monthly" | "quarterly";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | string>(null);
  const [done, setDone] = useState<null | string>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cadence, setCadence] = useState(statementCadence);

  async function send(channel: "email" | "whatsapp") {
    setBusy(channel);
    setErr(null);
    setDone(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/statement/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? `Failed (${res.status})`);
      if (channel === "whatsapp" && j.waUrl) {
        window.open(j.waUrl, "_blank", "noopener");
        setDone("WhatsApp opened");
      } else setDone("Statement emailed");
    } catch (e: any) {
      setErr(e?.message ?? "An error occurred");
    } finally {
      setBusy(null);
    }
  }

  async function sharePortfolio() {
    setBusy("link");
    setErr(null);
    setDone(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/portfolio-link`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? `Failed (${res.status})`);
      if (j.waUrl) {
        window.open(j.waUrl, "_blank", "noopener");
        setDone("Portfolio link shared");
      } else if (j.url) {
        await navigator.clipboard?.writeText(j.url).catch(() => {});
        setDone("Link copied (no phone on file)");
      }
    } catch (e: any) {
      setErr(e?.message ?? "An error occurred");
    } finally {
      setBusy(null);
    }
  }

  async function setStatementCadence(next: "off" | "monthly" | "quarterly") {
    setBusy("cadence");
    setErr(null);
    setDone(null);
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statementCadence: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return setErr(j.error ?? `Failed (${res.status})`);
      }
      setCadence(next);
      setDone(next === "off" ? "Auto-statements off" : `Auto-statement: ${next}`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "An error occurred");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Statements &amp; sharing</h3>
        {done && (
          <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
            <Check className="size-3.5" /> {done}
          </span>
        )}
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Same numbers, two shapes: the PDF is what you send a client, the
            spreadsheet is what gets sorted, filtered and pasted into a model. */}
        <DownloadButton url={`/api/investors/${investorId}/statement/pdf?download=1`} className="btn-secondary text-xs">
          <FileDown className="size-3.5" /> Portfolio PDF
        </DownloadButton>
        <DownloadButton url={`/api/investors/${investorId}/statement/xlsx`} className="btn-secondary text-xs">
          <Sheet className="size-3.5" /> Portfolio Excel
        </DownloadButton>
        <a href={`/dashboard/investors/${investorId}/capital-gains`} className="btn-secondary text-xs">
          <Receipt className="size-3.5" /> Capital gains
        </a>
        <button onClick={() => send("email")} disabled={busy !== null} className="btn-secondary text-xs">
          {busy === "email" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Email PDF
        </button>
        <button onClick={() => send("whatsapp")} disabled={busy !== null} className="btn-secondary text-xs">
          {busy === "whatsapp" ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />} WhatsApp summary
        </button>
        <button onClick={sharePortfolio} disabled={busy !== null} className="btn-secondary text-xs">
          {busy === "link" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Share live portfolio
        </button>
      </div>

      {/* Auto-statement cadence */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <CalendarClock className="size-3.5 text-muted-foreground" />
          Auto-statement
        </span>
        <SelectField
          value={cadence}
          disabled={busy !== null}
          onChange={(e) => setStatementCadence(e.target.value as any)}
          className="w-36"
          size="sm"
        >
          <option value="off">Off</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </SelectField>
        <span className="text-xs text-muted-foreground">
          Email a live portfolio statement automatically on this cadence.
        </span>
      </div>
    </div>
  );
}
