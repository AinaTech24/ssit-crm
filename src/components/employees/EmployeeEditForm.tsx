"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  AlertCircle,
  Upload,
  Trash2,
  Loader2,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  History,
  TrendingUp,
  User,
  Users,
  AlertTriangle,
  ArrowRight,
  Briefcase
} from "lucide-react";
import { can, type Capability } from "@/lib/auth/rbac";
import { NAV_ACCESS_GROUPS, roleDefaultNavKeys } from "@/config/nav-access";
import { CAPABILITY_GROUPS } from "@/lib/auth/capability-catalog";
import { formatINR, formatDate } from "@/lib/utils";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "back_office", label: "Back Office" },
  { value: "compliance", label: "Compliance" },
  { value: "marketing", label: "Marketing" },
  { value: "advisory", label: "Advisory" },
  { value: "support", label: "Support" },
  { value: "leadership", label: "Leadership" },
  { value: "other", label: "Other" },
];

const ROLES = [
  { key: "owner", label: "Owner / Admin" },
  { key: "rm", label: "Relationship Manager" },
  { key: "branch_head", label: "Branch Head" },
  { key: "back_office", label: "Back Office" },
  { key: "marketing", label: "Marketing" },
  { key: "compliance", label: "Compliance / DDQ" },
  { key: "team_member", label: "Limited Team Member" },
];

const STATUSES = [
  { value: "invited", label: "Invited (not yet activated)" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "offboarding", label: "Offboarding" },
  { value: "offboarded", label: "Offboarded" },
];

// Grantable capabilities come from the shared catalog, which is exhaustive by
// type (Record<Capability, …>). The list that used to live here drifted: 15
// real capabilities were enforced by the API but missing from these
// checkboxes, so no owner could ever grant them.
const ALL_CAPABILITIES = CAPABILITY_GROUPS;

export type EmployeeFormValues = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  department: string | null;
  joiningDate: string | null;
  reportingManagerId: string | null;
  annualTarget: number | null;
  sipMonthlyTarget: number | null;
  notes: string;
  employeeCode: string;
  distributingAmcs: string[];
  nismCertificateNo: string;
  nismExamDate: string | null;
  nismExpiryAt: string | null;
  nismCategory: string;
  personalArn: string;
  arnRegistrationDate: string | null;
  arnExpiryAt: string | null;
  euin: string;
  euinExpiryAt: string | null;
  dscSubmitted: boolean;
  dscLastSubmittedAt: string | null;
  dscExpiryAt: string | null;
  status: string;
  permissions: string[] | null;
  /** Per-user sidebar module grant. null = inherit all the firm's modules. */
  enabledModules: string[] | null;
  customLeaveEntitlements: Partial<Record<string, number>> | null;
};

