"use client";

/**
 * GuidedStageActions — replaces the generic "Next action" chip strip.
 *
 * For the current stage, looks up STAGE_ACTIONS (catalog) and renders 1-3
 * primary buttons. Each button:
 *
 *   1. On click, calls /api/leads/[id]/blueprint/can-advance?to=<target>
 *      to check whether the prerequisite artefact exists (call log,
 *      meeting, proposal, risk profile, …).
 *
 *   2. If satisfied → fires the action's behaviour:
 *        - `open_dialog`   → opens an in-place modal
 *        - `navigate`      → routes to a form page
 *        - `advance_only`  → directly POSTs blueprint/advance
 *        - `call_api`      → calls a custom endpoint
 *      Then refreshes so the stepper above reflects the new stage.
 *
 *   3. If NOT satisfied → expands an inline checklist of unsatisfied
 *      items with direct CTAs (e.g. "Log the call now") so the user
 *      knows exactly what to do.
 *
 * The dialogs themselves come from the existing leads/actions
 * components — we just trigger them via callbacks.
 */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { STAGE_ACTIONS, type StageAction, type DialogKind } from "@/lib/blueprints/stage-actions";
import { isFieldVisible, validateNomineeAllocations, type KycField } from "@/lib/onboarding/kyc-fields";
import { ScheduleMeetingModal } from "@/components/review-meetings/ScheduleMeetingModal";
import { CompleteMeetingModal } from "@/components/review-meetings/CompleteMeetingModal";

/** Does this href open the schedule-meeting page? If so we pop a modal instead. */
const isMeetingHref = (href: string) => /\/review-meetings\/new\b/.test(href);
/** Does this href open the meetings list to mark one completed? Pop the inline
 *  complete-meeting modal instead of navigating away. */
const isCompleteMeetingHref = (href: string) => /\/review-meetings\?leadId=/.test(href);

type Prereq = {
  label: string;
  satisfied: boolean;
  hint?: string;
  cta?: { href: string; label: string };
};

/**
 * Transitions that, on confirm, ask for an assignee + a due date and auto-create
 * a pre-filled task for that team member (the task API notifies them). Each spec
 * carries a sensible task type, owning department, priority and a default SLA so
 * onboarding hand-offs are tracked, categorised and never sit undated.
 */
type TransitionTask = {
  title: string;
  type: string; // task taxonomy: follow_up | review_meeting | collect_document | kyc_renewal | custom
  department: "operations" | "compliance" | "back_office";
  priority: "high" | "normal" | "urgent";
  /** Default due date = today + this many days (editable in the dialog). */
  dueInDays: number;
};
const TASK_ON_TRANSITION: Record<string, TransitionTask> = {
  kyc_registered: { title: "Register fresh KYC with the KRA", type: "kyc_renewal", department: "compliance", priority: "high", dueInDays: 2 },
  modify_kyc: { title: "Correct & resubmit KYC (address / bank / nominee)", type: "kyc_renewal", department: "compliance", priority: "high", dueInDays: 2 },
  physical_kyc: { title: "Complete physical KYC / IPV (in-person verification)", type: "kyc_renewal", department: "operations", priority: "high", dueInDays: 3 },
  ucc_create: { title: "Create UCC (BSE / NSE Unique Client Code)", type: "follow_up", department: "operations", priority: "high", dueInDays: 2 },
  mandate_create: { title: "Register the SIP mandate (NACH / e-mandate)", type: "follow_up", department: "operations", priority: "high", dueInDays: 3 },
};

/** Loop stages that schedule a next-touch reminder for the lead owner. */
const NEXT_TOUCH_STAGES = new Set(["call_back_later", "call_not_connected", "contact_in_future"]);

/** Structured lost reasons captured when a lead is marked Not Qualified — feeds
 *  win/loss analytics (persisted to leads.lost_reason by the advance route). */
const LOST_REASONS = [
  "Not interested",
  "No budget / can't invest now",
  "Chose a competitor",
  "Unhappy with charges / commission",
  "Unreachable / no response",
  "Not eligible (NRI / KYC / docs)",
  "Bad timing — revisit later",
  "Duplicate / invalid lead",
  "Other",
];

type Outcome =
  | { kind: "advanced" }
  | { kind: "needs_action"; items: Prereq[]; targetStage: string }
  | { kind: "sent"; ok?: boolean; message: string; url?: string | null; waMeUrl?: string | null }
  | { kind: "error"; message: string };

