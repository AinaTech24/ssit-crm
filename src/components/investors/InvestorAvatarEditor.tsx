"use client";

/**
 * InvestorAvatarEditor — the client's photo on the Client-360 header, with
 * hover controls to upload / change / remove. Uploads go through the server
 * proxy (/api/compliance/upload, kind=general → S3) and the storage key is
 * saved on the investor via PATCH. Displayed via /api/investors/[id]/avatar.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

export function InvestorAvatarEditor({
  investorId,
  name,
  hasAvatar: initialHasAvatar,
  size = 64,
}: {
  investorId: string;
  name: string;
  hasAvatar: boolean;
  size?: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasAvatar, setHasAvatar] = useState(initialHasAvatar);
  const [version, setVersion] = useState(0); // cache-bust the <img> after a change
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(avatarUrl: string) {
    const res = await fetch(`/api/investors/${investorId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatarUrl }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Could not save photo");
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Please choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setErr("Image must be under 5 MB.");
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "general");
      fd.append("docType", "avatar");
      if (name) fd.append("clientName", name);
      const up = await fetch("/api/compliance/upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .catch(() => ({}));
      if (!up?.key) throw new Error(up?.error ?? "Upload failed");
      await save(up.key);
      setHasAvatar(true);
      setVersion((v) => v + 1);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await save("");
      setHasAvatar(false);
      setVersion((v) => v + 1);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative group" style={{ width: size, height: size }}>
        <Avatar
          src={hasAvatar ? `/api/investors/${investorId}/avatar?v=${version}` : null}
          name={name}
          size={size}
        />
        {/* hover overlay */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title={hasAvatar ? "Change photo" : "Upload photo"}
          className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-100"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </button>
        {hasAvatar && !busy && (
          <button
            type="button"
            onClick={remove}
            title="Remove photo"
            className="absolute -bottom-1 -right-1 size-6 grid place-items-center rounded-full bg-card border border-border text-muted-foreground hover:text-rose-600 hover:border-rose-200 shadow-sm transition-colors"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      {err && <div className="text-[10px] text-rose-600 text-center max-w-[120px]">{err}</div>}
    </div>
  );
}
