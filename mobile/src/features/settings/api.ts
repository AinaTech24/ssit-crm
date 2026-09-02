/**
 * Settings data layer — profile bundle + self-service actions (edit name,
 * change password, sign-out-everywhere), the 2FA TOTP flow, and tenant theme.
 * All against the same endpoints the web settings pages use.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { palette } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";

export interface LeaveBalance { type: string; label: string; entitlement: number | null; used: number; remaining: number | null }
export interface Activity { action: string; entityType: string | null; at: string }
export interface Profile {
  user: { name: string; email: string; emailVerified: boolean; avatarUrl: string | null; department: string | null; roleLabel: string };
  twoFaEnabled: boolean;
  targets: { annual: number | null; sipMonthly: number | null };
  leave: LeaveBalance[];
  activity: Activity[];
}

export function useProfile() {
  return useQuery({ queryKey: ["me-profile"], queryFn: () => api.get<Profile>("/api/me/profile"), staleTime: 30_000 });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; avatarUrl?: string }) => api.patch("/api/me/profile", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-profile"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post("/api/me/password", body),
  });
}

export function useSignOutEverywhere() {
  return useMutation({ mutationFn: () => api.post("/api/me/sign-out-everywhere", {}) });
}

export function useSendVerifyEmail() {
  return useMutation({ mutationFn: () => api.post("/api/auth/verify-email", {}) });
}

// ── 2FA (TOTP) ──
export function useTwoFaSetup() {
  return useMutation({ mutationFn: () => api.post<{ secret: string; otpauthUri: string; qrDataUrl: string }>("/api/auth/2fa/setup", {}) });
}
export function useTwoFaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ ok: boolean; backupCodes: string[] }>("/api/auth/2fa/enable", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-profile"] }),
  });
}
export function useTwoFaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post("/api/auth/2fa/disable", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-profile"] }),
  });
}

// ── Tenant theme ──
export function useTenant() {
  return useQuery({ queryKey: ["tenant"], queryFn: () => api.get<any>("/api/tenant"), staleTime: 60_000 });
}

/** Seed + live-update the app brand colour from the tenant's appearance theme.
 *  Mount once near the app root; re-applies whenever the tenant query refreshes
 *  (e.g. after saving Appearance → the theme reflects instantly, app-wide). */
export function useApplyTenantBrand() {
  const { data } = useTenant();
  useEffect(() => {
    if (!data) return;
    const t = data.tenant ?? data;
    useBrand.getState().setBrand(t?.primaryColor || null, t?.secondaryColor || null);
  }, [data]);
}
export function useSaveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) => api.patch("/api/tenant", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant"] }),
  });
}

/** Save any subset of the organisation profile (PATCH /api/tenant). */
export function useSaveOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.patch("/api/tenant", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ── Custom fields ──
export interface CustomField { id: string; entity: string; label: string; type: string; key: string; options?: string[] | null }
export function useCustomFields(entity: string) {
  return useQuery({ queryKey: ["custom-fields", entity], queryFn: () => api.get<{ fields: CustomField[] }>("/api/settings/custom-fields", { entity }), staleTime: 30_000 });
}
export function useAddCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entity: string; label: string; type: string; options?: string[] }) => api.post("/api/settings/custom-fields", body),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["custom-fields", v.entity] }),
  });
}
export function useDeleteCustomField(entity: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/settings/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields", entity] }),
  });
}
export const CUSTOM_FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text area" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

// ── Onboarding form fields ──
export interface OnboardingField { key: string; label: string; section: string; required: boolean }
export function useOnboardingFields() {
  return useQuery({
    queryKey: ["onboarding-fields"],
    queryFn: () => api.get<{ catalog: OnboardingField[]; overrides: Record<string, boolean> }>("/api/settings/onboarding-fields"),
    staleTime: 30_000,
  });
}
export function useSaveOnboardingFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: Record<string, boolean>) => api.put("/api/settings/onboarding-fields", { overrides }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding-fields"] }),
  });
}

