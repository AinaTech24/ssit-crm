"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, Search, Loader2, UserCircle2, Mail, MessageSquare, CheckCircle, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Recipient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappPhone?: string | null;
  details?: string;
};

export type SendToClientDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  assetTitle: string;
  assetType: string;
  assetFileUrl: string;
  brandingPosition?: "top" | "bottom" | "both" | "split" | "frame" | null;
  brandingHeightPct?: number;
  brandingVariant?: "solid" | "light";
  brandingSize?: string;
  brandingFrameTheme?: "premium" | "minimal" | "bold";
};

export function SendToClientDrawer({
  isOpen,
  onClose,
  assetId,
  assetTitle,
  assetType,
  assetFileUrl,
  brandingPosition = "bottom",
  brandingHeightPct = 18,
  brandingVariant = "solid",
  brandingSize = "original",
  brandingFrameTheme,
}: SendToClientDrawerProps) {
  const [recipientType, setRecipientType] = useState<"investor" | "lead">("investor");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [customNote, setCustomNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const toast = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function handleGenerateCaption() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/content-library/${assetId}/caption`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, recipientName: selectedRecipient?.name }),
      });
      const j = await res.json();
      if (!res.ok || !j.caption) {
        toast.error(j.error ?? "Could not generate a caption.", "Generation failed");
        return;
      }
      setCustomNote(j.caption);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate a caption.", "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // Click outside closes autocomplete dropdown
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search for clients/leads
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        
        if (recipientType === "investor") {
          const list = (j.investors ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            phone: r.phone,
            whatsappPhone: r.whatsapp_phone,
            details: `${r.pan ? `PAN: ${r.pan}` : ""} ${r.segment_tag ? `· Tag: ${r.segment_tag}` : ""}`,
          }));
          setResults(list);
        } else {
          const list = (j.leads ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            phone: r.phone,
            details: `${r.stage ? `Stage: ${r.stage}` : ""} ${r.source ? `· Source: ${r.source}` : ""}`,
          }));
          setResults(list);
        }
        setDropdownOpen(true);
      } catch (e: any) {
        setError("Search query failed");
      } finally {
        setSearchBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, recipientType]);

  // Reset states when drawer opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedRecipient(null);
      setQ("");
      setResults([]);
      setCustomNote("");
      setSentSuccess(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSend() {
    if (!selectedRecipient) {
      setError("Please select a recipient first.");
      return;
    }
    const contactTarget = channel === "email" ? selectedRecipient.email : (selectedRecipient.whatsappPhone ?? selectedRecipient.phone);
    if (!contactTarget) {
      setError(`Selected client has no contact info for ${channel}.`);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-library/${assetId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientType,
          recipientId: selectedRecipient.id,
          channel,
          customNote,
          position: brandingPosition,
          heightPct: brandingHeightPct,
          variant: brandingVariant,
          size: brandingSize,
          frameTheme: brandingFrameTheme,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Failed to dispatch communication.");
        return;
      }
      setSentSuccess(true);
    } catch (e: any) {
      setError(e.message ?? "An error occurred while sending.");
    } finally {
      setSending(false);
    }
  }

  const previewAssetUrl = assetType === "image"
    ? `/api/content-library/${assetId}/branded?mode=preview&position=${brandingPosition}&h=${brandingHeightPct}&variant=${brandingVariant}&size=${brandingSize}${brandingFrameTheme ? `&frametheme=${brandingFrameTheme}` : ""}`
    : assetFileUrl;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      {/* Drawer Body */}
      <div className="relative w-full max-w-lg h-full bg-background border-l shadow-2xl flex flex-col justify-between animate-slide-in">
        
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-secondary/20">
          <div>
            <h2 className="text-base font-semibold text-foreground">Send to Client</h2>
            <p className="text-xs text-muted-foreground truncate max-w-xs">Asset: {assetTitle}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {/* Content Section */}
        {sentSuccess ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center space-y-4">
            <CheckCircle className="size-16 text-emerald-500 animate-bounce" />
            <div>
              <h3 className="text-lg font-bold text-foreground">Asset Shared Successfully!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your content has been queued in the communication outbox and compliance logs.
              </p>
            </div>
            <button onClick={onClose} className="btn-secondary px-6">Close</button>
          </div>
        ) : (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {/* 1. Recipient Type Selector */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Recipient Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRecipientType("investor");
                    setSelectedRecipient(null);
                    setQ("");
                  }}
                  className={`py-1.5 text-xs font-medium rounded-lg border transition ${
                    recipientType === "investor"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  Client (Investor)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecipientType("lead");
                    setSelectedRecipient(null);
                    setQ("");
                  }}
                  className={`py-1.5 text-xs font-medium rounded-lg border transition ${
                    recipientType === "lead"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  Lead
                </button>
              </div>
            </div>

            {/* 2. Recipient Lookup input */}
            <div ref={dropdownRef} className="relative">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Select Recipient
              </label>
              
              {selectedRecipient ? (
                <div className="flex items-center justify-between border border-brand-cyan/40 bg-brand-cyan-light/20 p-2.5 rounded-lg">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="size-8 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shrink-0">
                      {selectedRecipient.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{selectedRecipient.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate font-mono">
                        {channel === "email" ? selectedRecipient.email : (selectedRecipient.whatsappPhone ?? selectedRecipient.phone ?? "—")}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedRecipient(null)}
                    className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${recipientType === "investor" ? "investors" : "leads"} by name, email, phone...`}
                    className="input-base pl-9 text-sm"
                  />
                  {searchBusy && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-brand-cyan animate-spin" />
                  )}
                </div>
              )}

              {/* Autocomplete Dropdown */}
              {!selectedRecipient && dropdownOpen && q.trim().length >= 2 && (
                <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-56 overflow-y-auto scrollbar-thin">
                  {results.length === 0 && !searchBusy ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      <UserCircle2 className="size-6 mx-auto opacity-40 mb-1" />
                      No matching records found.
                    </div>
                  ) : (
                    <ul className="py-1">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecipient(r);
                              setDropdownOpen(false);
                              setQ("");
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-brand-cyan-light/30 transition-colors"
                          >
                            <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold shrink-0 shadow-sm">
                              {r.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-xs truncate">{r.name}</div>
                              {r.details && (
                                <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                                  {r.details}
                                </div>
                              )}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* 3. Delivery Channel Picker */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Delivery Channel
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`py-2 text-xs font-semibold rounded-lg border flex items-center justify-center gap-2 transition ${
                    channel === "email"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <Mail className="size-4" /> Email
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("whatsapp")}
                  className={`py-2 text-xs font-semibold rounded-lg border flex items-center justify-center gap-2 transition ${
                    channel === "whatsapp"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <MessageSquare className="size-4" /> WhatsApp
                </button>
              </div>
            </div>

            {/* 4. Custom Message / Note */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Custom Message / Note
                </label>
                <button
                  type="button"
                  onClick={handleGenerateCaption}
                  disabled={generating}
                  className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {generating ? "Generating…" : "Generate caption"}
                </button>
              </div>
              <textarea
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                rows={4}
                placeholder="Write a custom note to prepend to the asset sharing link..."
                className="input-base text-sm resize-none"
              />
            </div>

            {/* 5. Live Preview Block */}
            <div className="card-surface p-3.5 space-y-2 border-brand-cyan/20 bg-brand-cyan-light/5">
              <span className="text-[10px] font-bold text-brand-cyan uppercase tracking-wider">
                Message Preview
              </span>
              <div className="text-xs space-y-1.5 text-foreground leading-relaxed">
                <div>
                  <strong className="text-muted-foreground">To: </strong> 
                  {selectedRecipient ? selectedRecipient.name : <span className="italic text-muted-foreground/50">No recipient selected</span>}
                </div>
                <div>
                  <strong className="text-muted-foreground">Subject: </strong> 
                  {channel === "email" ? `Shared Update: ${assetTitle}` : "—"}
                </div>
                <div className="border-t border-dashed my-2 pt-2 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground bg-white/70 p-2 rounded border">
                  {`Hi ${selectedRecipient ? selectedRecipient.name : "[Client]"},

${customNote || "[Custom Note]"}

You can view/download the update here:
[Co-branded Creative Link]

Best regards,
[Your Firm Name]`}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-xs p-3">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        {!sentSuccess && (
          <div className="p-4 border-t flex justify-end gap-2 bg-secondary/10">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !selectedRecipient}
              className="btn-primary text-xs flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {sending ? "Sending..." : "Send to Client"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