export function GuidedStageActions({
  leadId,
  currentStage,
  pipeline,
  onOpenDialog,
  onAfterAdvance,
}: {
  leadId: string;
  currentStage: string;
  /** Lead's product pipeline (mf | insurance | general). Filters product-
   *  specific actions (e.g. Won-Lead onboarding branch). */
  pipeline?: string;
  onOpenDialog?: (kind: DialogKind) => void;
  onAfterAdvance?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  
  // Zoho CRM Blueprint Transition Dialog states
  const [transitioningAction, setTransitioningAction] = useState<StageAction | null>(null);
  const [missingFields, setMissingFields] = useState<Array<{ key: string; label: string; type: string; options?: string[] }>>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [remarks, setRemarks] = useState("");
  // Next-touch date — drives a reminder task on the loop stages (call back,
  // not connected, contact in future) so parked leads never go silent.
  const [callBackAt, setCallBackAt] = useState("");
  // Required when closing a lead as "Not Qualified" — structured lost reason
  // (the leads table + advance route already persist it; the UI now asks).
  const [lostReason, setLostReason] = useState("");
  // How many times this lead has already hit "Call Not Connected" — drives a
  // "stop chasing a dead number" nudge after repeated misses.
  const [notConnectedCount, setNotConnectedCount] = useState<number | null>(null);
  // Required when transitioning to "ucc_create" — who the auto-created UCC task
  // is assigned to.
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  // Default due date for the auto-created task (today + spec.dueInDays); editable.
  const [taskDueAt, setTaskDueAt] = useState("");
  const [teamUsers, setTeamUsers] = useState<Array<{ id: string; name: string }>>([]);
  // Required when transitioning to "ucc_activated" — stored on the client master.
  const [uccNumber, setUccNumber] = useState("");
  // Required when transitioning to "mandate_activated" — stored on the client.
  const [mandateBanks, setMandateBanks] = useState<Array<{ bankName?: string; accountMasked?: string; ifsc?: string; accountType?: string }>>([]);
  const [mandateBankIdx, setMandateBankIdx] = useState("");
  const [mandateBankName, setMandateBankName] = useState(""); // free-text when no saved accounts
  const [mandateAmount, setMandateAmount] = useState("");
  const [mandateRef, setMandateRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Schedule-meeting popup — opened instead of navigating to the meeting page.
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  // Complete-meeting popup — opened from the "mark meeting completed" prereq so
  // the RM completes the meeting inline instead of opening the meetings page.
  const [completeMeetingOpen, setCompleteMeetingOpen] = useState(false);

  // Load the client's saved bank accounts when a mandate-activation modal opens,
  // so the "select bank" picker is populated.
  useEffect(() => {
    if (transitioningAction?.targetStage !== "mandate_activated") return;
    let cancelled = false;
    (async () => {
      try {
        const j = await fetch(`/api/leads/${leadId}/capture-kyc`).then((r) => r.json()).catch(() => ({}));
        if (!cancelled) setMandateBanks(Array.isArray(j.bankAccounts) ? j.bankAccounts : []);
      } catch {
        /* picker falls back to free-text bank-name entry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transitioningAction?.targetStage, leadId]);

  // Load the team list once, when a task-creating transition modal opens, so the
  // "Assign to" picker can be populated.
  useEffect(() => {
    if (!TASK_ON_TRANSITION[transitioningAction?.targetStage ?? ""] || teamUsers.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const j = await fetch("/api/employees?limit=200").then((r) => r.json()).catch(() => ({}));
        const list = (j.employees ?? j.rows ?? j.data ?? []) as Array<{ id: string; name: string }>;
        if (!cancelled) setTeamUsers(list.map((u) => ({ id: u.id, name: u.name ?? "—" })));
      } catch {
        /* picker just stays empty — handled by validation */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transitioningAction?.targetStage, teamUsers.length]);

  // Prefill the auto-task's due date when a task-creating transition modal opens.
  useEffect(() => {
    const spec = TASK_ON_TRANSITION[transitioningAction?.targetStage ?? ""];
    if (!spec) return;
    // datetime-local prefill (date + time) so the user can set an exact deadline.
    setTaskDueAt(toLocalInput(Date.now() + spec.dueInDays * 86400000));
  }, [transitioningAction?.targetStage]);

  // Prefill the next-touch date for the loop stages so the reminder defaults to a
  // sensible time: "not connected" → tomorrow, "contact in future" → +30 days.
  // (Call-back-later stays blank — the lead asked for a specific time.)
  useEffect(() => {
    const stage = transitioningAction?.targetStage;
    if (stage === "call_not_connected") {
      setCallBackAt(toLocalInput(Date.now() + 1 * 86400000));
    } else if (stage === "contact_in_future") {
      setCallBackAt(toLocalInput(Date.now() + 30 * 86400000));
    }
  }, [transitioningAction?.targetStage]);

  // Count prior "Call Not Connected" entries so we can nudge the RM to stop
  // chasing a dead number after a few misses.
  useEffect(() => {
    if (transitioningAction?.targetStage !== "call_not_connected") return;
    let cancelled = false;
    (async () => {
      try {
        const j = await fetch(`/api/leads/${leadId}/blueprint`).then((r) => r.json()).catch(() => ({}));
        const hist = Array.isArray(j?.history) ? j.history : [];
        const n = hist.filter((h: any) => h?.stageKey === "call_not_connected").length;
        if (!cancelled) setNotConnectedCount(n);
      } catch {
        if (!cancelled) setNotConnectedCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transitioningAction?.targetStage, leadId]);

  // "Documents Received" details popup — the MFD fills the client's KYC /
  // account-opening details on their behalf, which save into the client master
  // and advance the stage.
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectLoading, setCollectLoading] = useState(false);
  const [collectFields, setCollectFields] = useState<KycField[]>([]);
  const [collectValues, setCollectValues] = useState<Record<string, string>>({});
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  async function openCollectDetails() {
    setCollectOpen(true);
    setCollectLoading(true);
    setCollectError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/capture-kyc`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setCollectFields(Array.isArray(d.fields) ? d.fields : []);
      setCollectValues(d.values ?? {});
    } catch (e: any) {
      setCollectError(e?.message ?? "Couldn't load the details form.");
    } finally {
      setCollectLoading(false);
    }
  }

  async function submitCollectDetails() {
    // Enforce required fields that are currently visible (showIf-driven).
    const miss = collectFields.find(
      (f) => f.required && isFieldVisible(f, collectValues) && !(collectValues[f.key] ?? "").trim()
    );
    if (miss) {
      setCollectError(`Please fill: ${miss.label}`);
      return;
    }
    const allocErr = validateNomineeAllocations(collectValues);
    if (allocErr) {
      setCollectError(allocErr);
      return;
    }
    setCollectSubmitting(true);
    setCollectError(null);
    try {
      // Only send values for fields currently visible.
      const payload: Record<string, string> = {};
      for (const f of collectFields) {
        if (!isFieldVisible(f, collectValues)) continue;
        const val = (collectValues[f.key] ?? "").trim();
        if (val) payload[f.key] = val;
      }
      const r = await fetch(`/api/leads/${leadId}/capture-kyc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: payload, advance: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setCollectOpen(false);
      // A non-fatal warning (e.g. a duplicate PAN was skipped) — surface it in
      // the outcome banner; the rest of the details still saved + advanced.
      if (d?.warning) setOutcome({ kind: "sent", ok: true, message: d.warning });
      router.refresh();
      window.dispatchEvent(new CustomEvent("blueprint:refresh"));
      onAfterAdvance?.();
    } catch (e: any) {
      setCollectError(e?.message ?? "Couldn't save the details.");
    } finally {
      setCollectSubmitting(false);
    }
  }

  // Show only the actions for this lead's pipeline. Untagged actions show for
  // everyone; tagged ones (e.g. Won-Lead's "Request Documents" vs "Start
  // Insurance Onboarding") show only for their matching pipeline.
  const lp = pipeline ?? "mf";
  const actions = (STAGE_ACTIONS[currentStage] ?? []).filter((a) => !a.pipelines || a.pipelines.includes(lp));

  if (actions.length === 0) {
    return null; // terminal / boundary stage — nothing to do here
  }

  async function checkPrereq(targetStage: string): Promise<{ ok: boolean; items: Prereq[]; missingFields?: any[] }> {
    const res = await fetch(
      `/api/leads/${leadId}/blueprint/can-advance?to=${encodeURIComponent(targetStage)}`
    );
    // A non-OK response (session expiry, 404, 500) is a TRANSPORT failure, not
    // "prerequisites unmet" — throw so the caller can show a real error instead
    // of a misleading empty checklist.
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error ?? `Couldn't check prerequisites (HTTP ${res.status}). Please try again.`);
    }
    return (await res.json()) as { ok: boolean; items: Prereq[]; missingFields?: any[] };
  }

  async function advance(targetStage: string, remarks?: string): Promise<boolean> {
    const res = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStageKey: targetStage, remarks }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.warn("[advance] failed:", j.error);
      return false;
    }
    return true;
  }

  async function handleClick(action: StageAction) {
    // "Documents Received" / "Documents Already Received" → instead of the
    // generic prereq checklist, open a popup so the MFD can fill the client's
    // required details on their behalf. Submitting saves them to the client
    // master and advances to Documents Received.
    if (action.targetStage === "documents_received") {
      await openCollectDetails();
      return;
    }

    setBusy(action.key);
    setOutcome(null);
    try {
      // 1. If the action targets a *forward* stage, check prereqs first.
      const forwardJump = action.targetStage && action.targetStage !== currentStage;
      if (forwardJump) {
        let pre: { ok: boolean; items: Prereq[]; missingFields?: any[] };
        try {
          pre = await checkPrereq(action.targetStage);
        } catch (e: any) {
          setOutcome({ kind: "error", message: e?.message ?? "Couldn't check prerequisites. Please try again." });
          return;
        }
        if (!pre.ok) {
          // Show the checklist of unsatisfied items.
          setOutcome({
            kind: "needs_action",
            items: pre.items,
            targetStage: action.targetStage,
          });
          return;
        }

        // Show the generic transition modal ONLY for direct "advance_only" jumps —
        // those have no dialog of their own, so the modal is where we collect any
        // remarks / required fields. Dialog-backed actions (Call Done → log_call,
        // Meeting Done → log_past_meeting, …) must open their OWN richer dialog
        // (e.g. the Log Activity panel) where the user records the call/meeting;
        // saving that artefact auto-advances the stage and fills required fields
        // like LastContactAt. So we deliberately do NOT intercept them here even
        // when the target stage lists missing fields — the dialog supplies them.
        if (action.behaviour.kind === "advance_only") {
          setTransitioningAction(action);
          setMissingFields(pre.missingFields ?? []);
          setFieldValues({});
          setRemarks("");
          setError(null);
          return;
        }
      }

      // 2. Run the behaviour.
      switch (action.behaviour.kind) {
        case "open_dialog":
          // Defer to the page-level handler (existing LeadActions dialogs).
          onOpenDialog?.(action.behaviour.dialog);
          // The dialog's onSave will trigger router.refresh() — and the
          // smart auto-advance pipeline (call log creates → first_call_pending,
          // meeting created → appointment_scheduled, etc.) will move the
          // blueprint without us calling advance here.
          break;

        case "navigate": {
          const href = action.behaviour.hrefPattern.replace("{id}", leadId);
          // Schedule-meeting → open the meeting form in a popup instead of
          // navigating away from the lead.
          if (isMeetingHref(href)) { setMeetingModalOpen(true); break; }
          router.push(href);
          break;
        }

        case "call_api": {
          const endpoint = action.behaviour.endpoint.replace("{id}", leadId);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(action.behaviour.body ?? {}),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setOutcome({ kind: "error", message: data?.error ?? "The action could not be completed." });
            break;
          }
          if (action.behaviour.afterStage) {
            await advance(action.behaviour.afterStage);
          }
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
          // If the endpoint reports what it did (e.g. email + WhatsApp sent), show it.
          // We deliberately do NOT auto-open WhatsApp — the link is shown below
          // so the advisor can copy it and send it however they prefer.
          if (typeof data?.summary === "string") {
            setOutcome({ kind: "sent", ok: data.ok !== false, message: data.summary, url: data.url ?? null, waMeUrl: data.waMeUrl ?? null });
          } else {
            setOutcome({ kind: "advanced" });
          }
          break;
        }

        case "advance_only": {
          if (forwardJump) {
            await advance(action.targetStage, `Action: ${action.label}`);
          }
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
          setOutcome({ kind: "advanced" });
          break;
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCompleteTransition() {
    if (!transitioningAction) return;

    // Validate that all missing required fields are filled out
    for (const f of missingFields) {
      if (!fieldValues[f.key]) {
        setError(`Please fill out the required field: ${f.label}`);
        return;
      }
    }

    // Loop stages (call back / not connected / contact in future) require a
    // next-touch date — it schedules the reminder so the lead never goes silent.
    const needsNextTouch = NEXT_TOUCH_STAGES.has(transitioningAction.targetStage);
    if (needsNextTouch && !callBackAt) {
      setError("Please pick when to follow up — we'll remind you then.");
      return;
    }

    // "Not Qualified" requires a structured lost reason (feeds win/loss analytics).
    const isNotQualified = transitioningAction.targetStage === "not_qualified";
    if (isNotQualified && !lostReason) {
      setError("Please pick why this lead is being closed.");
      return;
    }

    // Task-creating transitions (KYC, UCC, Mandate, …) require an assignee — we
    // auto-create the pre-filled task for them after the stage moves.
    const taskSpec = TASK_ON_TRANSITION[transitioningAction.targetStage];
    if (taskSpec && !taskAssigneeId) {
      setError("Please choose who to assign the task to.");
      return;
    }

    // "UCC Activated" requires the UCC number — stored on the client master.
    const isUccActivated = transitioningAction.targetStage === "ucc_activated";
    if (isUccActivated && !uccNumber.trim()) {
      setError("Please enter the UCC number.");
      return;
    }

    // "Mandate Activated" — capture bank + amount (+ approval ref) for the client.
    const isMandateActivated = transitioningAction.targetStage === "mandate_activated";
    const selectedBank = mandateBanks.length && mandateBankIdx !== "" ? mandateBanks[Number(mandateBankIdx)] : null;
    if (isMandateActivated) {
      const bankChosen = mandateBanks.length ? !!selectedBank : mandateBankName.trim() !== "";
      if (!bankChosen) {
        setError("Please select the bank the mandate is registered on.");
        return;
      }
      const amt = Number(mandateAmount);
      if (!mandateAmount.trim() || isNaN(amt) || amt <= 0) {
        setError("Please enter a valid mandate amount.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStageKey: transitioningAction.targetStage,
          remarks: remarks || `Transitioned to ${transitioningAction.targetStage}`,
          fields: {
            ...fieldValues,
            ...(isNotQualified ? { lostReason, lostAt: new Date().toISOString() } : {}),
          },
          callBackAt: needsNextTouch ? callBackAt : undefined,
          uccNumber: isUccActivated ? uccNumber.trim() : undefined,
          mandateBank: isMandateActivated ? (selectedBank?.bankName ?? mandateBankName.trim()) : undefined,
          mandateIfsc: isMandateActivated ? selectedBank?.ifsc : undefined,
          mandateAccountMasked: isMandateActivated ? selectedBank?.accountMasked : undefined,
          mandateAmount: isMandateActivated ? Number(mandateAmount) : undefined,
          mandateRef: isMandateActivated && mandateRef.trim() ? mandateRef.trim() : undefined,
        }),
      });

      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Failed to complete transition");

      // Auto-create the task assigned to the chosen team member (the task API
      // notifies them). The stage already moved, so a task failure is surfaced
      // (don't silently drop it) but the transition stands — re-clicking Save
      // retries the task (the transition is idempotent).
      if (taskSpec) {
        const tRes = await fetch(`/api/tasks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: taskSpec.title,
            description: remarks ? `From onboarding transition. ${remarks}` : `Auto-created on the "${transitioningAction.targetStage.replace(/_/g, " ")}" transition.`,
            type: taskSpec.type,
            priority: taskSpec.priority,
            department: taskSpec.department,
            assigneeId: taskAssigneeId,
            dueAt: taskDueAt || undefined,
            relatedLeadId: leadId,
          }),
        });
        if (!tRes.ok) {
          const td = await tRes.json().catch(() => ({}));
          throw new Error(`Stage moved, but the task couldn't be created: ${td?.error ?? `HTTP ${tRes.status}`}. Click Save again to retry.`);
        }
      }

      setTransitioningAction(null);
      setCallBackAt("");
      setLostReason("");
      setNotConnectedCount(null);
      setTaskAssigneeId("");
      setTaskDueAt("");
      setUccNumber("");
      setMandateBanks([]);
      setMandateBankIdx("");
      setMandateBankName("");
      setMandateAmount("");
      setMandateRef("");
      router.refresh();
      window.dispatchEvent(new CustomEvent("blueprint:refresh"));
      onAfterAdvance?.();
    } catch (e: any) {
      setError(e.message ?? "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => handleClick(a)}
            disabled={!!busy}
            className={`${toneClass(a.tone)} ${busy === a.key ? "opacity-70" : ""} text-sm whitespace-nowrap`}
            title={a.hint}
          >
            {busy === a.key ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {a.label}
          </button>
        ))}
      </div>

      {/* Hint row for the first action */}
      {actions[0]?.hint && (
        <p className="text-xs text-muted-foreground leading-snug">
          <span className="font-medium">Tip:</span> {actions[0].hint}
        </p>
      )}

      {/* Outcome panel — checklist when prereq fails */}
      {outcome?.kind === "needs_action" && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/70 p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-9 rounded-lg bg-amber-100 grid place-items-center flex-shrink-0">
              <AlertTriangle className="size-4 text-amber-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                Before moving on, complete these
              </div>
              <p className="text-xs text-amber-800/90 mt-0.5">
                The CRM needs the underlying record on file before it can
                advance the stage. Click any item below to finish it.
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {outcome.items.map((p, i) => (
              <li
                key={i}
                className={`flex items-start gap-2.5 rounded-lg p-2.5 border ${
                  p.satisfied
                    ? "bg-emerald-50/60 border-emerald-200"
                    : "bg-white border-amber-200"
                }`}
              >
                {p.satisfied ? (
                  <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <Circle className="size-4 text-amber-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm ${
                      p.satisfied ? "text-emerald-900 line-through" : "text-foreground"
                    }`}
                  >
                    {p.label}
                  </div>
                  {!p.satisfied && p.hint && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {p.hint}
                    </div>
                  )}
                </div>
                {!p.satisfied && p.cta && (
                  isMeetingHref(p.cta.href) ? (
                    <button
                      type="button"
                      onClick={() => setMeetingModalOpen(true)}
                      className="btn-secondary text-xs whitespace-nowrap inline-flex items-center gap-1"
                    >
                      {p.cta.label}
                      <ChevronRight className="size-3" />
                    </button>
                  ) : isCompleteMeetingHref(p.cta.href) ? (
                    <button
                      type="button"
                      onClick={() => setCompleteMeetingOpen(true)}
                      className="btn-secondary text-xs whitespace-nowrap inline-flex items-center gap-1"
                    >
                      Mark completed here
                      <ChevronRight className="size-3" />
                    </button>
                  ) : (
                    <a
                      href={p.cta.href}
                      className="btn-secondary text-xs whitespace-nowrap inline-flex items-center gap-1"
                    >
                      {p.cta.label}
                      <ChevronRight className="size-3" />
                    </a>
                  )
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className="mt-3 text-xs text-amber-800 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sent panel — shows the copyable link so the advisor can send it
          however they want (WhatsApp, email, SMS). No auto-launch. */}
      {outcome?.kind === "sent" && (
        <SentPanel outcome={outcome} onDismiss={() => setOutcome(null)} />
      )}

      {/* Error panel — transport failure checking prerequisites */}
      {outcome?.kind === "error" && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50/70 p-4">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-rose-100 grid place-items-center flex-shrink-0">
              <AlertTriangle className="size-4 text-rose-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-rose-900">Couldn’t check this step</div>
              <p className="text-xs text-rose-800/90 mt-0.5">{outcome.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="text-xs text-rose-800 hover:underline flex-shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Zoho CRM Blueprint Transition Dialog */}
      {transitioningAction && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-xl max-w-md w-full shadow-2xl text-foreground flex flex-col max-h-[90vh] my-auto">
            <div className="flex items-center gap-2 border-b border-border p-6 pb-3 shrink-0">
              <Sparkles className="size-5 text-brand-cyan animate-pulse" />
              <h3 className="font-bold text-base text-foreground">
                Transition: {transitioningAction.label}
              </h3>
            </div>
            <div className="overflow-y-auto p-6 pt-4 space-y-4 flex-1">{/* scrollable body — fixes cut-off submit on short viewports */}

            <p className="text-xs text-muted-foreground">
              Please complete the required details to transition the lead to{" "}
              <strong className="text-foreground">
                {transitioningAction.targetStage.replace(/_/g, " ")}
              </strong>.
            </p>

            {/* Dynamic Required Fields */}
            {missingFields.length > 0 && (
              <div className="space-y-3 border-t border-b border-border py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-cyan">
                  Required Information
                </div>
                {missingFields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs text-foreground font-medium">
                      {f.label} <span className="text-rose-500">*</span>
                    </label>
                    {f.type === "select" ? (
                      <select
                        required
                        value={fieldValues[f.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        className="input-base text-xs w-full"
                      >
                        <option value="">— choose —</option>
                        {f.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type}
                        required
                        value={fieldValues[f.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        placeholder={`Enter ${f.label.toLowerCase()}`}
                        className="input-base text-xs w-full"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Next-touch date — required for the loop stages; schedules a
                reminder task for the lead owner so parked leads never go silent. */}
            {NEXT_TOUCH_STAGES.has(transitioningAction.targetStage) && (
              <div className="space-y-1.5 border-t border-b border-border py-3">
                <label className="text-xs text-foreground font-medium">
                  {transitioningAction.targetStage === "contact_in_future" ? "Resurface on" : "Call back on"}{" "}
                  <span className="text-rose-500">*</span>
                </label>
                {transitioningAction.targetStage === "contact_in_future" && (
                  <div className="flex gap-1.5">
                    {[30, 60, 90].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setCallBackAt(toLocalInput(Date.now() + days * 86400000))}
                        className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                      >
                        +{days}d
                      </button>
                    ))}
                  </div>
                )}
                <input
                  type="datetime-local"
                  required
                  value={callBackAt}
                  onChange={(e) => setCallBackAt(e.target.value)}
                  className="input-base text-xs w-full"
                />
                <p className="text-[10px] text-muted-foreground">
                  We&apos;ll create a reminder task for the lead owner at this time so it doesn&apos;t slip.
                </p>
                {transitioningAction.targetStage === "call_not_connected" && notConnectedCount != null && notConnectedCount >= 2 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                    <span>
                      This will be attempt #{notConnectedCount + 1} with no connection. Consider <strong>Long-term Nurture</strong> or
                      closing as <strong>Unreachable</strong> instead of chasing a dead number.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Lost reason — required when closing a lead as Not Qualified. */}
            {transitioningAction.targetStage === "not_qualified" && (
              <div className="space-y-1 border-t border-b border-border py-3">
                <label className="text-xs text-foreground font-medium">
                  Why is this lead being closed? <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="input-base text-xs w-full"
                >
                  <option value="">— choose a reason —</option>
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Captured for win/loss analytics. Add any detail in the notes below.
                </p>
              </div>
            )}

            {/* Task assignee + due date — required for task-creating transitions;
                auto-creates a pre-filled task and notifies the assignee. */}
            {TASK_ON_TRANSITION[transitioningAction.targetStage] && (
              <div className="space-y-2.5 border-t border-b border-border py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-cyan">Create &amp; assign task</div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground font-medium">
                    Assign task to <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={taskAssigneeId}
                    onChange={(e) => setTaskAssigneeId(e.target.value)}
                    className="input-base text-xs w-full"
                  >
                    <option value="">{teamUsers.length ? "Select a team member…" : "Loading team…"}</option>
                    {teamUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground font-medium">Due by (date &amp; time)</label>
                  <input
                    type="datetime-local"
                    value={taskDueAt}
                    onChange={(e) => setTaskDueAt(e.target.value)}
                    className="input-base text-xs w-full"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  We&apos;ll create a high-priority task — &ldquo;{TASK_ON_TRANSITION[transitioningAction.targetStage].title}&rdquo; — assigned to them, and notify them.
                </p>
              </div>
            )}

            {/* UCC number — required for "UCC activated"; saved on the client. */}
            {transitioningAction.targetStage === "ucc_activated" && (
              <div className="space-y-1 border-t border-b border-border py-3">
                <label className="text-xs text-foreground font-medium">
                  UCC number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={uccNumber}
                  onChange={(e) => setUccNumber(e.target.value)}
                  placeholder="e.g. 1234567"
                  className="input-base text-xs w-full"
                />
                <p className="text-[10px] text-muted-foreground">
                  We'll save this UCC on the client's profile.
                </p>
              </div>
            )}

            {/* Mandate details — required for "Mandate Activated". */}
            {transitioningAction.targetStage === "mandate_activated" && (
              <div className="space-y-3 border-t border-b border-border py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-cyan">
                  Mandate details
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground font-medium">
                    Bank account <span className="text-rose-500">*</span>
                  </label>
                  {mandateBanks.length > 0 ? (
                    <select
                      value={mandateBankIdx}
                      onChange={(e) => setMandateBankIdx(e.target.value)}
                      className="input-base text-xs w-full"
                    >
                      <option value="">— select bank —</option>
                      {mandateBanks.map((b, i) => (
                        <option key={i} value={String(i)}>
                          {[b.bankName, b.accountMasked, b.ifsc].filter(Boolean).join(" · ") || `Account ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={mandateBankName}
                      onChange={(e) => setMandateBankName(e.target.value)}
                      placeholder="Bank name"
                      className="input-base text-xs w-full"
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground font-medium">
                    Mandate amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={mandateAmount}
                    onChange={(e) => setMandateAmount(e.target.value)}
                    placeholder="e.g. 25000"
                    className="input-base text-xs w-full"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Max amount the NACH / e-mandate authorises per debit.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground font-medium">
                    Mandate reference / UMRN (approval no.)
                  </label>
                  <input
                    type="text"
                    value={mandateRef}
                    onChange={(e) => setMandateRef(e.target.value)}
                    placeholder="e.g. HDFC6100000012345"
                    className="input-base text-xs w-full"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Marks the mandate Active on the client's profile.
                  </p>
                </div>
              </div>
            )}

            {/* Remarks / Notes */}
            <div className="space-y-1">
              <label className="text-xs text-foreground font-medium">
                Transition Notes / Remarks (Optional)
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Capture notes about this status update..."
                className="input-base text-xs w-full"
              />
            </div>

            {error && (
              <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 flex items-start gap-1.5">
                <AlertTriangle className="size-3.5 mt-0.5" /> {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setTransitioningAction(null);
                  setCallBackAt("");
                  setLostReason("");
                  setTaskAssigneeId("");
                  setTaskDueAt("");
                  setMandateBanks([]);
                  setMandateBankIdx("");
                  setMandateBankName("");
                  setMandateAmount("");
                  setMandateRef("");
                  setError(null);
                }}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCompleteTransition}
                disabled={submitting}
                className="btn-primary text-xs bg-brand-cyan hover:bg-brand-cyan-deep text-white font-semibold flex items-center gap-1"
              >
                {submitting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Save & Transition
              </button>
            </div>
            </div>{/* /scrollable body */}
          </div>
        </div>,
        document.body,
      )}

      {/* Documents Received — collect the client's details on their behalf */}
      {collectOpen && (
        <CollectDetailsModal
          loading={collectLoading}
          fields={collectFields}
          values={collectValues}
          onChange={(k, v) => setCollectValues((prev) => ({ ...prev, [k]: v }))}
          submitting={collectSubmitting}
          error={collectError}
          onCancel={() => setCollectOpen(false)}
          onSubmit={submitCollectDetails}
        />
      )}

      {/* Schedule-meeting popup — pre-filled with this lead, closes on success.
          The smart auto-advance (meeting created → appointment_scheduled) moves
          the blueprint, so we just refresh. */}
      <ScheduleMeetingModal
        open={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        preselectedLeadId={leadId}
        preselectedCategory="follow_up"
        onSuccess={() => {
          setMeetingModalOpen(false);
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
        }}
      />

      {/* Complete-meeting popup — mark the lead's scheduled meeting completed
          inline; completing it auto-advances the blueprint to Meeting Done. */}
      <CompleteMeetingModal
        open={completeMeetingOpen}
        leadId={leadId}
        onClose={() => setCompleteMeetingOpen(false)}
        onSuccess={() => {
          setCompleteMeetingOpen(false);
          setOutcome(null);
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
        }}
      />
    </div>
  );
}

function CollectDetailsModal({
  loading,
  fields,
  values,
  onChange,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  loading: boolean;
  fields: KycField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  // Group VISIBLE fields by section (showIf conditionals collapse live).
  const sections: Array<[string, KycField[]]> = [];
  for (const f of fields) {
    if (!isFieldVisible(f, values)) continue;
    let g = sections.find((s) => s[0] === f.section);
    if (!g) {
      g = [f.section, []];
      sections.push(g);
    }
    g[1].push(f);
  }

  return typeof document === "undefined" ? null : createPortal(
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-2xl w-full shadow-2xl text-foreground flex flex-col max-h-[88vh]">
        <div className="flex items-center gap-2 border-b border-border p-5">
          <Sparkles className="size-5 text-brand-cyan" />
          <div>
            <h3 className="font-bold text-base">Confirm documents received — fill the client's details</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter the account-opening details on the client's behalf. Saved straight to the client master, then this
              moves to Documents Received.
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="size-4 animate-spin" /> Loading the form…
            </div>
          ) : (
            sections.map(([section, fs]) => (
              <div key={section} className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-cyan">{section}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fs.map((f) => (
                    <CollectField key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} />
                  ))}
                </div>
              </div>
            ))
          )}

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onCancel} className="btn-secondary text-xs" disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || loading}
            className="btn-primary text-xs bg-brand-cyan hover:bg-brand-cyan-deep text-white font-semibold flex items-center gap-1"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Save & mark Documents Received
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CollectField({ field, value, onChange }: { field: KycField; value: string; onChange: (v: string) => void }) {
  const cls = "input-base text-xs w-full";
  return (
    <label className="block">
      <div className="text-xs font-medium text-foreground mb-1">
        {field.label}
        {field.required && <span className="text-rose-500 ml-1">*</span>}
      </div>
      {field.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">— select —</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === "tel" ? "tel" : field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          className={cls}
        />
      )}
      {field.helpText && <div className="text-[10px] text-muted-foreground mt-1">{field.helpText}</div>}
    </label>
  );
}

