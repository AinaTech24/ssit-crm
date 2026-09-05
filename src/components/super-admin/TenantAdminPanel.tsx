"use client";

/**
 * Platform-admin account controls for a single tenant:
 *   · view / update the contact email
 *   · send the tenant owner a password-reset link
 *   · delete the tenant (soft delete, typed-ARN confirmation)
 *
 * Lives below the tenant detail header. Uses inline status messages (the
 * super-admin shell doesn't mount the toast provider).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, KeyRound, Trash2, Loader2, Check, AlertTriangle, Building2, UserCog } from "lucide-react";

export function TenantAdminPanel({
  tenantId,
  currentEmail,
  arn,
  legalName,
  displayName,
  ownerName,
  ownerEmail,
}: {
  tenantId: string;
  currentEmail: string | null;
  arn: string | null;
  legalName: string;
  displayName: string;
  ownerName: string;
  ownerEmail: string;
}) {
  const router = useRouter();

  // Editable firm identity (brand name + ARN). ARN is optional.
  const [name, setName] = useState(displayName ?? "");
  const [arnValue, setArnValue] = useState(arn ?? "");
  const [firmBusy, setFirmBusy] = useState(false);
  const [firmMsg, setFirmMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Editable owner user (name + login email).
  const [ownName, setOwnName] = useState(ownerName ?? "");
  const [ownEmail, setOwnEmail] = useState(ownerEmail ?? "");
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerMsg, setOwnerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Editable subscription (package + billing cycle).

  async function patch(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, error: j?.error };
  }

  async function saveOwner() {
    setOwnerBusy(true);
    setOwnerMsg(null);
    try {
      const r = await patch({ ownerName: ownName.trim(), ownerEmail: ownEmail.trim() });
      setOwnerMsg(r.ok ? { ok: true, text: "Owner updated." } : { ok: false, text: r.error ?? "Could not update owner" });
      if (r.ok) router.refresh();
    } finally {
      setOwnerBusy(false);
    }
  }

  const [email, setEmail] = useState(currentEmail ?? "");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmArn, setConfirmArn] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);

  async function saveFirm() {
    setFirmBusy(true);
    setFirmMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), legalName: name.trim(), arn: arnValue.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFirmMsg({ ok: false, text: j.error ?? "Could not update firm details" });
        return;
      }
      setFirmMsg({ ok: true, text: "Firm details updated." });
      router.refresh();
    } finally {
      setFirmBusy(false);
    }
  }

  async function saveEmail() {
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailMsg({ ok: false, text: j.error ?? "Could not update email" });
        return;
      }
      setEmailMsg({ ok: true, text: email.trim() ? "Contact email updated." : "Contact email cleared." });
      router.refresh();
    } finally {
      setEmailBusy(false);
    }
  }

  async function resetPassword() {
    setResetBusy(true);
    setResetMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/reset-password`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetMsg({ ok: false, text: j.error ?? "Could not send reset link" });
        return;
      }
      setResetMsg({
        ok: true,
        text: `Reset link sent to ${j.sentTo}${j.emailSent === false ? " (email delivery not configured — check server logs)" : ""}.`,
      });
    } finally {
      setResetBusy(false);
    }
  }

  async function deleteTenant() {
    setDelBusy(true);
    setDelMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmArn: confirmArn.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDelMsg(j.error ?? "Could not delete tenant");
        return;
      }
      router.push("/super-admin/tenants");
      router.refresh();
    } finally {
      setDelBusy(false);
    }
  }

  // Confirmation accepts the ARN or, for ARN-less firms, the firm name.
  const confirmToken = arn && arn.trim() ? arn : displayName || legalName;
  const acceptedConfirms = [arn, displayName, legalName].filter(Boolean).map((v) => String(v).toLowerCase());
  const armed = acceptedConfirms.includes(confirmArn.trim().toLowerCase());

  return (
    <div className="border rounded-lg bg-card p-5 space-y-5">
      <h2 className="font-semibold">Account administration</h2>

      {/* Firm details — brand name + ARN (ARN optional) */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Building2 className="size-4 text-muted-foreground" /> Firm details
        </label>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Firm name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Firm name"
              className="input-base text-sm h-9 w-full"
            />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">ARN (optional)</div>
            <input
              value={arnValue}
              onChange={(e) => setArnValue(e.target.value)}
              placeholder="ARN-XXXXX — leave blank if none"
              className="input-base text-sm h-9 w-full font-mono"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={saveFirm}
            disabled={firmBusy || name.trim().length < 2 || (name.trim() === (displayName ?? "") && arnValue.trim() === (arn ?? ""))}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            {firmBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save firm details
          </button>
          {firmMsg && <span className={`text-xs ${firmMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{firmMsg.text}</span>}
        </div>
      </div>

      {/* Contact email */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Mail className="size-4 text-muted-foreground" /> Contact email
        </label>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="firm@example.com"
            className="input-base text-sm h-9 min-w-[16rem] flex-1"
          />
          <button
            onClick={saveEmail}
            disabled={emailBusy || email.trim() === (currentEmail ?? "")}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            {emailBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </button>
        </div>
        {emailMsg && (
          <p className={`text-xs mt-1.5 ${emailMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{emailMsg.text}</p>
        )}
      </div>

      {/* Owner account (name + login email) */}
      <div className="border-t pt-4">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <UserCog className="size-4 text-muted-foreground" /> Owner account
        </label>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Owner name</div>
            <input value={ownName} onChange={(e) => setOwnName(e.target.value)} placeholder="Owner name" className="input-base text-sm h-9 w-full" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Owner login email</div>
            <input type="email" value={ownEmail} onChange={(e) => setOwnEmail(e.target.value)} placeholder="owner@example.com" className="input-base text-sm h-9 w-full" />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={saveOwner}
            disabled={ownerBusy || ownName.trim().length < 2 || (ownName.trim() === (ownerName ?? "") && ownEmail.trim() === (ownerEmail ?? ""))}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            {ownerBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save owner
          </button>
          {ownerMsg && <span className={`text-xs ${ownerMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{ownerMsg.text}</span>}
        </div>
      </div>

      {/* Reset password */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              <KeyRound className="size-4 text-muted-foreground" /> Owner password
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Emails the tenant owner a one-time link to set a new password (valid 1 hour). You never see the password.
            </p>
          </div>
          <button
            onClick={resetPassword}
            disabled={resetBusy}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50 whitespace-nowrap"
          >
            {resetBusy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Send reset link
          </button>
        </div>
        {resetMsg && (
          <p className={`text-xs mt-2 ${resetMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{resetMsg.text}</p>
        )}
      </div>

      {/* Danger zone — delete tenant */}
      <div className="border-t pt-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4">
          <div className="text-sm font-semibold text-rose-700 flex items-center gap-1.5">
            <AlertTriangle className="size-4" /> Delete tenant
          </div>
          <p className="text-xs text-rose-700/80 mt-1">
            Removes <span className="font-medium">{legalName}</span> from the platform and blocks all its logins.
            This is a soft delete — the data is retained and can be restored by Equitywala engineering.
          </p>
          {!confirmOpen ? (
            <button
              onClick={() => { setConfirmOpen(true); setDelMsg(null); }}
              className="mt-3 rounded-md border border-rose-300 text-rose-700 px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-rose-100"
            >
              <Trash2 className="size-3.5" /> Delete tenant…
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-rose-700">
                Type {arn && arn.trim() ? "the ARN" : "the firm name"}{" "}
                <span className="font-mono font-semibold">{confirmToken}</span> to confirm:
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={confirmArn}
                  onChange={(e) => setConfirmArn(e.target.value)}
                  placeholder={confirmToken}
                  className="input-base text-sm h-9 font-mono min-w-[12rem]"
                  autoFocus
                />
                <button
                  onClick={deleteTenant}
                  disabled={!armed || delBusy}
                  className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                >
                  {delBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Permanently delete
                </button>
                <button
                  onClick={() => { setConfirmOpen(false); setConfirmArn(""); setDelMsg(null); }}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
              {delMsg && <p className="text-xs text-rose-600">{delMsg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