// ── Master settings (15 look-up tables) ──
export const MASTER_TYPES = [
  { type: "lead_source", label: "Lead Sources", desc: "Where leads come from — referral, website, ads, etc." },
  { type: "campaign_type", label: "Campaign Types", desc: "Campaign categories used in marketing module." },
  { type: "service_request_type", label: "Service Request Types", desc: "Each type carries an SLA in hours." },
  { type: "task_priority", label: "Task Priority Levels", desc: "Low / Normal / High / Urgent." },
  { type: "client_category", label: "Client Categories", desc: "Individual / HUF / NRI / Corporate / Trust / Minor." },
  { type: "goal_type", label: "Goal Types", desc: "Retirement, Child Education, House, etc." },
  { type: "risk_profile_level", label: "Risk Profile Levels", desc: "Conservative → Very Aggressive." },
  { type: "ddq_checklist_item", label: "DDQ Checklist Items", desc: "Items scored in DDQ readiness." },
  { type: "document_type", label: "Document Types", desc: "Categories used across vault + uploads." },
  { type: "user_role", label: "User Roles", desc: "Roles assignable to team members." },
  { type: "interest_product", label: "Interest Products", desc: "Products leads may be interested in." },
  { type: "occupation", label: "Occupations", desc: "Investor occupation options." },
  { type: "income_range", label: "Income Ranges", desc: "Used in client profiling + segmentation." },
  { type: "meeting_type", label: "Meeting Types", desc: "Portfolio review / Goal review / etc." },
  { type: "relationship", label: "Family Relationships", desc: "Used in family mapping module." },
];
export const masterLabel = (type: string) => MASTER_TYPES.find((m) => m.type === type)?.label ?? type;

export interface MasterValue { id: string; key: string; label: string; description: string | null; isActive: boolean; isSystemDefault: boolean }
export function useMasterValues(type: string) {
  return useQuery({ queryKey: ["master", type], queryFn: () => api.get<{ values: MasterValue[] }>(`/api/masters/${type}`), staleTime: 30_000 });
}
const masterKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "value";
export function useAddMasterValue(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => api.post(`/api/masters/${type}`, { key: masterKey(label), label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master", type] }),
  });
}
export function useDeleteMasterValue(type: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => api.del(`/api/masters/${type}?key=${encodeURIComponent(key)}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["master", type] }) });
}

// ── Desks (sub-branch teams) ──
export interface Desk { id: string; name: string; code?: string | null; branchId: string }
export interface DeskMember { id: string; name: string; branchId: string; deskId: string | null; roles: string[] }
export interface DeskBoard { branches: { id: string; name: string }[]; desks: Desk[]; members: DeskMember[] }
export function useDeskBoard() {
  return useQuery({ queryKey: ["desks"], queryFn: () => api.get<DeskBoard>("/api/desks"), staleTime: 30_000 });
}
export function useCreateDesk() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { branchId: string; name: string }) => api.post("/api/desks", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["desks"] }) });
}
export function useDeleteDesk() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.del(`/api/desks/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["desks"] }) });
}
export function useAssignDesk() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { userId: string; deskId: string | null }) => api.post("/api/desks/assign", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["desks"] }) });
}

// ── Email sender config ──
export function useEmailSender() {
  return useQuery({ queryKey: ["email-sender"], queryFn: () => api.get<{ fromName: string; fromEmail: string; replyTo: string }>("/api/settings/email-sender"), staleTime: 30_000 });
}
export function useSaveEmailSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fromName: string; fromEmail?: string; replyTo?: string }) => api.post("/api/settings/email-sender", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-sender"] }),
  });
}

// ── WhatsApp status (read-only) ──
export function useWhatsAppStatus() {
  return useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => api.get<{ numbers: any[]; templates: { approved: number; pending: number; rejected: number } }>("/api/settings/whatsapp-status"),
    staleTime: 60_000,
  });
}

// ── Targets & quota (per user × metric) ──
export interface TargetMetric { key: string; label: string; team: string; unit: string }
export interface TargetsData {
  fiscalYear: string;
  metrics: TargetMetric[];
  members: { id: string; name: string }[];
  targets: Record<string, Record<string, number>>;
}
export function useTargets() {
  return useQuery({ queryKey: ["targets"], queryFn: () => api.get<TargetsData>("/api/team/targets"), staleTime: 30_000 });
}
export function useSaveTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; metricKey: string; annualTarget: number; fiscalYear: string }) => api.post("/api/team/targets", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["targets"] }),
  });
}

