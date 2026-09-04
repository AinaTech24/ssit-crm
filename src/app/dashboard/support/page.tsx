"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, Send, Loader2 } from "lucide-react";

export default function SupportPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", category: "other", priority: "normal" });
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    fetch("/api/support/tickets")
      .then((r) => r.json())
      .then((j) => setTickets(j.tickets ?? []))
      .catch(() => {});
  }, [posted]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ subject: "", description: "", category: "other", priority: "normal" });
        setPosted((p) => !p);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="text-muted-foreground text-sm">Get help from Equitywala — bugs, billing, feature requests, training.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
          <h2 className="font-semibold">Raise a ticket</h2>
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Subject"
            required
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the issue or request…"
            rows={5}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm bg-background"
            >
              <option value="bug">Bug</option>
              <option value="feature_request">Feature request</option>
              <option value="billing">Billing</option>
              <option value="training">Training</option>
              <option value="integration">Integration</option>
              <option value="data_help">Data help</option>
              <option value="other">Other</option>
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm bg-background"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <button
            disabled={busy}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {busy ? "Sending…" : "Send ticket"}
          </button>
        </form>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <LifeBuoy className="size-4" /> My tickets
          </h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 text-center py-6">No tickets yet.</p>
          ) : (
            <ul className="divide-y mt-3 text-sm">
              {tickets.map((t: any) => (
                <li key={t.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.subject}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted">{t.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.category} · {t.priority}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
