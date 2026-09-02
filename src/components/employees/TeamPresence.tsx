"use client";

/**
 * Live "who's online" badge for the team. Polls /api/presence every 30s and
 * shows the count of teammates active in the last 5 minutes, with a hover list.
 * Realtime active/inactive presence for the MFD side.
 */

import { useEffect, useState } from "react";

export function TeamPresence({ members }: { members: { id: string; name: string }[] }) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/presence");
      const j = await r.json().catch(() => ({}));
      setOnline(new Set<string>(j.online ?? []));
    } catch {
      /* keep last known */
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const onlineMembers = members.filter((m) => online.has(m.id));
  const count = onlineMembers.length;

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium">
        <span className="relative flex size-2">
          {count > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex size-2 rounded-full ${count > 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
        </span>
        {count} online
      </span>
      {open && count > 0 && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-border bg-card p-2 shadow-lg">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Online now</div>
          <ul className="space-y-0.5 max-h-56 overflow-y-auto">
            {onlineMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-xs">
                <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="truncate">{m.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
