"use client";

/**
 * White-label URL settings — claim a vanity subdomain (<firm>.crm.equitywala.com)
 * and/or point the firm's own domain (crm.yourfirm.in) at the CRM. Reads/writes
 * /api/tenant/domain. Owner-only (the page already gates on settings.users).
 */

import { useEffect, useState } from "react";
import { Globe, Loader2, CheckCircle2, ExternalLink, Copy, Check, ShieldCheck } from "lucide-react";

type DomainState = {
  baseDomain: string;
  subdomain: string | null;
  subdomainHost: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
  cnameTarget: string;
};

export function DomainSettings() {
  const [d, setD] = useState<DomainState | null>(null);
  const [sub, setSub] = useState("");
  const [dom, setDom] = useState("");
  const [busy, setBusy] = useState<"" | "sub" | "dom" | "verify">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const r = await fetch("/api/tenant/domain").then((x) => x.json()).catch(() => null);
    if (r?.baseDomain) { setD(r); setSub(r.subdomain ?? ""); setDom(r.customDomain ?? ""); }
  }
  useEffect(() => { load(); }, []);

  async function patch(body: any, which: "sub" | "dom" | "verify") {
    setBusy(which); setMsg(null);
    try {
      const r = await fetch("/api/tenant/domain", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
      if (which === "verify") setMsg({ ok: j.verified, text: j.message ?? (j.verified ? "Verified." : "Not verified yet.") });
      else setMsg({ ok: true, text: "Saved." });
      await load();
    } finally { setBusy(""); }
  }

  if (!d) return null;
  const base = d.baseDomain;

  return (
    <div className="border rounded-lg bg-card p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Globe className="size-5 text-brand-cyan" />
        <div>
          <h2 className="font-semibold">White-label URL</h2>
          <p className="text-xs text-muted-foreground">Serve the CRM on your own branded address. Your firm's logo &amp; colours already carry through.</p>
        </div>
      </div>

      {msg && (
        <div className={`text-xs rounded-md px-3 py-2 border ${msg.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>{msg.text}</div>
      )}

      {/* Vanity subdomain */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vanity subdomain</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={sub} onChange={(e) => setSub(e.target.value.toLowerCase())} placeholder="wecare" className="input-base w-40" />
          <span className="text-sm text-muted-foreground font-mono">.{base}</span>
          <button onClick={() => patch({ subdomain: sub }, "sub")} disabled={busy !== ""} className="btn-primary text-xs inline-flex items-center gap-1">
            {busy === "sub" ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
          </button>
          {d.subdomainHost && (
            <a href={`https://${d.subdomainHost}`} target="_blank" rel="noreferrer" className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
              Open <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">3–40 letters, numbers or hyphens. Available once DNS is configured for <span className="font-mono">*.{base}</span>.</p>
      </div>

      {/* Custom domain */}
      <div className="space-y-2 pt-2 border-t">
        <div className="flex items-center gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your own domain</div>
          {d.customDomain && (d.customDomainVerified
            ? <span className="chip text-[10px] bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><ShieldCheck className="size-3" /> Verified</span>
            : <span className="chip text-[10px] bg-amber-100 text-amber-700">Pending DNS</span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={dom} onChange={(e) => setDom(e.target.value.toLowerCase())} placeholder="crm.yourfirm.in" className="input-base w-64" />
          <button onClick={() => patch({ customDomain: dom }, "dom")} disabled={busy !== ""} className="btn-primary text-xs inline-flex items-center gap-1">
            {busy === "dom" ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
          </button>
          {d.customDomain && !d.customDomainVerified && (
            <button onClick={() => patch({ action: "verify" }, "verify")} disabled={busy !== ""} className="btn-secondary text-xs inline-flex items-center gap-1">
              {busy === "verify" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Verify DNS
            </button>
          )}
        </div>
        {d.customDomain && (
          <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-3 space-y-1">
            <div className="font-semibold text-foreground">DNS setup</div>
            <div>At your domain registrar, add a <span className="font-mono">CNAME</span> record:</div>
            <div className="flex items-center gap-2 font-mono">
              <span className="text-foreground">{d.customDomain}</span> <span>→</span>
              <span className="text-foreground">{d.cnameTarget}</span>
              <button onClick={() => { navigator.clipboard.writeText(d.cnameTarget); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-brand-cyan-deep">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </button>
            </div>
            <div>HTTPS is issued automatically the first time the domain loads (may take a few minutes after DNS propagates).</div>
          </div>
        )}
      </div>
    </div>
  );
}
