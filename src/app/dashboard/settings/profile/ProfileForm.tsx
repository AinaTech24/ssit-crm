"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Camera, Trash2, LogOut, User, KeyRound, ImageIcon, Monitor } from "lucide-react";

/** 0=weak … 3=strong, from length + character-class variety. */
function pwStrength(pw: string): 0 | 1 | 2 | 3 {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return Math.min(3, Math.max(0, s - 1)) as 0 | 1 | 2 | 3;
}
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { DeviceSessions } from "@/components/settings/DeviceSessions";

export default function ProfileForm({
  initialName,
  email,
  emailVerified,
  initialPhone,
  initialAvatarUrl,
}: {
  initialName: string;
  email: string;
  emailVerified: boolean;
  initialPhone?: string | null;
  initialAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Email verification (the gate that blocks inviting team members until confirmed).
  const [resending, setResending] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  async function resendVerification() {
    setResending(true);
    setVerifyMsg(null);
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Could not send the verification email.", "Failed");
        return;
      }
      setVerifyMsg(
        data.emailSent
          ? "Verification email sent — open it and click “Confirm email”, then refresh this page."
          : "Email isn't configured for your firm yet. Ask your owner to set up email (Settings → Integrations), or contact Equitywala."
      );
    } catch {
      toast.error("Network error — please try again.", "Failed");
    } finally {
      setResending(false);
    }
  }

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string>(initialAvatarUrl ?? "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const initials =
    (name || "?")
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  async function saveAvatarUrl(url: string) {
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Could not save photo");
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return setAvatarMsg({ kind: "err", text: "Please choose an image file." });
    }
    if (file.size > 5 * 1024 * 1024) {
      return setAvatarMsg({ kind: "err", text: "Image must be under 5 MB." });
    }
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      // 1. presigned PUT URL (S3 or local fallback)
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/png",
          kind: "general",
          docType: "avatar",
        }),
      });
      const pj = await presign.json();
      if (!presign.ok) throw new Error(pj.error ?? "Could not start upload");

      // 2. upload the bytes
      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "content-type": file.type || "image/png" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");

      // 3. Store the app-served asset URL `/api/upload-local/<key>` — it serves
      //    from the local volume OR S3 (whichever holds the object), so the same
      //    URL works regardless of where the bytes landed.
      const publicUrl = `/api/upload-local/${pj.key}`;

      await saveAvatarUrl(publicUrl);
      setAvatarUrl(publicUrl);
      setAvatarMsg({ kind: "ok", text: "Photo updated." });
      router.refresh(); // refresh the navbar avatar
    } catch (err: any) {
      setAvatarMsg({ kind: "err", text: err.message ?? "Upload failed" });
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      await saveAvatarUrl("");
      setAvatarUrl("");
      setAvatarMsg({ kind: "ok", text: "Photo removed." });
      router.refresh();
    } catch (err: any) {
      setAvatarMsg({ kind: "err", text: err.message ?? "Could not remove" });
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Sent even when blank: "" clears the number server-side (the route maps
        // an empty string to null), so a user can remove a wrong one.
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setProfileMsg({ kind: "err", text: data?.error ?? "Could not save" });
      else {
        setProfileMsg({ kind: "ok", text: "Profile updated." });
        router.refresh();
      }
    } catch {
      setProfileMsg({ kind: "err", text: "Network error" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function signOutEverywhere() {
    if (!confirm("Sign out of all devices, including this one? You'll need to log in again.")) return;
    try {
      const res = await fetch("/api/me/sign-out-everywhere", { method: "POST" });
      if (res.ok) {
        window.location.href = "/login";
      } else {
        toast.error("Could not sign out everywhere. Try again.", "Failed");
      }
    } catch {
      toast.error("Network error.", "Failed");
    }
  }

  async function changePassword() {
    if (newPw.length < 8) return toast.error("New password must be at least 8 characters.", "Check your password");
    if (newPw === curPw) return toast.error("New password must be different from your current one.", "Check your password");
    if (newPw !== confirmPw) return toast.error("The new passwords don't match.", "Check your password");
    setSavingPw(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data?.error ?? "Could not change password.", "Password not changed");
      else {
        toast.success("Your password has been updated.", "Password changed");
        setCurPw(""); setNewPw(""); setConfirmPw("");
      }
    } catch {
      toast.error("Network error. Please try again.", "Password not changed");
    } finally {
      setSavingPw(false);
    }
  }

  const field = "mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background";
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-6">
      {/* Profile photo */}
      <div className="border rounded-lg bg-card p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <ImageIcon className="size-4 text-muted-foreground" /> Profile photo
        </h3>
        <div className="flex items-center gap-5">
          <div className="relative">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Profile photo"
                className="size-20 rounded-full object-cover ring-2 ring-border shadow-sm"
              />
            ) : (
              <div className="size-20 rounded-full brand-gradient text-white grid place-items-center text-2xl font-bold ring-2 ring-white shadow-sm">
                {initials}
              </div>
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 rounded-full bg-black/40 grid place-items-center">
                <Loader2 className="size-5 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Camera className="size-3.5" /> {avatarUrl ? "Change photo" : "Upload photo"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={uploadingAvatar}
                  className="text-sm px-3 py-2 rounded-md border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-2 text-muted-foreground"
                >
                  <Trash2 className="size-3.5" /> Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG or GIF · up to 5 MB · shown in the top-right menu.</p>
            {avatarMsg && (
              <p className={`text-xs ${avatarMsg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {avatarMsg.kind === "ok" && <Check className="size-3 inline mr-1" />}{avatarMsg.text}
              </p>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 items-stretch">
        {/* Left column — details + password stacked */}
        <div className="space-y-6">
          {/* Your details */}
          <div className="border rounded-lg bg-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <User className="size-4 text-muted-foreground" /> Your details
              </h3>
              <button
                onClick={saveProfile}
                disabled={savingProfile || name.trim().length < 2}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
              >
                {savingProfile && <Loader2 className="size-3.5 animate-spin" />} Save details
              </button>
            </div>
            <div>
              <label className={label}>Full name</label>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={label}>Mobile number</label>
              <input
                className={field}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 90000 12345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used for WhatsApp/SMS notifications and shown to colleagues in the team directory.
              </p>
            </div>
            <div>
              <label className={label}>Email</label>
              {/* Read-only: your email is your login identity — managed by your firm
                  owner. You can confirm it here, which is required before you can
                  invite team members. */}
              <input className={`${field} bg-secondary/40 text-muted-foreground`} value={email} readOnly />
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                {emailVerified ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <Check className="size-3.5" /> Verified
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 text-amber-600 font-medium">Not verified</span>
                    <button
                      type="button"
                      onClick={resendVerification}
                      disabled={resending}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {resending && <Loader2 className="size-3.5 animate-spin" />} Send verification email
                    </button>
                  </>
                )}
              </div>
              {verifyMsg && <p className="mt-1 text-xs text-emerald-600">{verifyMsg}</p>}
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {profileMsg.kind === "ok" && <Check className="size-3.5 inline mr-1" />}{profileMsg.text}
              </p>
            )}
          </div>

          {/* Change password */}
          <div className="border rounded-lg bg-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" /> Change password
              </h3>
              <button
                onClick={changePassword}
                disabled={savingPw || !curPw || !newPw}
                className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
              >
                {savingPw && <Loader2 className="size-3.5 animate-spin" />} Update password
              </button>
            </div>
            <div>
              <label className={label}>Current password</label>
              <PasswordInput autoComplete="current-password" className={field} value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </div>
            <div>
              <label className={label}>New password</label>
              <PasswordInput autoComplete="new-password" className={field} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              {newPw.length > 0 && (() => {
                const score = pwStrength(newPw);
                const meta = [
                  { label: "Weak", color: "bg-rose-500", text: "text-rose-600" },
                  { label: "Fair", color: "bg-amber-500", text: "text-amber-600" },
                  { label: "Good", color: "bg-blue-500", text: "text-blue-600" },
                  { label: "Strong", color: "bg-emerald-500", text: "text-emerald-600" },
                ][score];
                return (
                  <div className="mt-1.5">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full ${i <= score ? meta.color : "bg-secondary"}`} />
                      ))}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${meta.text}`}>{meta.label} · 8+ chars with a mix of cases, a number &amp; a symbol is best.</div>
                  </div>
                );
              })()}
            </div>
            <div>
              <label className={label}>Confirm new password</label>
              <PasswordInput autoComplete="new-password" className={field} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Right column — your devices, matches the combined left-column height
            and scrolls (hidden scrollbar) when the device list is longer. */}
        <div className="lg:relative">
          <div className="border rounded-lg bg-card p-5 flex flex-col lg:absolute lg:inset-0">
            <h3 className="font-semibold text-sm flex items-center gap-2 shrink-0 mb-3">
              <Monitor className="size-4 text-muted-foreground" /> Your devices
            </h3>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none -mr-1 pr-1">
              <DeviceSessions />
            </div>
            <div className="border-t pt-3 mt-3 shrink-0">
              <button
                onClick={signOutEverywhere}
                className="text-sm px-4 py-2 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 inline-flex items-center gap-2"
              >
                <LogOut className="size-3.5" /> Sign out of all devices
              </button>
              <p className="text-[11px] text-muted-foreground mt-1.5">Revokes every active session, including this one — use if a device was lost.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
