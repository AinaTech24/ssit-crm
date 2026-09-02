"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Copy,
  Check,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Plus,
  X,
  Info,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** A saved password's label only — the plaintext never leaves the server. */
type PwLabel = { label: string };

type Recent = {
  id: string;
  source: string;
  kind: string;
  fileName: string;
  status: string;
  rowsImported: number | null;
  parsedAt: string | null;
  remarks: string | null;
  createdAt: string;
};

type Status = {
  address: string;
  /** Shared address usable by any firm that has registered its sending mailbox. */
  sharedAddress: string;
  sourceAddresses: string[];
  inboundDomain: string;
  inboxReady: boolean;
  /** Every saved password's LABEL for each registrar — never the plaintext. */
  camsPasswords: PwLabel[];
  kfintechPasswords: PwLabel[];
  hasCamsPassword: boolean;
  hasKfintechPassword: boolean;
  verifiedAt: string | null;
  lastReceivedAt: string | null;
  forwardingConfirmCode: string | null;
  forwardingConfirmUrl: string | null;
  forwardingConfirmAt: string | null;
  recent: Recent[];
};

/** Settings card: direct RTA mailback auto-import via email forwarding. */
export function RtaMailbackCard() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"cams" | "kfintech" | null>(null);
  const [copied, setCopied] = useState<"own" | "shared" | null>(null);
  const [rotating, setRotating] = useState(false);
  const [sources, setSources] = useState("");
  const [sourcesDirty, setSourcesDirty] = useState(false);
  // The 15s quiet-refresh below is wired up in a mount-only effect, so its
  // setInterval callback closes over `load` (and therefore `sourcesDirty`) as
  // they were AT MOUNT — frozen at `false` forever. Every tick then evaluated
  // the stale `!false`, so it overwrote whatever the user was mid-typing back
  // to the last-saved list, unconditionally, every 15s (mid-keystroke, or
  // shortly after pasting). A ref always reads the CURRENT value regardless of
  // which render's closure is calling it, so it isn't fooled by that.
  const sourcesDirtyRef = useRef(false);
  function markSourcesDirty(dirty: boolean) {
    sourcesDirtyRef.current = dirty;
    setSourcesDirty(dirty);
  }

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
    try {
      const r = await fetch("/api/integrations/rta-mailback", { cache: "no-store" });
      if (r.ok) {
        const j: Status = await r.json();
        setStatus(j);
        // Don't clobber what the user is mid-way through typing (the card
        // quiet-refreshes every 15s).
        if (!sourcesDirtyRef.current) setSources((j.sourceAddresses ?? []).join(", "));
      }
    } catch {
      /* ignore */
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // Live refresh — pick up "Receiving mail" + new auto-imports without a manual
    // reload (the poller ingests forwarded mail every ~2 min in the background).
    const id = setInterval(() => void load({ quiet: true }), 15_000);
    return () => clearInterval(id);
  }, []);

  async function copyAddress(which: "own" | "shared") {
    const value = which === "own" ? status?.address : status?.sharedAddress;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy the address manually.");
    }
  }

  async function saveSources(e: React.FormEvent) {
    e.preventDefault();
    if (!sourcesDirty) return;
    try {
      const r = await fetch("/api/integrations/rta-mailback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceAddresses: sources.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || "Couldn't save.", "RTA mailback");
        return;
      }
      if (j.warning) toast.error(j.warning, "Address already in use");
      else toast.success("Forwarding mailboxes saved.", "Saved");
      markSourcesDirty(false);
      await load();
    } catch {
      toast.error("Network error — couldn't save.");
    }
  }

  /**
   * Add one labelled password to a registrar's list. The API appends server-
   * side (`camsPasswordsAppend` / `kfintechPasswordsAppend`) rather than the
   * browser resending the full list — the browser never holds a previously-
   * saved entry's plaintext, so it has no way to "resend it unchanged" anyway.
   */
  async function addPassword(source: "cams" | "kfintech", label: string, password: string) {
    if (!password.trim()) {
      toast.error("Enter the password.");
      return;
    }
    setSaving(source);
    try {
      const key = source === "cams" ? "camsPasswordsAppend" : "kfintechPasswordsAppend";
      const r = await fetch("/api/integrations/rta-mailback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: [{ label: label.trim() || undefined, password: password.trim() }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || "Couldn't save.", "RTA mailback");
        return;
      }
      toast.success(`${source === "cams" ? "CAMS" : "KFintech"} password saved.`, "Saved");
      await load();
    } catch {
      toast.error("Network error — couldn't save.");
    } finally {
      setSaving(null);
    }
  }

  /** Remove one saved password by index (0-based, matching display order). */
  async function removePassword(source: "cams" | "kfintech", index: number) {
    if (!confirm("Remove this password? Files that only that subscription can open will start showing as “not ours”.")) return;
    setSaving(source);
    try {
      const key = source === "cams" ? "camsPasswordsRemoveIndex" : "kfintechPasswordsRemoveIndex";
      const r = await fetch("/api/integrations/rta-mailback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: index }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error || "Couldn't remove.", "RTA mailback");
        return;
      }
      toast.success("Password removed.", "Saved");
      await load();
    } catch {
      toast.error("Network error — couldn't remove.");
    } finally {
      setSaving(null);
    }
  }

  async function regenerate() {
    if (!confirm("Rotate to a new forwarding address? You'll need to update the auto-forward rule in your mailbox.")) return;
    setRotating(true);
    try {
      const r = await fetch("/api/integrations/rta-mailback/regenerate", { method: "POST" });
      if (r.ok) {
        toast.success("New address generated — update your forwarding rule.", "Rotated");
        await load();
      } else toast.error("Couldn't rotate the address.");
    } finally {
      setRotating(false);
    }
  }

  const verifiedChip = loading ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  ) : status?.verifiedAt ? (
    <span className="chip text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
      <CheckCircle2 className="size-3" /> Receiving mail
    </span>
  ) : (
    <span className="chip text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Awaiting first forward</span>
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Mail className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">RTA Mailback — Auto-import</h3>
            <p className="text-xs text-muted-foreground">
              Forward your daily CAMS / KFintech mailback email here — we import it automatically.
            </p>
          </div>
        </div>
        {verifiedChip}
      </div>

      {/* Platform inbox not configured yet */}
      {!loading && status && !status.inboxReady && (
        <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>The auto-import inbox is still being set up by SSIT. You can save your passwords now; forwarding will start working once it&apos;s live.</span>
        </div>
      )}

      {/* Forwarding confirmation code captured from Gmail/Outlook */}
      {!loading && status?.forwardingConfirmCode && (
        <div className="flex items-start gap-2 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-800 px-3 py-2">
          <ShieldCheck className="size-3.5 mt-0.5 shrink-0" />
          <span>
            Forwarding confirmation received — code{" "}
            <strong className="tabular-nums">{status.forwardingConfirmCode}</strong>.
            {status.forwardingConfirmUrl && (
              <>
                {" "}
                <a href={status.forwardingConfirmUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Open confirmation link
                </a>
                .
              </>
            )}{" "}
            Enter the code (or click the link) in your mailbox to activate forwarding.
          </span>
        </div>
      )}

      {/* The unique forward address */}
      {!loading && status && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Your forwarding address <span className="text-emerald-700">· recommended</span>
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-secondary/60 border border-border rounded-lg px-3 py-2 font-mono break-all">
                {status.address}
              </code>
              <button onClick={() => copyAddress("own")} className="btn-secondary text-xs shrink-0" title="Copy address">
                {copied === "own" ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Unique to your firm — routes on its own, nothing else to set up.
            </p>
          </div>

          {/* Shared address — works only for registered sending mailboxes. */}
          <form onSubmit={saveSources} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Or use the shared address</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-secondary/60 border border-border rounded-lg px-3 py-2 font-mono break-all">
                {status.sharedAddress}
              </code>
              <button type="button" onClick={() => copyAddress("shared")} className="btn-secondary text-xs shrink-0" title="Copy address">
                {copied === "shared" ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <label className="text-[11px] text-muted-foreground block pt-1">
              To use it, register the mailbox(es) you forward <strong>from</strong> — that&apos;s how we know the mail is
              yours. Comma-separated.
            </label>
            <div className="flex items-center gap-2">
              <input
                value={sources}
                onChange={(e) => {
                  setSources(e.target.value);
                  markSourcesDirty(true);
                }}
                placeholder="you@yourfirm.com, ops@yourfirm.com"
                className="input-base text-sm flex-1"
              />
              {sourcesDirty && (
                <button type="submit" className="btn-secondary text-xs shrink-0">
                  Save
                </button>
              )}
            </div>
            {status.sourceAddresses?.length > 0 && !sourcesDirty && (
              <p className="text-[11px] text-emerald-700">
                {status.sourceAddresses.length} mailbox{status.sourceAddresses.length > 1 ? "es" : ""} registered — the
                shared address will route mail from {status.sourceAddresses.length > 1 ? "them" : "it"}.
              </p>
            )}
          </form>

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {status.lastReceivedAt
                ? `Last mail received ${new Date(status.lastReceivedAt).toLocaleString("en-IN")}`
                : "No mail received yet."}
            </p>
            <button onClick={regenerate} disabled={rotating} className="btn-ghost text-[11px] disabled:opacity-60">
              {rotating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Rotate
            </button>
          </div>
        </div>
      )}

      {/* Passwords */}
      {!loading && status && (
        <div className="space-y-4 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
            <Info className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              Enter the ZIP password you set with each RTA when subscribing to their mailback — stored encrypted. If your
              firm runs <strong>more than one ARN</strong>, each mailback subscription can have its own password: add every
              one below and we try them all on each incoming file, so nothing from your own ARNs gets missed.
            </span>
          </p>
          <PasswordManager
            source="cams"
            title="CAMS"
            entries={status.camsPasswords}
            saving={saving === "cams"}
            onAdd={(label, password) => addPassword("cams", label, password)}
            onRemove={(i) => removePassword("cams", i)}
          />
          <PasswordManager
            source="kfintech"
            title="KFintech"
            entries={status.kfintechPasswords}
            saving={saving === "kfintech"}
            onAdd={(label, password) => addPassword("kfintech", label, password)}
            onRemove={(i) => removePassword("kfintech", i)}
          />
        </div>
      )}

      {/* Setup steps */}
      {!loading && status && (
        <details className="border-t border-border pt-3 group">
          <summary className="text-xs font-medium cursor-pointer select-none text-foreground">How to set this up</summary>
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="tabular-nums">1.</span>
              <span>Subscribe to the daily mailback with <strong>CAMS</strong> and <strong>KFintech</strong> (set a ZIP password with each) — enter those passwords above.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">2.</span>
              <span>In your mailbox (Gmail / Outlook), add an <strong>auto-forward</strong> rule sending the RTA mailback emails to <code className="font-mono">{status.address}</code>.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">3.</span>
              <span>Your mailbox will ask to confirm forwarding — we auto-capture the code and show it here. Confirm it once.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">4.</span>
              <span>Done. Each day&apos;s file imports automatically — transactions, folios, AUM and brokerage flow straight into your CRM.</span>
            </li>
          </ol>
        </details>
      )}

      {/* Recent auto-imports */}
      {!loading && status && status.recent.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Recent auto-imports</div>
          <ul className="space-y-1">
            {status.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate flex-1">
                  <span className="font-mono">{r.source.toUpperCase()}</span> · {r.kind.replace(/_/g, " ")} · <span className="text-muted-foreground">{r.fileName}</span>
                </span>
                <span
                  className={`chip text-[10px] shrink-0 ${
                    r.status === "completed"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : r.status === "partial"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : // "rejected" = another platform's archive arriving at the
                          // same address. Not a fault, so it stays neutral.
                          r.status === "rejected"
                          ? "bg-secondary text-muted-foreground border border-border"
                          : r.status === "failed"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-secondary text-muted-foreground border border-border"
                  }`}
                >
                  {r.status === "rejected" ? "not ours" : r.status}
                  {r.status !== "rejected" && r.rowsImported != null ? ` · ${r.rowsImported}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One registrar's list of saved passwords, each shown as a label + "saved"
 * chip + remove button, plus a compact add-entry form.
 *
 * Deliberately supports MULTIPLE entries, not one: a firm with more than one
 * ARN registers a separate mailback subscription — and often a separate ZIP
 * password — per ARN. The import pipeline tries every entry here in order, so
 * adding a second ARN's password is the whole fix; nothing else to configure.
 */
function PasswordManager({
  source,
  title,
  entries,
  saving,
  onAdd,
  onRemove,
}: {
  source: "cams" | "kfintech";
  title: string;
  entries: PwLabel[];
  saving: boolean;
  onAdd: (label: string, password: string) => void;
  onRemove: (index: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    onAdd(label, password);
    setLabel("");
    setPassword("");
    setAdding(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{title} password{entries.length > 1 ? "s" : ""}</label>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] text-brand-cyan-deep hover:underline inline-flex items-center gap-1"
          >
            <Plus className="size-3" /> {entries.length ? "Add another (e.g. a second ARN)" : "Add password"}
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e, i) => (
            <li
              key={`${e.label}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5"
            >
              <span className="text-xs flex items-center gap-1.5 min-w-0">
                <KeyRound className="size-3 text-muted-foreground shrink-0" />
                <span className="truncate">{e.label}</span>
                <span className="chip text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">saved</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={saving}
                className="text-muted-foreground hover:text-rose-600 disabled:opacity-50 shrink-0"
                title="Remove this password"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {entries.length === 0 && !adding && (
        <p className="text-[11px] text-muted-foreground">No password saved yet.</p>
      )}

      {adding && (
        <form onSubmit={submit} className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] text-muted-foreground">Label (optional)</label>
            <input
              value={label}
              onChange={(ev) => setLabel(ev.target.value)}
              placeholder={entries.length ? "e.g. ARN-9981" : "e.g. Primary"}
              className="input-base text-sm w-full"
              autoFocus
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] text-muted-foreground">{title} ZIP password</label>
            <PasswordInput
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              placeholder={`${title} ZIP password`}
              className="input-base text-sm w-full"
            />
          </div>
          <button type="submit" disabled={saving || !password.trim()} className="btn-primary text-xs disabled:opacity-60">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setLabel("");
              setPassword("");
            }}
            className="btn-ghost text-xs"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