// ── Auto-assignment rules ──
export interface AssignmentRule {
  id: string; name: string; subject_type?: string; subjectType?: string; strategy: string;
  target_user_ids?: string[]; targetUserIds?: string[]; priority: number; is_active?: boolean; isActive?: boolean;
}
export function useAssignmentRules() {
  return useQuery({ queryKey: ["assignment-rules"], queryFn: () => api.get<{ rules: AssignmentRule[] }>("/api/assignment-rules"), staleTime: 30_000 });
}
export function useCreateAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; subjectType: string; strategy: string; targetUserIds: string[]; priority?: number }) => api.post("/api/assignment-rules", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }),
  });
}
export function useDeleteAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.del(`/api/assignment-rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }) });
}
export function useToggleAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; isActive: boolean }) => api.patch(`/api/assignment-rules/${v.id}`, { isActive: v.isActive }), onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }) });
}
export function useEmployeesLite() {
  return useQuery({ queryKey: ["employees-lite"], queryFn: () => api.get<{ rows: { id: string; name: string; roles?: string[] }[] }>("/api/employees"), staleTime: 60_000 });
}

// ── Risk profile questionnaire (template editor) ──
export function useRiskTemplate() {
  return useQuery({ queryKey: ["risk-template-edit"], queryFn: () => api.get<{ template: any }>("/api/risk-profile-template"), staleTime: 30_000 });
}
export function useSaveRiskTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tpl: any) => api.put("/api/risk-profile-template", tpl),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["risk-template-edit"] }); qc.invalidateQueries({ queryKey: ["risk-template"] }); },
  });
}

// ── Blueprints (stage/SLA editor) ──
export interface BlueprintStage { id: string; stageKey: string; stageName: string; stageOrder: number; slaDays: number | null; description: string | null }
export interface Blueprint { id: string; moduleName: string; blueprintName: string | null; stages: BlueprintStage[] }
export function useBlueprints() {
  return useQuery({ queryKey: ["blueprints"], queryFn: () => api.get<{ blueprints: Blueprint[] }>("/api/blueprints"), staleTime: 30_000 });
}
export function useSaveBlueprintStages(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stages: { id: string; stageName: string; description?: string | null; slaDays: number | null }[]) => api.put(`/api/blueprints/${id}/stages`, { stages }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blueprints"] }),
  });
}

/** Password strength (mirrors the web pwStrength). */
export function pwStrength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(3, Math.max(0, s - 1));
  const meta = [
    { label: "Weak", color: palette.danger },
    { label: "Fair", color: palette.warning },
    { label: "Good", color: palette.info },
    { label: "Strong", color: palette.success },
  ][score];
  return { score, ...meta };
}

export const THEME_PRESETS = [
  { key: "ssit", label: "SSIT Navy", primary: "#0e2557", accent: "#0ea5e9" },
  { key: "emerald", label: "Emerald", primary: "#064e3b", accent: "#10b981" },
  { key: "royal", label: "Royal Purple", primary: "#3b0764", accent: "#a855f7" },
  { key: "sunset", label: "Sunset Orange", primary: "#7c2d12", accent: "#f97316" },
  { key: "crimson", label: "Crimson", primary: "#4c0519", accent: "#f43f5e" },
  { key: "teal", label: "Teal", primary: "#134e4a", accent: "#14b8a6" },
  { key: "graphite", label: "Graphite", primary: "#1e293b", accent: "#475569" },
  { key: "indigo", label: "Indigo", primary: "#1e1b4b", accent: "#6366f1" },
];
export const THEME_FONTS = [
  { value: "inter", label: "Inter (default)" },
  { value: "system", label: "System UI" },
  { value: "serif", label: "Serif" },
  { value: "rounded", label: "Rounded" },
  { value: "mono", label: "Monospace" },
];
export const UI_DENSITIES = [
  { value: "comfortable", label: "Comfortable (default)" },
  { value: "compact", label: "Compact" },
];
