/**
 * Trash bin — soft-deleted items, grouped into a collapsible section per module
 * (Clients, Tasks, …), recoverable until permanently removed. Clients keep their
 * retention window (auto-purged by the daily worker); tasks are kept until
 * manually purged. Each module section is shown only to roles allowed to see it.
 */

import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Trash2, Info, Users, ListChecks, UserCog, UserPlus } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/rbac";
import { investors, leads, tasks, users } from "@/db/schema";
import { DEFAULT_SOFT_DELETE_RETENTION_DAYS } from "@/lib/platform/retention";
import { formatINR, formatDate } from "@/lib/utils";
import { TrashTable, type TrashColumn } from "@/components/trash/TrashTable";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function TrashPage() {
  const session = await requireSession();
  const canInvestors = can(session.roles, "investor.delete", session.permissions);
  const canTasksAll = can(session.roles, "task.edit.all", session.permissions);
  const canTasksOwn = can(session.roles, "task.edit.assigned", session.permissions);
  const canTasks = canTasksAll || canTasksOwn;
  const canEmployees = can(session.roles, "settings.users", session.permissions);
  // Deleting a lead rides on the lead edit capability, so seeing them in Trash
  // does too — the same people who can delete one can get it back.
  const canLeads =
    can(session.roles, "lead.edit.all", session.permissions) ||
    can(session.roles, "lead.edit.assigned", session.permissions);
  if (!canInvestors && !canTasks && !canEmployees && !canLeads) redirect("/dashboard");

  const retention = DEFAULT_SOFT_DELETE_RETENTION_DAYS;

  const { invRows, leadRows, taskRows, empRows, deleterNameById } = await withTenant(session.tenantId, async (tx) => {
    const leadRows = canLeads
      ? await tx
          .select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            phone: leads.phone,
            source: leads.source,
            deletedAt: leads.deletedAt,
            deletedBy: leads.deletedBy,
          })
          .from(leads)
          .where(and(eq(leads.tenantId, session.tenantId), isNotNull(leads.deletedAt)))
          .orderBy(desc(leads.deletedAt))
          .limit(500)
      : [];

    const invRows = canInvestors
      ? await tx
          .select({
            id: investors.id,
            name: investors.name,
            pan: investors.pan,
            email: investors.email,
            phone: investors.phone,
            aum: investors.aum,
            deletedAt: investors.deletedAt,
            deletedBy: investors.deletedBy,
          })
          .from(investors)
          .where(and(eq(investors.tenantId, session.tenantId), isNotNull(investors.deletedAt)))
          .orderBy(desc(investors.deletedAt))
          .limit(500)
      : [];

    // task.edit.assigned users see only their own trashed tasks; task.edit.all sees all.
    const taskScope = canTasksAll
      ? undefined
      : or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId));
    const taskRows = canTasks
      ? await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            type: tasks.type,
            status: tasks.status,
            priority: tasks.priority,
            deletedAt: tasks.deletedAt,
            deletedBy: tasks.deletedBy,
          })
          .from(tasks)
          .where(and(eq(tasks.tenantId, session.tenantId), isNotNull(tasks.deletedAt), taskScope))
          .orderBy(desc(tasks.deletedAt))
          .limit(500)
      : [];

    const empRows = canEmployees
      ? await tx
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            department: users.department,
            roles: users.roles,
            deletedAt: users.deletedAt,
            deletedBy: users.deletedBy,
          })
          .from(users)
          .where(and(eq(users.tenantId, session.tenantId), isNotNull(users.deletedAt)))
          .orderBy(desc(users.deletedAt))
          .limit(500)
      : [];

    // Resolve the "deleted by" user ids to display names in one lookup.
    const deleterIds = [
      ...new Set(
        [...invRows, ...leadRows, ...taskRows, ...empRows]
          .map((r: any) => r.deletedBy as string | null)
          .filter((v): v is string => !!v)
      ),
    ];
    const deleters = deleterIds.length
      ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, deleterIds))
      : [];
    const deleterNameById = new Map(deleters.map((u) => [u.id, u.name]));

    return { invRows, leadRows, taskRows, empRows, deleterNameById };
  });

  const deleterName = (id: string | null | undefined) => (id && deleterNameById.get(id)) || "—";

  const isEmpty = invRows.length === 0 && taskRows.length === 0 && empRows.length === 0;

  const leadTrashRows = leadRows.map((r) => ({
    id: r.id,
    label: r.name ?? "—",
    name: r.name ?? "—",
    contact: [r.email, r.phone].filter(Boolean).join(" · ") || "—",
    source: r.source ?? "—",
    deletedAt: r.deletedAt ? formatDate(r.deletedAt) : "—",
    deletedBy: deleterName(r.deletedBy),
  }));
  const leadCols: TrashColumn[] = [
    { header: "Lead", field: "name", kind: "primary", subField: "contact", truncate: true },
    { header: "Source", field: "source" },
    { header: "Deleted", field: "deletedAt" },
    { header: "By", field: "deletedBy" },
  ];

  // Precompute serializable rows + column specs for the reusable TrashTable
  // (Server Component can't pass render functions across the RSC boundary).
  const invTrashRows = invRows.map((r) => {
    const deletedAt = r.deletedAt ? new Date(r.deletedAt as any) : null;
    const daysLeft = deletedAt
      ? Math.max(0, retention - Math.floor((Date.now() - deletedAt.getTime()) / DAY_MS))
      : retention;
    return {
      id: r.id,
      label: r.name,
      name: r.name,
      contact: r.email || r.phone || "—",
      pan: r.pan || "—",
      aum: r.aum ? formatINR(Math.round(Number(r.aum))) : "—",
      deletedByName: deleterName(r.deletedBy),
      deletedText: deletedAt ? formatDate(deletedAt) : "—",
      expiryText: `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      expiryTone: daysLeft <= 3 ? "rose" : "amber",
    };
  });
  const invCols: TrashColumn[] = [
    { header: "Client", field: "name", kind: "primary", subField: "contact" },
    { header: "PAN", field: "pan", mono: true },
    { header: "AUM", field: "aum", align: "right" },
    { header: "Deleted by", field: "deletedByName" },
    { header: "Deleted at", field: "deletedText" },
    { header: "Auto-deletes", field: "expiryText", kind: "chip", toneField: "expiryTone" },
  ];

  const taskTrashRows = taskRows.map((r) => ({
    id: r.id,
    label: r.title,
    title: r.title,
    type: String(r.type).replace(/_/g, " "),
    status: String(r.status).replace(/_/g, " "),
    deletedByName: deleterName(r.deletedBy),
    deletedText: r.deletedAt ? formatDate(new Date(r.deletedAt as any)) : "—",
  }));
  const taskCols: TrashColumn[] = [
    { header: "Task", field: "title", kind: "primary", truncate: true },
    { header: "Type", field: "type" },
    { header: "Status", field: "status" },
    { header: "Deleted by", field: "deletedByName" },
    { header: "Deleted at", field: "deletedText" },
  ];

  const empTrashRows = empRows.map((r) => ({
    id: r.id,
    label: r.name,
    name: r.name,
    email: r.email || "",
    department: r.department ? String(r.department).replace(/_/g, " ") : "",
    roles: (r.roles ?? []).map((role: string) => ROLE_LABELS[role] ?? role).join(", "),
    deletedByName: deleterName(r.deletedBy),
    deletedText: r.deletedAt ? formatDate(new Date(r.deletedAt as any)) : "",
  }));
  const empCols: TrashColumn[] = [
    { header: "Employee", field: "name", kind: "primary", subField: "email" },
    { header: "Department", field: "department" },
    { header: "Roles", field: "roles" },
    { header: "Deleted by", field: "deletedByName" },
    { header: "Deleted at", field: "deletedText" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Trash2 className="size-5 text-muted-foreground" /> Trash
        </h1>
        <p className="page-subtitle">
          Deleted items are kept here, grouped by module. Restore one to bring it back exactly as it was,
          or delete it permanently. Clients are auto-removed {retention} days after deletion.
        </p>
      </div>

      {isEmpty ? (
        <div className="card-surface flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Trash2 className="size-10 text-muted-foreground/30" />
          <div className="text-sm font-medium">Trash is empty</div>
          <div className="text-xs text-muted-foreground">Deleted clients, tasks, and employees will appear here.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Clients ─────────────────────────────────────────────────── */}
          {canInvestors && invTrashRows.length > 0 && (
            <TrashTable
              title="Clients"
              count={invTrashRows.length}
              icon={<Users className="size-4 text-muted-foreground" />}
              rows={invTrashRows}
              columns={invCols}
              restoreTemplate="/api/investors/{id}/restore"
              purgeTemplate="/api/investors/{id}?purge=1"
              itemLabel="client"
            />
          )}

          {/* ── Leads ───────────────────────────────────────────────────── */}
          {canLeads && leadTrashRows.length > 0 && (
            <TrashTable
              title="Leads"
              count={leadTrashRows.length}
              icon={<UserPlus className="size-4 text-muted-foreground" />}
              rows={leadTrashRows}
              columns={leadCols}
              restoreTemplate="/api/leads/{id}/restore"
              purgeTemplate="/api/leads/{id}?purge=1"
              itemLabel="lead"
              purgeButtonLabel="Delete permanently"
              purgeMessage="This removes the lead for good, along with its proposals, financial plans and message history. It cannot be undone."
            />
          )}

          {/* ── Tasks ───────────────────────────────────────────────────── */}
          {canTasks && taskTrashRows.length > 0 && (
            <TrashTable
              title="Tasks"
              count={taskTrashRows.length}
              icon={<ListChecks className="size-4 text-muted-foreground" />}
              rows={taskTrashRows}
              columns={taskCols}
              restoreTemplate="/api/tasks/{id}/restore"
              purgeTemplate="/api/tasks/{id}?permanent=1"
              itemLabel="task"
            />
          )}

          {/* ── Employees ───────────────────────────────────────────────── */}
          {canEmployees && empTrashRows.length > 0 && (
            <TrashTable
              title="Employees"
              count={empTrashRows.length}
              icon={<UserCog className="size-4 text-muted-foreground" />}
              rows={empTrashRows}
              columns={empCols}
              restoreTemplate="/api/employees/{id}/restore"
              purgeTemplate="/api/employees/{id}?purge=1"
              itemLabel="employee"
              purgeButtonLabel="Remove"
              purgeTitle="Remove permanently?"
              purgeMessage="This offboards the employee for good — their clients are redistributed and they lose all access. Their record is kept for audit/history but leaves Trash. This can't be undone here."
              purgeCta="Remove permanently"
            />
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        Permanent deletion is irreversible. Until then, nothing is lost — restoring brings the item back
        exactly as it was.
      </p>
    </div>
  );
}
