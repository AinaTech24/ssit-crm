"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  X,
  CheckCircle2,
  Loader2,
  UserCog,
  FileDown,
  Trash2,
  Tag,
  Layers,
  CalendarClock,
  MessageSquare,
  Sparkles,
  ArrowRightLeft,
} from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";

export type BulkActionType =
  | "assign"
  | "review"
  | "tier"
  | "segment"
  | "category"
  | "stage"
  | "whatsapp"
  | "export"
  | "delete";

export function FloatingBulkBar({
  selectedCount,
  totalMatching,
  allSelected,
  allMatchingSelected,
  onSelectAllMatching,
  onClear,
  onApplyAction,
  busy,
  error,
  customActions,
  showCategory = true,
  showTier = true,
  showSegment = true,
  showReview = true,
  showStage = false,
}: {
  selectedCount: number;
  totalMatching?: number;
  allSelected?: boolean;
  allMatchingSelected?: boolean;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  onApplyAction: (action: string, payload: Record<string, any>) => Promise<void>;
  busy?: boolean;
  error?: string | null;
  customActions?: ReactNode;
  showCategory?: boolean;
  showTier?: boolean;
  showSegment?: boolean;
  showReview?: boolean;
  showStage?: boolean;
}) {
  const [activeModal, setActiveModal] = useState<BulkActionType | null>(null);
  const [assignRm, setAssignRm] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [tierVal, setTierVal] = useState("A");
  const [segmentVal, setSegmentVal] = useState("HNI");
  const [categoryVal, setCategoryVal] = useState("A");
  const [stageVal, setStageVal] = useState("call_done");

  if (selectedCount === 0) return null;

  const handleApply = async (action: string, payload: Record<string, any> = {}) => {
    await onApplyAction(action, payload);
    setActiveModal(null);
  };

  const barContent = (
    <div className="fixed bottom-6 inset-x-0 z-40 flex flex-col items-center pointer-events-none px-4">
      {/* "Select all matching across all pages" notice banner */}
      {totalMatching && totalMatching > selectedCount && onSelectAllMatching && (
        <div className="pointer-events-auto mb-2 px-4 py-1.5 bg-card/95 backdrop-blur-md border border-brand-cyan/30 text-foreground text-xs rounded-full shadow-lg flex items-center gap-2 animate-fade-in">
          <span>
            Selected <strong>{selectedCount}</strong> on this page.
          </span>
          <button
            type="button"
            onClick={onSelectAllMatching}
            className="text-brand-cyan font-semibold hover:underline"
          >
            Select all {totalMatching} matching records
          </button>
        </div>
      )}

      {/* Main floating pill bar */}
      <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 bg-card/95 dark:bg-card/90 backdrop-blur-xl border border-border/80 text-foreground px-4 py-2.5 rounded-2xl shadow-2xl animate-slide-up max-w-4xl flex-wrap justify-center ring-1 ring-black/5">
        <div className="flex items-center gap-2 pr-2 border-r border-border">
          <span className="flex size-6 items-center justify-center rounded-full bg-brand-navy text-white text-xs font-bold">
            {selectedCount}
          </span>
          <span className="text-xs font-medium text-muted-foreground hidden sm:inline">selected</span>
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveModal("assign")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
          >
            <UserCog className="size-3.5" /> Reassign RM
          </button>

          {showReview && (
            <button
              type="button"
              onClick={() => setActiveModal("review")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
            >
              <CalendarClock className="size-3.5" /> Next Review
            </button>
          )}

          {showTier && (
            <button
              type="button"
              onClick={() => setActiveModal("tier")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
            >
              <Layers className="size-3.5" /> Service Tier
            </button>
          )}

          {showSegment && (
            <button
              type="button"
              onClick={() => setActiveModal("segment")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
            >
              <Tag className="size-3.5" /> Segment
            </button>
          )}

          {showCategory && (
            <button
              type="button"
              onClick={() => setActiveModal("category")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
            >
              <Tag className="size-3.5" /> Category
            </button>
          )}

          {showStage && (
            <button
              type="button"
              onClick={() => setActiveModal("stage")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground hover:text-brand-cyan transition-colors"
            >
              <ArrowRightLeft className="size-3.5" /> Stage
            </button>
          )}

          {customActions}

          <button
            type="button"
            onClick={() => setActiveModal("delete")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 transition-colors"
            title="Delete selected"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted ml-1"
          title="Clear selection"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Floating Modal for Inputs */}
      {activeModal && (
        <div className="pointer-events-auto mt-2 bg-card border border-border rounded-xl shadow-2xl p-4 w-full max-w-md animate-scale-in text-xs">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-border">
            <span className="font-semibold text-foreground capitalize">
              {activeModal === "assign" && "Reassign RM to Selected"}
              {activeModal === "review" && "Set Next Review Date"}
              {activeModal === "tier" && "Set Service Tier"}
              {activeModal === "segment" && "Set Client Segment"}
              {activeModal === "category" && "Set Client Category"}
              {activeModal === "stage" && "Update Blueprint Stage"}
              {activeModal === "delete" && "Confirm Batch Delete"}
            </span>
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {activeModal === "assign" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Select the Relationship Manager for {selectedCount} records:</p>
              <RmSelector
                value={assignRm}
                onChange={setAssignRm}
                placeholder="Select RM…"
                className="w-full text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !assignRm}
                  onClick={() => handleApply("assign", { rmId: assignRm })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Apply Reassignment
                </button>
              </div>
            </div>
          )}

          {activeModal === "review" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Set next scheduled review date for {selectedCount} clients:</p>
              <input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                className="input-base text-xs w-full"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !reviewDate}
                  onClick={() => handleApply("review", { nextReviewAt: reviewDate })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Save Review Date
                </button>
              </div>
            </div>
          )}

          {activeModal === "tier" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Select service review tier for {selectedCount} clients:</p>
              <select
                value={tierVal}
                onChange={(e) => setTierVal(e.target.value)}
                className="input-base text-xs w-full"
              >
                <option value="A">Tier A — Quarterly review cadence</option>
                <option value="B">Tier B — Half-yearly review cadence</option>
                <option value="C">Tier C — Annual review cadence</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApply("tier", { serviceTier: tierVal })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Apply Tier
                </button>
              </div>
            </div>
          )}

          {activeModal === "segment" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Assign segment tag to {selectedCount} clients:</p>
              <select
                value={segmentVal}
                onChange={(e) => setSegmentVal(e.target.value)}
                className="input-base text-xs w-full"
              >
                {["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApply("segment", { segmentTag: segmentVal })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Apply Segment
                </button>
              </div>
            </div>
          )}

          {activeModal === "category" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Assign client category to {selectedCount} clients:</p>
              <select
                value={categoryVal}
                onChange={(e) => setCategoryVal(e.target.value)}
                className="input-base text-xs w-full"
              >
                {["A", "B", "C", "D"].map((c) => (
                  <option key={c} value={c}>
                    Category {c}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApply("category", { clientCategory: categoryVal })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Apply Category
                </button>
              </div>
            </div>
          )}

          {activeModal === "stage" && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Move {selectedCount} leads to stage:</p>
              <select
                value={stageVal}
                onChange={(e) => setStageVal(e.target.value)}
                className="input-base text-xs w-full"
              >
                <option value="new">New</option>
                <option value="call_done">Call Done</option>
                <option value="meeting_scheduled">Meeting Scheduled</option>
                <option value="meeting_done">Meeting Done</option>
                <option value="won_lead">Won Lead</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApply("stage", { stage: stageVal })}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 px-3 py-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Update Stage
                </button>
              </div>
            </div>
          )}

          {activeModal === "delete" && (
            <div className="space-y-3">
              <p className="text-destructive font-medium">
                Are you sure you want to delete {selectedCount} selected records?
              </p>
              <p className="text-muted-foreground">They will be moved to the Trash bin and can be restored by an Owner.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApply("delete")}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs inline-flex items-center gap-1.5"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Confirm Delete
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(barContent, document.body) : null;
}