function SentPanel({
  outcome,
  onDismiss,
}: {
  outcome: Extract<Outcome, { kind: "sent" }>;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ok = outcome.ok !== false;
  const c = ok
    ? { border: "border-emerald-300", bg: "bg-emerald-50/70", chip: "bg-emerald-100", icon: "text-emerald-700", title: "text-emerald-900", body: "text-emerald-800/90", link: "text-emerald-800" }
    : { border: "border-amber-300", bg: "bg-amber-50/70", chip: "bg-amber-100", icon: "text-amber-700", title: "text-amber-900", body: "text-amber-800/90", link: "text-amber-800" };

  async function copyLink() {
    if (!outcome.url) return;
    try {
      await navigator.clipboard.writeText(outcome.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the input is still selectable as a fallback */
    }
  }

  return (
    <div className={`rounded-xl border-2 ${c.border} ${c.bg} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`size-9 rounded-lg ${c.chip} grid place-items-center flex-shrink-0`}>
          {ok ? <CheckCircle2 className={`size-4 ${c.icon}`} /> : <AlertTriangle className={`size-4 ${c.icon}`} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${c.title}`}>{ok ? "Document link ready" : "Couldn’t auto-send — copy the link below"}</div>
          <p className={`text-xs ${c.body} mt-0.5`}>{outcome.message}</p>
        </div>
        <button type="button" onClick={onDismiss} className={`text-xs ${c.link} hover:underline flex-shrink-0`}>
          Dismiss
        </button>
      </div>

      {/* Copyable secure link — the advisor sends it however they prefer. */}
      {outcome.url && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={outcome.url}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 border border-border rounded-md px-2 py-1.5 text-xs font-mono bg-white text-slate-800 min-w-0"
            />
            <button
              type="button"
              onClick={copyLink}
              className="rounded-md border border-border bg-white px-2.5 text-xs flex items-center gap-1 hover:bg-secondary text-slate-700 flex-shrink-0"
            >
              <Copy className="size-3" /> {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {outcome.waMeUrl && (
            <a
              href={outcome.waMeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs ${c.link} underline inline-flex items-center gap-1 font-medium`}
            >
              📲 Open in WhatsApp <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Format an epoch-ms into a `datetime-local` value (YYYY-MM-DDTHH:mm) at 10:00
 *  local — the default next-touch reminder time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

function toneClass(tone: StageAction["tone"]): string {
  switch (tone) {
    case "primary":
      return "btn-primary";
    case "success":
      return "btn-primary !bg-emerald-600 hover:!bg-emerald-700";
    case "danger":
      return "btn-secondary !text-rose-700 !border-rose-300 hover:!bg-rose-50";
    case "secondary":
    default:
      return "btn-secondary";
  }
}