export function EmployeeEditForm({
  employee,
  teammates,
  docs = [],
  logs = [],
  tasks = [],
  meetings = [],
  stats = {},
  tenantNavKeys = [],
}: {
  employee: EmployeeFormValues;
  teammates: { id: string; name: string; email: string | null }[];
  /** Sidebar item hrefs the firm can open (the pool an owner can grant). */
  tenantNavKeys?: string[];
  docs?: any[];
  logs?: any[];
  tasks?: any[];
  meetings?: any[];
  stats?: any;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"profile" | "handover" | "audit">("profile");
  const [docsList, setDocsList] = useState<any[]>(docs);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const [v, setV] = useState<EmployeeFormValues>({ ...employee, permissions: employee.permissions || [] });
  const [customActive, setCustomActive] = useState(!!employee.permissions);
  // Per-user module (sidebar) access. null = inherit all the firm's modules.
  const [moduleAccessActive, setModuleAccessActive] = useState(!!employee.enabledModules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleRole(k: string) {
    setV((p) => ({ ...p, roles: p.roles.includes(k) ? p.roles.filter((r) => r !== k) : [...p.roles, k] }));
  }
  
  const togglePermission = (cap: string) => {
    setV((p) => {
      const prevPerms = p.permissions || [];
      const next = prevPerms.includes(cap)
        ? prevPerms.filter((x) => x !== cap)
        : [...prevPerms, cap];
      return { ...p, permissions: next };
    });
  };

  const toggleModule = (mod: string) => {
    setV((p) => {
      const prev = p.enabledModules || [];
      const next = prev.includes(mod) ? prev.filter((x) => x !== mod) : [...prev, mod];
      return { ...p, enabledModules: next };
    });
    setSaved(false);
  };

  const isOwnerRole = v.roles.includes("owner");
  // The firm's accessible sidebar items, grouped — the pool the owner grants from.
  const tenantNavSet = new Set(tenantNavKeys);
  const accessibleNavGroups = NAV_ACCESS_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter((i) => tenantNavSet.has(i.key)),
  })).filter((g) => g.items.length > 0);

  function update<K extends keyof EmployeeFormValues>(k: K, val: EmployeeFormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setSaved(false);
  }

  async function handleFileUpload(file: File, category: string, fieldName: string) {
    setUploadingField(fieldName);
    try {
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          kind: category === "other" ? "general" : category,
          docType: fieldName,
          clientName: employee?.name ?? undefined,
        }),
      });
      const presignJson = await presign.json();
      if (!presign.ok) throw new Error(presignJson.error ?? "Presign failed");

      const put = await fetch(presignJson.url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload to S3 failed");

      const reg = await fetch("/api/compliance/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          name: file.name,
          description: `${fieldName} for employee ${employee.name}`,
          storageKey: presignJson.key,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          relatedEntityType: "user",
          relatedEntityId: employee.id,
        }),
      });
      const regJson = await reg.json();
      if (!reg.ok) throw new Error(regJson.error ?? "Registration failed");

      const newDoc = {
        id: regJson.id,
        category,
        name: file.name,
        storageKey: presignJson.key,
      };
      setDocsList((prev) => [...prev, newDoc]);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingField(null);
    }
  }

  async function handleFileDelete(docId: string) {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      const res = await fetch(`/api/compliance/documents?id=${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Delete failed");
      }
      setDocsList((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  function renderUploadField(category: string, label: string) {
    const doc = docsList.find(
      (d) =>
        d.category === category &&
        (category !== "other" || d.name.toLowerCase().includes("dsc"))
    );

    const isUploading = uploadingField === label;

    if (doc) {
      return (
        <div className="mt-2 flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-md p-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="size-3.5 text-emerald-600 shrink-0" />
            <span className="truncate font-medium text-emerald-800">{doc.name}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <DownloadButton
              url={`/api/compliance/documents/download?id=${doc.id}`}
              className="text-emerald-700 hover:text-emerald-900 font-semibold"
            >
              View File
            </DownloadButton>
            <button
              type="button"
              onClick={() => handleFileDelete(doc.id)}
              className="text-rose-600 hover:text-rose-800"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-2">
        <label className="flex items-center gap-2 border border-dashed rounded-md p-2 bg-secondary/15 hover:bg-secondary/25 cursor-pointer text-xs justify-center transition-all">
          {isUploading ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="size-3.5 text-muted-foreground" />
          )}
          <span className="font-medium text-muted-foreground">
            {isUploading ? "Uploading..." : `Upload ${label}`}
          </span>
          <input
            type="file"
            accept=".pdf,image/*"
            disabled={isUploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleFileUpload(file, category, label);
              }
            }}
            className="hidden"
          />
        </label>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    setSaved(false);
    try {
      const r = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: v.name,
          phone: v.phone || null,
          roles: v.roles,
          permissions: customActive ? (v.permissions || []) : null,
          enabledModules: moduleAccessActive && !isOwnerRole ? (v.enabledModules || []) : null,
          department: v.department || null,
          joiningDate: v.joiningDate || null,
          reportingManagerId: v.reportingManagerId || null,
          annualTarget: v.annualTarget,
          sipMonthlyTarget: v.sipMonthlyTarget,
          notes: v.notes || null,
          employeeCode: v.employeeCode || null,
          distributingAmcs: v.distributingAmcs.length ? v.distributingAmcs : null,
          euin: v.euin || null,
          euinExpiryAt: v.euinExpiryAt || null,
          nismCertificateNo: v.nismCertificateNo || null,
          nismExamDate: v.nismExamDate || null,
          nismExpiryAt: v.nismExpiryAt || null,
          nismCategory: v.nismCategory || null,
          personalArn: v.personalArn || null,
          arnRegistrationDate: v.arnRegistrationDate || null,
          arnExpiryAt: v.arnExpiryAt || null,
          dscSubmitted: v.dscSubmitted,
          dscLastSubmittedAt: v.dscLastSubmittedAt || null,
          dscExpiryAt: v.dscExpiryAt || null,
          status: v.status,
          customLeaveEntitlements: v.customLeaveEntitlements,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Zod issues name the offending field; without them a failed save
        // reads as a bare "invalid input" with nothing to act on.
        const fields = Array.isArray(data?.issues)
          ? data.issues
              .map((i: any) => (Array.isArray(i?.path) ? i.path.join(".") : ""))
              .filter(Boolean)
              .join(", ")
          : "";
        const base = data?.error ?? `Save failed (HTTP ${r.status})`;
        throw new Error(fields ? `${base} — check: ${fields}` : base);
      }
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  // Target Math & Color Codes
  const annualTargetVal = Number(v.annualTarget ?? 0);
  const sipMonthlyTargetVal = Number(v.sipMonthlyTarget ?? 0);
  const myAumVal = Number(stats?.my_aum ?? 0);
  const mySipVal = Number(stats?.my_sip ?? 0);

  const aumProgressPercent = annualTargetVal > 0 ? Math.round((myAumVal / annualTargetVal) * 100) : 0;
  const sipProgressPercent = sipMonthlyTargetVal > 0 ? Math.round((mySipVal / sipMonthlyTargetVal) * 100) : 0;

  const aumProgressColor = aumProgressPercent >= 100 ? "bg-emerald-500 text-emerald-600" : aumProgressPercent >= 50 ? "bg-amber-500 text-amber-600" : "bg-rose-500 text-rose-600";
  const sipProgressColor = sipProgressPercent >= 100 ? "bg-emerald-500 text-emerald-600" : sipProgressPercent >= 50 ? "bg-amber-500 text-amber-600" : "bg-rose-500 text-rose-600";

  return (
    <div className="space-y-6">
      {/* Tabs Selection Header */}
      <div className="flex border-b border-border/80">
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all flex items-center gap-2 ${
            activeTab === "profile"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <User className="size-4" /> Profile & Credentials
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("handover")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all flex items-center gap-2 ${
            activeTab === "handover"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Briefcase className="size-4" /> Checklists & Handover
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all flex items-center gap-2 ${
            activeTab === "audit"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="size-4" /> Activity Log
        </button>
      </div>

      {activeTab === "profile" && (
        <form onSubmit={submit} className="card-surface p-5 space-y-5">
          <h3 className="font-semibold text-sm">Employee details</h3>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2 flex items-start gap-2">
              <AlertCircle className="size-3.5 mt-0.5" /> {error}
            </div>
          )}
          {saved && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-md p-2">✓ Saved</div>}

          {/* Identity row */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee Name *">
              <input value={v.name} onChange={(e) => update("name", e.target.value)} className="input-base text-sm w-full" required />
            </Field>
            <Field label="Email (read-only)">
              <input value={v.email} disabled className="input-base text-sm w-full bg-secondary/50" />
            </Field>
            <Field label="Mobile">
              <input value={v.phone} onChange={(e) => update("phone", e.target.value)} className="input-base text-sm w-full" placeholder="+91 9xxxxxxxxx" />
            </Field>
            <Field label="Status">
              <SelectField value={v.status} onChange={(e) => update("status", e.target.value)} size="sm" className="w-full">
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </SelectField>
            </Field>
          </div>

          {/* Target Progress Visualization Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4 bg-secondary/5">
            <div>
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>Annual AUM Target</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatINR(myAumVal)} / {annualTargetVal > 0 ? formatINR(annualTargetVal) : "No target set"}
                </span>
              </div>
              {annualTargetVal > 0 ? (
                <div className="mt-2 space-y-1">
                  <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${aumProgressColor.split(" ")[0]}`}
                      style={{ width: `${Math.min(100, aumProgressPercent)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-bold text-right">
                    <span className={aumProgressColor.split(" ")[1]}>{aumProgressPercent}% Completed</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-2 italic">Set an annual target below to track progress.</div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>Monthly SIP Target</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatINR(mySipVal)} / {sipMonthlyTargetVal > 0 ? formatINR(sipMonthlyTargetVal) : "No target set"}
                </span>
              </div>
              {sipMonthlyTargetVal > 0 ? (
                <div className="mt-2 space-y-1">
                  <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${sipProgressColor.split(" ")[0]}`}
                      style={{ width: `${Math.min(100, sipProgressPercent)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-bold text-right">
                    <span className={sipProgressColor.split(" ")[1]}>{sipProgressPercent}% Completed</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-2 italic">Set a monthly SIP target below to track progress.</div>
              )}
            </div>
          </div>

          {/* Roles */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Roles</div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {ROLES.map((r) => (
                <label key={r.key} className="flex items-center gap-1.5 border rounded-md p-1.5 cursor-pointer hover:bg-secondary/40 text-xs">
                  <input type="checkbox" checked={v.roles.includes(r.key)} onChange={() => toggleRole(r.key)} />
                  {r.label}
                </label>
              ))}
            </div>
          </div>

          {/* Custom Permissions Override */}
          <div className="border rounded-lg p-4 bg-secondary/10 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold">Customize Access Permissions</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Override default role-based capabilities and dashboard/report access.
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={customActive}
                  onChange={(e) => {
                    setCustomActive(e.target.checked);
                    if (e.target.checked && (!v.permissions || v.permissions.length === 0)) {
                      const defaults: string[] = [];
                      ALL_CAPABILITIES.forEach((grp) => {
                        grp.items.forEach((item) => {
                          if (can(v.roles, item.key as Capability)) {
                            defaults.push(item.key);
                          }
                        });
                      });
                      setV((prev) => ({ ...prev, permissions: defaults }));
                    }
                    setSaved(false);
                  }}
                />
                <span>Customize</span>
              </label>
            </div>

            {customActive && (
              <div className="space-y-4 max-h-[300px] overflow-y-auto border rounded-md p-3 bg-card scrollbar-thin">
                {ALL_CAPABILITIES.map((grp) => (
                  <div key={grp.group} className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-0.5">
                      {grp.group}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {grp.items.map((item) => {
                        const isChecked = v.permissions?.includes(item.key) ?? false;
                        return (
                          <label
                            key={item.key}
                            className="flex items-center gap-2 border rounded p-1.5 hover:bg-secondary/40 text-[11px] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(item.key)}
                            />
                            <span className="min-w-0">
                              {item.label}
                              {item.hint && (
                                <span className="block text-[10px] text-muted-foreground">{item.hint}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!customActive && (
              <div className="text-[11px] text-muted-foreground bg-secondary/30 p-2.5 rounded border">
                Using default permissions determined by selected roles:{" "}
                <strong className="text-foreground">{v.roles.join(", ")}</strong>. Check "Customize" to set granular access overrides.
              </div>
            )}
          </div>

          {/* Sidebar Access (MFD owner → team member) */}
          <div className="border rounded-lg p-4 bg-secondary/10 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold">Sidebar Access</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Choose which sidebar items this team member can open — limited to what your firm has.
                </div>
              </div>
              {!isOwnerRole && (
                <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={moduleAccessActive}
                    onChange={(e) => {
                      setModuleAccessActive(e.target.checked);
                      if (e.target.checked && (!v.enabledModules || v.enabledModules.length === 0)) {
                        // Seed from what this person can ALREADY see, not from
                        // the whole firm — for a role with a narrow default
                        // (back office) ticking "Limit access" used to silently
                        // widen them to everything before the admin touched a
                        // single box.
                        const roleDefault = roleDefaultNavKeys(v.roles);
                        const seed = roleDefault
                          ? tenantNavKeys.filter((k) => roleDefault.includes(k))
                          : [...tenantNavKeys];
                        setV((prev) => ({ ...prev, enabledModules: seed }));
                      }
                      setSaved(false);
                    }}
                  />
                  <span>Limit access</span>
                </label>
              )}
            </div>

            {isOwnerRole ? (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 p-2.5 rounded">
                Owners always have full access to every sidebar item your firm has — limits don&apos;t apply to owner
                accounts.
              </div>
            ) : !moduleAccessActive ? (
              <div className="text-[11px] text-muted-foreground bg-secondary/30 p-2.5 rounded border">
                Full access to all {tenantNavKeys.length} sidebar item{tenantNavKeys.length === 1 ? "" : "s"} your firm
                has. Check &quot;Limit access&quot; to restrict this team member.
              </div>
            ) : accessibleNavGroups.length === 0 ? (
              <div className="text-[11px] text-muted-foreground bg-secondary/30 p-2.5 rounded border">
                Your firm has no sidebar items enabled yet.
              </div>
            ) : (
              <div className="space-y-3 max-h-[340px] overflow-y-auto border rounded-md p-3 bg-card scrollbar-thin">
                <div className="flex gap-3 text-[11px] font-medium">
                  <button
                    type="button"
                    onClick={() => { setV((p) => ({ ...p, enabledModules: [...tenantNavKeys] })); setSaved(false); }}
                    className="text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => { setV((p) => ({ ...p, enabledModules: [] })); setSaved(false); }}
                    className="text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                  <span className="text-muted-foreground ml-auto">
                    {v.enabledModules?.length ?? 0}/{tenantNavKeys.length}
                  </span>
                </div>
                {accessibleNavGroups.map((grp) => {
                  const groupKeys = grp.items.map((i) => i.key);
                  const allOn = groupKeys.every((k) => v.enabledModules?.includes(k));
                  return (
                  <div key={grp.title} className="space-y-1.5">
                    <div className="flex items-center justify-between border-b pb-0.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {grp.title}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setV((p) => {
                            const prev = p.enabledModules || [];
                            const next = allOn ? prev.filter((k) => !groupKeys.includes(k)) : [...new Set([...prev, ...groupKeys])];
                            return { ...p, enabledModules: next };
                          })
                        }
                        className="text-[10px] font-medium text-primary hover:underline"
                      >
                        {allOn ? "Disable all" : "Enable all"}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {grp.items.map((item) => (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 border rounded p-1.5 hover:bg-secondary/40 text-[11px] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={v.enabledModules?.includes(item.key) ?? false}
                            onChange={() => toggleModule(item.key)}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* HR fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <SelectField
                value={v.department ?? ""}
                onChange={(e) => update("department", (e.target.value || null) as any)}
                size="sm"
                className="w-full"
              >
                <option value="">Select…</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </SelectField>
            </Field>
            <Field label="Joining Date">
              <DateField
                value={v.joiningDate ?? ""}
                onChange={(e) => update("joiningDate", e.target.value || null)}
                size="sm"
                className="w-full"
              />
            </Field>
            <Field label="Reporting Manager">
              <SelectField
                value={v.reportingManagerId ?? ""}
                onChange={(e) => update("reportingManagerId", e.target.value || null)}
                size="sm"
                className="w-full"
              >
                <option value="">(none)</option>
                {teammates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SelectField>
            </Field>
            <Field label="Annual Target (₹)">
              <input
                type="number"
                min={0}
                step={10000}
                value={v.annualTarget ?? ""}
                onChange={(e) => update("annualTarget", e.target.value === "" ? null : Number(e.target.value))}
                className="input-base text-sm w-full"
                placeholder="e.g. 50000000"
              />
            </Field>
            <Field label="Monthly SIP Target (₹)">
              <input
                type="number"
                min={0}
                step={10000}
                value={v.sipMonthlyTarget ?? ""}
                onChange={(e) => update("sipMonthlyTarget", e.target.value === "" ? null : Number(e.target.value))}
                className="input-base text-sm w-full"
                placeholder="e.g. 500000"
              />
            </Field>
          </div>

          {/* Leave Entitlements & Comp-offs overrides */}
          <div className="border rounded-lg p-4 bg-secondary/10 space-y-3">
            <div>
              <div className="text-xs font-semibold">Custom Leave Entitlements & Comp-offs</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Override global default policies for this employee's annual leave allowances.
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Casual Leave">
                <input
                  type="number"
                  min={0}
                  value={v.customLeaveEntitlements?.casual ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                    const current = v.customLeaveEntitlements || {};
                    const next: Partial<Record<string, number>> = { ...current, casual: val! };
                    if (val === undefined) delete next.casual;
                    update("customLeaveEntitlements", Object.keys(next).length ? next : null);
                  }}
                  className="input-base text-sm w-full"
                  placeholder="Default: 12"
                />
              </Field>
              <Field label="Sick Leave">
                <input
                  type="number"
                  min={0}
                  value={v.customLeaveEntitlements?.sick ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                    const current = v.customLeaveEntitlements || {};
                    const next: Partial<Record<string, number>> = { ...current, sick: val! };
                    if (val === undefined) delete next.sick;
                    update("customLeaveEntitlements", Object.keys(next).length ? next : null);
                  }}
                  className="input-base text-sm w-full"
                  placeholder="Default: 6"
                />
              </Field>
              <Field label="Earned Leave">
                <input
                  type="number"
                  min={0}
                  value={v.customLeaveEntitlements?.earned ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                    const current = v.customLeaveEntitlements || {};
                    const next: Partial<Record<string, number>> = { ...current, earned: val! };
                    if (val === undefined) delete next.earned;
                    update("customLeaveEntitlements", Object.keys(next).length ? next : null);
                  }}
                  className="input-base text-sm w-full"
                  placeholder="Default: 15"
                />
              </Field>
              <Field label="Comp-off Balance">
                <div className="flex gap-1.5 items-center">
                  <div className="input-base text-sm font-bold bg-secondary/45 text-center w-full min-h-[38px] flex items-center justify-center">
                    {v.customLeaveEntitlements?.comp_off ?? 0}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const current = v.customLeaveEntitlements || {};
                      const nextVal = (current.comp_off ?? 0) + 1;
                      update("customLeaveEntitlements", { ...current, comp_off: nextVal });
                    }}
                    className="btn-secondary px-2 min-h-[38px]"
                    title="Grant 1 Comp-off Day"
                  >
                    +1d
                  </button>
                  {(v.customLeaveEntitlements?.comp_off ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const current = v.customLeaveEntitlements || {};
                        const nextVal = Math.max(0, (current.comp_off ?? 0) - 1);
                        const next: Partial<Record<string, number>> = { ...current, comp_off: nextVal };
                        update("customLeaveEntitlements", next);
                      }}
                      className="btn-secondary text-rose-600 px-2 min-h-[38px]"
                      title="Deduct 1 Comp-off Day"
                    >
                      -1d
                    </button>
                  )}
                </div>
              </Field>
            </div>
          </div>

          {/* Compliance / licensing */}
          <details className="border rounded-md p-3 bg-secondary/20" open>
            <summary className="text-xs font-semibold cursor-pointer">
              Compliance — ARN / EUIN / NISM / DSC
            </summary>

            {/* HR + AMCs */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Employee Code">
                <input
                  value={v.employeeCode}
                  onChange={(e) => update("employeeCode", e.target.value)}
                  className="input-base text-sm w-full font-mono"
                  placeholder="e.g. EMP-001"
                />
              </Field>
              <Field label="Distributing AMCs (comma-separated)">
                <input
                  value={v.distributingAmcs.join(", ")}
                  onChange={(e) =>
                    update(
                      "distributingAmcs",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    )
                  }
                  className="input-base text-sm w-full"
                  placeholder="HDFC, ICICI, SBI, Axis"
                />
              </Field>
            </div>

            {/* NISM block */}
            <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b pb-0.5">
              NISM
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="NISM Certificate No.">
                <input
                  value={v.nismCertificateNo}
                  onChange={(e) => update("nismCertificateNo", e.target.value)}
                  className="input-base text-sm w-full font-mono"
                />
              </Field>
              <Field label="NISM Category (V-A, V-B, …)">
                <input
                  value={v.nismCategory}
                  onChange={(e) => update("nismCategory", e.target.value)}
                  className="input-base text-sm w-full"
                  placeholder="V-A"
                />
              </Field>
              <Field label="NISM Exam Date">
                <DateField
                  value={v.nismExamDate ?? ""}
                  onChange={(e) => update("nismExamDate", e.target.value || null)}
                  size="sm"
                  className="w-full"
                />
              </Field>
              <Field label="NISM Expiry Date">
                <DateField
                  value={v.nismExpiryAt ?? ""}
                  onChange={(e) => update("nismExpiryAt", e.target.value || null)}
                  size="sm"
                  className="w-full"
                />
              </Field>
            </div>
            {renderUploadField("nism", "NISM Certificate")}

            {/* ARN block */}
            <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b pb-0.5">
              Personal ARN (only for sub-distributors / individual MFDs)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="ARN Number">
                <input
                  value={v.personalArn}
                  onChange={(e) => update("personalArn", e.target.value)}
                  className="input-base text-sm w-full font-mono"
                  placeholder="ARN-123456"
                />
              </Field>
              <Field label="ARN Registration Date">
                <DateField
                  value={v.arnRegistrationDate ?? ""}
                  onChange={(e) =>
                    update("arnRegistrationDate", e.target.value || null)
                  }
                  size="sm"
                  className="w-full"
                />
              </Field>
              <Field label="ARN Expiry Date">
                <DateField
                  value={v.arnExpiryAt ?? ""}
                  onChange={(e) => update("arnExpiryAt", e.target.value || null)}
                  size="sm"
                  className="w-full"
                />
              </Field>
            </div>
            {renderUploadField("arn", "Personal ARN Document")}

            {/* EUIN block */}
            <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b pb-0.5">
              EUIN
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="EUIN Number">
                <input
                  value={v.euin}
                  onChange={(e) => update("euin", e.target.value)}
                  className="input-base text-sm w-full font-mono"
                  placeholder="E123456"
                />
              </Field>
              <Field label="EUIN Expiry Date">
                <DateField
                  value={v.euinExpiryAt ?? ""}
                  onChange={(e) => update("euinExpiryAt", e.target.value || null)}
                  size="sm"
                  className="w-full"
                />
              </Field>
            </div>
            {renderUploadField("euin", "EUIN Card")}

            {/* DSC block */}
            <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b pb-0.5">
              DSC (Digital Signature Certificate)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="DSC Submitted?">
                <label className="flex items-center gap-2 h-9 px-3 border rounded-md bg-background">
                  <input
                    type="checkbox"
                    checked={v.dscSubmitted}
                    onChange={(e) => update("dscSubmitted", e.target.checked)}
                    className="size-4"
                  />
                  <span className="text-xs">
                    {v.dscSubmitted ? "Yes, on file" : "Not submitted"}
                  </span>
                </label>
              </Field>
              <Field label="DSC Last Submitted Date">
                <DateField
                  value={v.dscLastSubmittedAt ?? ""}
                  onChange={(e) =>
                    update("dscLastSubmittedAt", e.target.value || null)
                  }
                  size="sm"
                  className="w-full"
                />
              </Field>
              <Field label="DSC Expiry Date">
                <DateField
                  value={v.dscExpiryAt ?? ""}
                  onChange={(e) => update("dscExpiryAt", e.target.value || null)}
                  size="sm"
                  className="w-full"
                />
              </Field>
            </div>
            {renderUploadField("other", "DSC Certificate File")}
          </details>

          {/* Notes */}
          <Field label="Notes (HR / manager comments)">
            <textarea
              rows={3}
              value={v.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="input-base text-sm w-full"
              placeholder="Any HR or manager notes about this employee."
            />
          </Field>

          <div className="flex justify-end pt-3 border-t">
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              <Save className="size-4" /> {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}

      {activeTab === "handover" && (
        <div className="space-y-6">
          {/* Onboarding Checklist Dashboard */}
          {(v.status === "invited" || (v.joiningDate && Math.abs(Date.now() - new Date(v.joiningDate).getTime()) < 30 * 24 * 60 * 60 * 1000)) && (
            <div className="card-surface p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-brand-cyan" /> New Hire Onboarding Checklist
              </h3>
              <p className="text-xs text-muted-foreground">
                Task completion status tracking based on the active onboarding workflow for <strong>{v.name}</strong>.
              </p>

              {tasks.length === 0 ? (
                <div className="text-xs text-muted-foreground italic p-2 border border-dashed rounded-md bg-secondary/5 text-center">
                  No onboarding tasks found for this employee.
                </div>
              ) : (
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border rounded-md p-3 text-xs bg-card hover:bg-secondary/10 transition-all">
                      <div>
                        <div className="font-semibold text-foreground">{t.title}</div>
                        {t.dueAt && <div className="text-[10px] text-muted-foreground mt-0.5">Due: {formatDate(t.dueAt)}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {t.status === "completed" ? (
                          <span className="chip bg-emerald-50 text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 className="size-3" /> Completed
                          </span>
                        ) : t.status === "cancelled" ? (
                          <span className="chip bg-gray-50 text-gray-700 flex items-center gap-1">
                            <XCircle className="size-3" /> Cancelled
                          </span>
                        ) : (
                          <span className="chip bg-amber-50 text-amber-700 font-bold flex items-center gap-1">
                            <Clock className="size-3 animate-pulse" /> Pending
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Offboarding Exit Handover Dashboard */}
          {(v.status === "offboarding" || v.status === "offboarded") && (
            <div className="space-y-4">
              <div className="card-surface p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2 text-rose-800">
                  <XCircle className="size-4 text-rose-600" /> Exit Handover Dashboard
                </h3>
                <p className="text-xs text-muted-foreground">
                  Deprovisioning, client reallocation progress, and task transfers for departing employee <strong>{v.name}</strong>.
                </p>

                {/* IT provisioning and security */}
                <div className="border rounded-md p-3 bg-rose-50/15 border-rose-100 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-rose-900">IT Account & Access Security</div>
                    <div className="text-[10px] text-rose-700/80 mt-0.5">Sessions terminated. Login rejected from the next request onwards.</div>
                  </div>
                  <span className="chip bg-rose-50 text-rose-700 font-bold">Revoked</span>
                </div>

                {/* Client Redistribution */}
                <div className="border rounded-md p-4 bg-secondary/5 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Client Portfolio Handover</span>
                    <span className="font-mono font-bold text-muted-foreground">{stats?.active_clients ?? 0} Clients Remaining</span>
                  </div>
                  {Number(stats?.active_clients ?? 0) > 0 ? (
                    <div className="space-y-2">
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-rose-500" style={{ width: "30%" }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <AlertTriangle className="size-3.5 text-amber-500" /> Reassignment task is open. Redistribute active clients to ensure uninterrupted service.
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700 flex items-center gap-1">
                      ✓ All clients have been successfully reallocated!
                    </div>
                  )}
                </div>
              </div>

              {/* Outstanding Tasks Handover */}
              <div className="card-surface p-5 space-y-3">
                <h4 className="font-semibold text-xs border-b pb-1 text-foreground">Pending Tasks to Reallocate ({tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length})</h4>
                {tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length === 0 ? (
                  <div className="text-xs text-muted-foreground italic text-center py-4 bg-secondary/5 rounded border border-dashed">
                    No outstanding tasks to transfer.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1">
                    {tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').map(t => (
                      <div key={t.id} className="flex items-center justify-between border rounded p-2 text-xs bg-card">
                        <span className="font-medium text-foreground truncate max-w-[70%]">{t.title}</span>
                        <div className="flex items-center gap-2">
                          <span className={`chip text-[9px] font-bold ${
                            t.priority === 'urgent' ? 'bg-rose-50 text-rose-700' : t.priority === 'high' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-700'
                          }`}>{t.priority}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{t.dueAt ? formatDate(t.dueAt) : 'No due date'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming Review Meetings Handover */}
              <div className="card-surface p-5 space-y-3">
                <h4 className="font-semibold text-xs border-b pb-1 text-foreground">Upcoming Client Meetings to Reassign ({meetings.length})</h4>
                {meetings.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic text-center py-4 bg-secondary/5 rounded border border-dashed">
                    No upcoming meetings requiring reassignment.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1">
                    {meetings.map(m => (
                      <div key={m.id} className="flex items-center justify-between border rounded p-2 text-xs bg-card">
                        <div>
                          <div className="font-medium text-foreground">{m.subject || m.meetingType.replace(/_/g, ' ')}</div>
                          {m.meetingDate && <div className="text-[10px] text-muted-foreground mt-0.5">Scheduled: {formatDate(m.meetingDate)}</div>}
                        </div>
                        <span className="chip bg-blue-50 text-blue-700 text-[10px] font-bold capitalize">{m.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "audit" && (
        <div className="card-surface p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <History className="size-4 text-brand-cyan" /> Profile Activity Log
          </h3>
          <p className="text-xs text-muted-foreground">
            Audit history tracking for changes made to roles, settings, and licensing values of this employee profile.
          </p>

          {logs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-8 border border-dashed rounded bg-secondary/5">
              No audit log history entries on file for this user.
            </div>
          ) : (
            <div className="relative border-l border-muted pl-4 space-y-6 py-2 ml-2">
              {logs.map((log) => {
                const atDate = new Date(log.at);
                const isSystem = !log.actor_name;
                return (
                  <div key={log.id} className="relative">
                    {/* Circle marker */}
                    <div className="absolute -left-[21px] top-1 size-2 rounded-full border bg-background border-muted-foreground" />
                    
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold capitalize text-foreground">
                          {log.action.replace("employee.", "Profile ").replace("_", " ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                          {formatDate(atDate)} at {atDate.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        Changed by <strong className="text-foreground">{isSystem ? "System" : log.actor_name}</strong>
                      </div>
                      {/* Detailed difference formatter */}
                      {log.action === "employee.update" && log.before && log.after && (
                        <div className="bg-secondary/25 border rounded p-2 mt-1.5 space-y-1 text-[11px] font-mono scrollbar-thin overflow-x-auto">
                          {Object.keys(log.after).map((key) => {
                            const bVal = log.before[key];
                            const aVal = log.after[key];
                            if (JSON.stringify(bVal) === JSON.stringify(aVal) || key === "updatedAt") return null;
                            return (
                              <div key={key} className="flex flex-wrap items-center gap-1">
                                <span className="text-muted-foreground font-semibold">{key}:</span>
                                <span className="text-rose-700 bg-rose-50 px-1 rounded line-through">{String(bVal ?? "none")}</span>
                                <ArrowRight className="size-3 text-muted-foreground" />
                                <span className="text-emerald-700 bg-emerald-50 px-1 rounded font-bold">{String(aVal ?? "none")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 flex items-center justify-between">
        <span>{label}</span>
        {note && <span className="text-[9px] text-muted-foreground font-normal normal-case">{note}</span>}
      </div>
      {children}
    </label>
  );
}
