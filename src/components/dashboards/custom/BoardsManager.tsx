"use client";

/**
 * "Manage Dashboards" — list of the user's boards + shared boards + Recently
 * Deleted, with create / open / edit / clone / set-default / share / delete /
 * restore actions. Mirrors Zoho's Manage Dashboards surface.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, LayoutDashboard, Star, Copy, Pencil, Trash2, RotateCcw, Share2, Lock, Loader2, Users, ExternalLink, Sparkles,
} from "lucide-react";

export interface BoardLite {
  id: string;
  name: string;
  description: string | null;
  scope: "private" | "shared";
  isDefault: boolean;
  locked: boolean;
  widgetCount: number;
  ownerName?: string | null;
  canEdit: boolean;
}

export interface BoardTemplateLite {
  key: string;
  name: string;
  description: string;
  widgetCount: number;
}

export function BoardsManager({ mine, shared, deleted, templates = [] }: { mine: BoardLite[]; shared: BoardLite[]; deleted: BoardLite[]; templates?: BoardTemplateLite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(url: string, method: string, body?: any): Promise<any> {
    setBusy(url);
    try {
      const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json().catch(() => ({}));
      return res.ok ? j : null;
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function create() {
    const name = window.prompt("Name your dashboard", "My Dashboard");
    if (!name) return;
    const j = await act("/api/dashboards", "POST", { name });
    if (j?.id) router.push(`/dashboard/boards/${j.id}/edit`);
  }

  async function clone(id: string) {
    const j = await act(`/api/dashboards/${id}/clone`, "POST");
    if (j?.id) router.push(`/dashboard/boards/${j.id}/edit`);
  }

  async function createFromTemplate(key: string, name: string) {
    const j = await act("/api/dashboards/templates", "POST", { template: key, name });
    if (j?.id) router.push(`/dashboard/boards/${j.id}/edit`);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="size-6 text-brand-cyan" /> My Dashboards
          </h1>
          <p className="text-muted-foreground text-sm">Build your own dashboards from the widget library. Set one as your home, or share it with the firm.</p>
        </div>
        <button onClick={create} disabled={!!busy} className="btn-primary inline-flex items-center gap-1.5">
          {busy === "/api/dashboards" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} New dashboard
        </button>
      </div>

      <Section title="Created by me">
        {mine.length === 0 ? (
          <Empty>Click “New dashboard” to build your first board.</Empty>
        ) : (
          mine.map((b) => (
            <Card key={b.id} b={b} busy={busy}
              onDefault={() => act(`/api/dashboards/${b.id}/default`, "POST")}
              onClone={() => clone(b.id)}
              onShare={() => act(`/api/dashboards/${b.id}`, "PATCH", { scope: b.scope === "shared" ? "private" : "shared" })}
              onDelete={() => { if (window.confirm(`Delete “${b.name}”? You can restore it for 30 days.`)) act(`/api/dashboards/${b.id}`, "DELETE"); }}
            />
          ))
        )}
      </Section>

      {templates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-brand-cyan" /> Start from a template
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => createFromTemplate(t.key, t.name)}
                disabled={!!busy}
                className="text-left border rounded-lg bg-card p-3 hover:border-brand-cyan/60 hover:bg-accent transition-colors disabled:opacity-50 group"
              >
                <div className="font-medium truncate flex items-center justify-between gap-2">
                  {t.name}
                  {busy === "/api/dashboards/templates" ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
                  ) : (
                    <Plus className="size-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">{t.widgetCount} widgets</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {shared.length > 0 && (
        <Section title="Shared with the firm">
          {shared.map((b) => (
            <Card key={b.id} b={b} busy={busy} shared
              onDefault={() => act(`/api/dashboards/${b.id}/default`, "POST")}
              onClone={() => clone(b.id)}
            />
          ))}
        </Section>
      )}

      {deleted.length > 0 && (
        <Section title="Recently deleted (restorable 30 days)">
          {deleted.map((b) => (
            <div key={b.id} className="border rounded-lg bg-card p-3 flex items-center justify-between gap-3 opacity-80">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.widgetCount} widgets · deleted</div>
              </div>
              <button onClick={() => act(`/api/dashboards/${b.id}/restore`, "POST")} disabled={!!busy} className="btn-ghost text-xs inline-flex items-center gap-1">
                <RotateCcw className="size-3.5" /> Restore
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Card({ b, busy, shared, onDefault, onClone, onShare, onDelete }: {
  b: BoardLite; busy: string | null; shared?: boolean;
  onDefault: () => void; onClone: () => void; onShare?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="border rounded-lg bg-card p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium truncate flex items-center gap-1.5">
          {b.name}
          {b.isDefault && <span className="text-[10px] rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 inline-flex items-center gap-0.5"><Star className="size-2.5" /> Default</span>}
          {b.scope === "shared" && <span className="text-[10px] rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5 inline-flex items-center gap-0.5"><Users className="size-2.5" /> Shared</span>}
          {b.locked && <Lock className="size-3 text-muted-foreground" />}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {b.widgetCount} widgets{shared && b.ownerName ? ` · by ${b.ownerName}` : ""}{b.description ? ` · ${b.description}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Link href={`/dashboard/boards/${b.id}`} className="btn-ghost text-xs inline-flex items-center gap-1" title="Open"><ExternalLink className="size-3.5" /></Link>
        {b.canEdit && <Link href={`/dashboard/boards/${b.id}/edit`} className="btn-ghost text-xs inline-flex items-center gap-1" title="Edit"><Pencil className="size-3.5" /></Link>}
        {!b.isDefault && <button onClick={onDefault} disabled={!!busy} className="btn-ghost text-xs" title="Set as home default"><Star className="size-3.5" /></button>}
        <button onClick={onClone} disabled={!!busy} className="btn-ghost text-xs" title="Clone"><Copy className="size-3.5" /></button>
        {onShare && <button onClick={onShare} disabled={!!busy} className="btn-ghost text-xs" title={b.scope === "shared" ? "Make private" : "Share with firm"}><Share2 className="size-3.5" /></button>}
        {onDelete && <button onClick={onDelete} disabled={!!busy} className="btn-ghost text-xs text-rose-600 hover:bg-rose-50" title="Delete"><Trash2 className="size-3.5" /></button>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">{children}</div>;
}
