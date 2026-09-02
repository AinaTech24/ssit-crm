"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Phone,
  Mail,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  Building,
  Sparkles,
  User,
  Activity,
  Calendar,
} from "lucide-react";
import { formatINR } from "@/lib/utils";

type Stage = {
  key: string;
  name: string;
  order: number;
  status: "done" | "current" | "upcoming";
  phase?: "lead" | "client";
};

type HistoryRow = {
  stageKey: string;
  stageName: string;
  enteredAt: Date | string;
  exitedAt: Date | string | null;
  durationSeconds: number | null;
  breachedSla: boolean;
};

type StageView = {
  current: {
    key: string;
    name: string;
    description: string | null;
    ownerRole: string | null;
    order: number;
    slaDays: number | null;
    allowedActions: string[];
    requiredFields: string[];
    secondsInStage: number;
    slaRemainingDays: number | null;
    isDelayed: boolean;
  };
  allStages: Stage[];
  history: HistoryRow[];
};

interface PublicOnboardingVisualizerProps {
  recipientName: string;
  tenant: {
    displayName: string | null;
    legalName: string;
    arn: string | null;
    email?: string | null;
    phone?: string | null;
  };
  stageDetails: StageView;
  rm: {
    name: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
}

export function PublicOnboardingVisualizer({
  recipientName,
  tenant,
  stageDetails,
  rm,
}: PublicOnboardingVisualizerProps) {
  const { current, allStages, history } = stageDetails;

  // Calculate overall progress stats
  const completedCount = allStages.filter((s) => s.status === "done").length;
  const progressPct = Math.round((completedCount / allStages.length) * 100);

  // Group 30 stages into 5 user-friendly phases
  const phases = [
    {
      id: "discovery",
      name: "Discovery & Discussion",
      description: "Initial contact, goal identification, and suitability profiling.",
      stageOrders: [1, 2, 3, 4, 5, 6, 7, 8],
      icon: Phone,
    },
    {
      id: "onboarding",
      name: "Onboarding & Document Capture",
      description: "Collecting KYC documents and completing the risk profile questionnaire.",
      stageOrders: [9, 10, 11, 12, 13],
      icon: FileText,
    },
    {
      id: "kyc",
      name: "KYC & Compliance Verification",
      description: "Verifying your KYC status and completing e-KYC or offline IPV checks.",
      stageOrders: [14, 15, 16, 17, 18, 19],
      icon: ShieldCheck,
    },
    {
      id: "account",
      name: "Exchange Code & Mandate Setup",
      description: "Registering your client code (UCC) and setting up your bank SIP mandates.",
      stageOrders: [20, 21, 22, 23, 24],
      icon: Building,
    },
    {
      id: "activation",
      name: "Investment Placement & Activation",
      description: "Executing your first orders, mapping accounts, and finalizing activation.",
      stageOrders: [25, 26, 27, 28, 29, 30],
      icon: Sparkles,
    },
  ];

  // Track expanded phases (default expand the phase that has the "current" stage)
  const defaultExpanded = phases.reduce<Record<string, boolean>>((acc, phase) => {
    const hasCurrentStage = allStages.some(
      (s) => phase.stageOrders.includes(s.order) && s.status === "current"
    );
    acc[phase.id] = hasCurrentStage;
    return acc;
  }, {});

  // If no phase has current stage (e.g. onboarding completed), expand the last phase
  if (!Object.values(defaultExpanded).some(Boolean)) {
    defaultExpanded[phases[phases.length - 1].id] = true;
  }

  const [expanded, setExpanded] = useState<Record<string, boolean>>(defaultExpanded);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper to format date nicely
  const formatDateString = (dateVal: Date | string) => {
    return new Date(dateVal).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // Helper to resolve stage status and completion timestamp
  const getStageLog = (stageKey: string) => {
    const log = history.find((h) => h.stageKey === stageKey && h.exitedAt);
    if (log) {
      return {
        completed: true,
        date: formatDateString(log.exitedAt!),
      };
    }
    // If it's the current active stage, we can look up enteredAt
    const activeLog = history.find((h) => h.stageKey === stageKey && !h.exitedAt);
    if (activeLog) {
      return {
        current: true,
        date: `Started ${formatDateString(activeLog.enteredAt)}`,
      };
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Welcome & Progress Card */}
      <div className="rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden bg-white">
        <div className="absolute top-0 right-0 p-4 opacity-[0.04]">
          <Activity className="size-32 text-brand-cyan" />
        </div>
        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-xs font-semibold tracking-wider text-brand-cyan uppercase">
                Live Onboarding Tracker
              </span>
              <h2 className="text-2xl font-bold text-slate-900 mt-1">Hello, {recipientName}</h2>
              <p className="text-sm text-slate-500 mt-1">
                We are setting up your mutual fund investment account. Track each step of the journey below.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Current Step</div>
              <div className="text-sm font-semibold text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/30 px-3 py-1 rounded-full mt-1 inline-block">
                {current.name}
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium">Account Setup Progress</span>
              <span className="font-bold text-brand-cyan">{progressPct}% Complete</span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{completedCount} stages completed</span>
              <span>{allStages.length - completedCount} pending</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Phases Timeline */}
      <div className="space-y-4">
        {phases.map((phase, idx) => {
          // Determine status of the phase
          const phaseStages = allStages.filter((s) => phase.stageOrders.includes(s.order));
          const isDone = phaseStages.every((s) => s.status === "done");
          const isCurrent = phaseStages.some((s) => s.status === "current");
          const isUpcoming = !isDone && !isCurrent;

          const PhaseIcon = phase.icon;

          return (
            <div
              key={phase.id}
              className={`rounded-xl border transition-all duration-300 ${
                isCurrent
                  ? "border-brand-cyan/50 bg-cyan-50/50 shadow-sm"
                  : isDone
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-slate-200 bg-white"
              }`}
            >
              {/* Phase Header */}
              <div
                onClick={() => toggleExpand(phase.id)}
                className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none"
              >
                <div className="flex items-center gap-4">
                  {/* Status Indicator / Icon */}
                  <div
                    className={`size-10 rounded-xl grid place-items-center flex-shrink-0 transition-all duration-300 ${
                      isDone
                        ? "bg-emerald-100 text-emerald-600 border border-emerald-200"
                        : isCurrent
                        ? "bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30"
                        : "bg-slate-100 text-slate-400 border border-slate-200"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="size-5" />
                    ) : (
                      <PhaseIcon className="size-5" />
                    )}
                  </div>

                  <div>
                    <h3 className={`font-semibold text-base flex items-center gap-2 ${isUpcoming ? "text-slate-500" : "text-slate-900"}`}>
                      {phase.name}
                      {isCurrent && (
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{phase.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-slate-400">
                  <span className="text-xs font-mono hidden sm:inline-block">
                    {phaseStages.filter((s) => s.status === "done").length} / {phaseStages.length}
                  </span>
                  {expanded[phase.id] ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </div>
              </div>

              {/* Phase Sub-stages (Collapsible accordion) */}
              {expanded[phase.id] && (
                <div className="px-5 pb-5 pt-1 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
                  <div className="relative pl-6 space-y-4 border-l border-slate-200 mt-2">
                    {phaseStages.map((stage) => {
                      const log = getStageLog(stage.key);
                      const isStageCurrent = stage.status === "current";
                      const isStageDone = stage.status === "done";

                      return (
                        <div key={stage.key} className="relative">
                          {/* Stepper Dot */}
                          <div
                            className={`absolute -left-[31px] top-1.5 size-4 rounded-full border transition-all duration-300 ${
                              isStageDone
                                ? "bg-emerald-500 border-emerald-400 text-white grid place-items-center"
                                : isStageCurrent
                                ? "bg-brand-cyan border-brand-cyan ring-4 ring-brand-cyan/20 animate-pulse"
                                : "bg-white border-slate-300"
                            }`}
                          >
                            {isStageDone && <div className="size-1 bg-white rounded-full" />}
                          </div>

                          <div className="flex flex-wrap items-start justify-between gap-2 pl-2">
                            <div>
                              <div
                                className={`text-sm font-medium ${
                                  isStageCurrent
                                    ? "text-brand-cyan font-bold"
                                    : isStageDone
                                    ? "text-slate-700"
                                    : "text-slate-400"
                                }`}
                              >
                                {stage.name}
                              </div>
                              {isStageCurrent && current.description && (
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-xl">
                                  {current.description}
                                </p>
                              )}
                            </div>

                            <div>
                              {log ? (
                                <span className={`text-[10px] flex items-center gap-1 font-mono ${
                                  isStageCurrent ? "text-brand-cyan" : "text-slate-500"
                                }`}>
                                  {isStageDone ? (
                                    <>
                                      <CheckCircle2 className="size-3 text-emerald-500" />
                                      {log.date}
                                    </>
                                  ) : (
                                    <>
                                      <Clock className="size-3 text-brand-cyan" />
                                      {log.date}
                                    </>
                                  )}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-mono">Pending</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RM Contact Section */}
      {rm && (
        <div className="p-5 border border-slate-200 bg-white shadow-sm rounded-xl flex flex-col sm:flex-row items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-white font-bold grid place-items-center text-lg shadow-inner flex-shrink-0">
              {rm.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="text-center sm:text-left">
              <h4 className="text-sm font-semibold text-slate-900">Your Relationship Manager</h4>
              <p className="text-xs text-slate-500 mt-0.5">{rm.name}</p>
            </div>
          </div>

          <div className="flex gap-2">
            {rm.phone && (
              <a
                href={`tel:${rm.phone}`}
                className="text-xs px-3 py-2 flex items-center gap-1.5 border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-all rounded-lg font-medium"
              >
                <Phone className="size-3.5" /> Call RM
              </a>
            )}
            <a
              href={`mailto:${rm.email}`}
              className="text-xs px-3 py-2 flex items-center gap-1.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 transition-all text-white rounded-lg font-medium"
            >
              <Mail className="size-3.5" /> Email RM
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
