"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  X,
  ExternalLink,
  Phone,
  MessageSquare,
  Mail,
  Calendar,
  Sparkles,
  Loader2,
  ArrowRight,
  Target,
  CheckCircle2,
  Clock,
  UserCog,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { formatINR, formatDate } from "@/lib/utils";
import { leadScoreBand } from "@/lib/leads/scoring";

export type SidePeekLead = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  stage: string;
  stageLabel: string;
  stageTone: string;
  source: string;
  intendedAmount?: string | null;
  nextFollowUpAt?: string | null;
  owner?: string | null;
  score: number;
};

export function LeadSidePeek({
  lead,
  onClose,
}: {
  lead: SidePeekLead | null;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lead?.id) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/leads/${lead.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setDetails(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lead?.id]);

  if (!lead) return null;

  const phoneClean = lead.phone?.replace(/[^0-9]/g, "") || "";
  const waUrl = phoneClean
    ? `https://wa.me/${phoneClean.length === 10 ? `91${phoneClean}` : phoneClean}`
    : null;

  const band = leadScoreBand(lead.score);

  const drawer = (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-card border-l border-border shadow-2xl flex flex-col animate-slide-up sm:animate-none">
          {/* Header */}
          <div className="p-5 border-b border-border/80 bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  src={lead.avatarUrl ? `/api/leads/${lead.id}/avatar` : null}
                  name={lead.name}
                  size={48}
                />
                <div>
                  <h2 className="text-lg font-bold text-foreground leading-tight">{lead.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-semibold border ${lead.stageTone}`}>
                      {lead.stageLabel}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-bold text-xs border ${band.chip}`}>
                      ★ Score {lead.score}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Quick action buttons */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/60">
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground hover:text-brand-cyan hover:bg-secondary/80 transition-colors"
                >
                  <Phone className="size-3" /> Call
                </a>
              )}
              {waUrl && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 transition-colors"
                >
                  <MessageSquare className="size-3" /> WhatsApp
                </a>
              )}
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground hover:text-brand-cyan hover:bg-secondary/80 transition-colors"
                >
                  <Mail className="size-3" /> Email
                </a>
              )}
              <Link
                href={`/dashboard/leads/${lead.id}`}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline"
              >
                Full Details <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 gap-2 p-4 bg-secondary/30 border-b border-border text-center">
            <div className="p-2.5 bg-card rounded-lg border border-border/60">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                Intended Investment
              </span>
              <span className="text-sm font-bold text-foreground tabular-nums">
                {lead.intendedAmount ? formatINR(Number(lead.intendedAmount)) : "Not specified"}
              </span>
            </div>
            <div className="p-2.5 bg-card rounded-lg border border-border/60">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                Source
              </span>
              <span className="text-sm font-bold text-brand-navy capitalize">{lead.source.replace("_", " ")}</span>
            </div>
          </div>

          {/* Main Info */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            {loading && !details ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-6 animate-spin mb-2 text-brand-cyan" />
                <span>Loading lead profile…</span>
              </div>
            ) : (
              <>
                <div className="p-3 bg-secondary/40 rounded-xl border border-border/60 space-y-2">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                    Assignment & Timing
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Assigned RM</span>
                      <span className="font-medium text-foreground">{lead.owner ?? "Unassigned"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Next Follow-up</span>
                      <span className="font-medium text-foreground">
                        {lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : "No follow-up set"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notes or remarks */}
                {details?.lead?.notes && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-foreground">Notes</h4>
                    <p className="p-3 rounded-lg bg-card border border-border text-muted-foreground leading-relaxed">
                      {details.lead.notes}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between gap-3">
            <Link
              href={`/dashboard/leads/${lead.id}`}
              className="btn-primary text-xs inline-flex items-center gap-1.5 px-4 py-2 flex-1 justify-center"
            >
              Open Lead Workspace <ArrowRight className="size-3.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(drawer, document.body) : null;
}
