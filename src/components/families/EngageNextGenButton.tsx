"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, X, MessageSquare, Mail, Sparkles } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";

type TemplateInfo = {
  id: string;
  key: string;
  channel: "whatsapp" | "email" | "sms";
  name: string;
  description: string;
  category: string;
  variables: Array<{
    key: string;
    type: "string" | "number" | "currency" | "date" | "boolean" | "url";
    required?: boolean;
  }>;
};

export function EngageNextGenButton({
  investorId,
  investorName,
}: {
  investorId: string;
  investorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms">("whatsapp");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    fetch(`/api/investors/${investorId}/dispatch`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setTemplates(data);
        setLoading(false);
      })
      .catch(() => {
        setErr("Failed to load templates");
        setLoading(false);
      });
  }, [open, investorId]);

  const channelTemplates = templates.filter((t) => t.channel === channel);
  const selectedTemplate = channelTemplates.find((t) => t.key === selectedKey);

  // Initialize variables when template changes
  useEffect(() => {
    if (selectedTemplate) {
      const initial: Record<string, string> = {};
      selectedTemplate.variables.forEach((v) => {
        if (v.key === "investor_name" || v.key === "name" || v.key === "subject_name") {
          initial[v.key] = investorName;
        } else {
          initial[v.key] = "";
        }
      });
      setVars(initial);
      setErr(null);
    } else {
      setVars({});
    }
  }, [selectedKey, selectedTemplate, investorName]);

  // Reset selected key when channel changes
  useEffect(() => {
    setSelectedKey("");
    setVars({});
    setErr(null);
  }, [channel]);

  async function handleSend() {
    if (!selectedKey) return;
    setBusy(true);
    setErr(null);
    setSuccess(false);

    try {
      const res = await fetch(`/api/investors/${investorId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel,
          templateKey: selectedKey,
          variables: vars,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Failed to send engagement campaign");
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 1500);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] rounded-full font-semibold px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white flex items-center gap-1 transition-colors"
      >
        <Sparkles className="size-3" />
        Engage
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4 animate-fade-in" onClick={() => setOpen(false)}>
          <div
            className="bg-card rounded-lg shadow-lg max-w-lg w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b px-5 py-3 flex items-center justify-between">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Send className="size-4 text-violet-600" />
                Engage Next-Gen Prospect · {investorName}
              </h2>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Channel Selector */}
              <div>
                <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Select Channel
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "whatsapp", label: "WhatsApp", icon: MessageSquare },
                    { key: "email", label: "Email", icon: Mail },
                    { key: "sms", label: "SMS", icon: Send },
                  ].map((ch) => {
                    const Icon = ch.icon;
                    return (
                      <button
                        key={ch.key}
                        type="button"
                        onClick={() => setChannel(ch.key as any)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                          channel === ch.key
                            ? "border-violet-600 bg-violet-50 text-violet-700"
                            : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                        }`}
                      >
                        <Icon className="size-4" />
                        {ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Template Selector */}
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div>
                  <label className="block">
                    <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Choose Campaign Template
                    </span>
                    <ThemeSelect value={selectedKey} onChange={setSelectedKey}>
                      <option value="">— Select an approved template —</option>
                      {channelTemplates.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name} ({t.key})
                        </option>
                      ))}
                    </ThemeSelect>
                  </label>
                  {selectedTemplate && selectedTemplate.description && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 font-normal">
                      {selectedTemplate.description}
                    </p>
                  )}
                </div>
              )}

              {/* Variable Input Forms */}
              {selectedTemplate && selectedTemplate.variables.length > 0 && (
                <div className="border-t pt-3">
                  <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Template Variables
                  </span>
                  <div className="space-y-3">
                    {selectedTemplate.variables.map((v) => (
                      <label key={v.key} className="block">
                        <div className="text-xs font-medium mb-1 capitalize text-foreground/90">
                          {v.key.replace(/_/g, " ")}
                          {v.required && <span className="text-rose-600 ml-0.5">*</span>}
                        </div>
                        {v.type === "date" ? (
                          <input
                            type="date"
                            value={vars[v.key] ?? ""}
                            onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })}
                            className="w-full border rounded-md px-3 py-2 text-sm bg-background text-foreground font-sans font-normal"
                            required={v.required}
                          />
                        ) : (
                          <input
                            type="text"
                            value={vars[v.key] ?? ""}
                            placeholder={`Enter ${v.key.replace(/_/g, " ")}...`}
                            onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })}
                            className="w-full border rounded-md px-3 py-2 text-sm bg-background text-foreground font-normal"
                            required={v.required}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Status messages */}
              {err && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
                  {err}
                </div>
              )}

              {success && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs px-3 py-2 font-medium">
                  ✓ Onboarding campaign sent!
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-5 py-3 flex justify-end gap-2 bg-secondary/10">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={busy || !selectedKey || (selectedTemplate?.variables.some((v) => v.required && !vars[v.key]) ?? false)}
                className="rounded-md bg-violet-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 hover:bg-violet-700 transition-colors"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Launch Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
