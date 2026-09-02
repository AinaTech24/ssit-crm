"use client";

/**
 * Desk management — create desks under each branch and assign every RM to a desk.
 * Drives the Branch → Desk → RM roll-up in the monthly MIS reports.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Check, X, Pencil, Network } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type Branch = { id: string; name: string };
type Desk = { id: string; branchId: string; branchName: string; name: string; code: string | null; memberCount: number };
type Member = { id: string; name: string; branchId: string | null; deskId: string | null; roles: string[] };

// Any team member can sit on a desk — not just RMs. Exclude only investors and
// platform-level accounts (which aren't part of a firm's org chart).
const isAssignable = (m: Member) =>
  !m.roles.includes("investor") &&
  !m.roles.includes("platform_admin") &&
  !m.roles.includes("platform_support");

export function DeskManager() {
  const toast = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/desks", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const d = await res.json();
      setBranches(d.branches ?? []);
      setDesks(d.desks ?? []);
      setMembers(d.members ?? []);
    } catch {
      toast.error("Could not load desks. You may not have access.", "Load failed");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const desksByBranch = useMemo(() => {
    const m = new Map<string, Desk[]>();
    for (const d of desks) {
      const arr = m.get(d.branchId) ?? [];
      arr.push(d);
      m.set(d.branchId, arr);
    }
    return m;
  }, [desks]);

  const assignable = useMemo(() => members.filter(isAssignable), [members]);

  const createDesk = async (branchId: string, name: string, code: string) => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/desks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId, name: name.trim(), code: code.trim() || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Desk added.", "Saved");
      await load();
    } catch {
      toast.error("Could not add the desk (duplicate name?).", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const renameDesk = async (id: string, name: string, code: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/desks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Desk updated.", "Saved");
      await load();
    } catch {
      toast.error("Could not update the desk.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const removeDesk = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/desks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Desk deleted. Its members were unassigned.", "Deleted");
      await load();
    } catch {
      toast.error("Could not delete the desk.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const assign = async (userId: string, deskId: string | null) => {
    // optimistic
    setMembers((ms) => ms.map((m) => (m.id === userId ? { ...m, deskId } : m)));
    try {
      const res = await fetch("/api/desks/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, deskId }),
      });
      if (!res.ok) throw new Error();
      // refresh member counts
      load();
    } catch {
      toast.error("Could not assign desk.", "Failed");
      load();
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>;

  if (branches.length === 0)
    return <div className="text-sm text-muted-foreground">No branches found. Add branches first.</div>;

  return (
    <div className="space-y-6">
      {/* Desks per branch */}
      <div className="space-y-4">
        {branches.map((b) => (
          <BranchDesks
            key={b.id}
            branch={b}
            desks={desksByBranch.get(b.id) ?? []}
            busy={busy}
            onCreate={createDesk}
            onRename={renameDesk}
            onDelete={removeDesk}
          />
        ))}
      </div>

      {/* RM → desk assignment */}
      <div className="rounded-xl border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/40">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Network className="size-4" /> Assign users to desks
          </h2>
        </div>
        <div className="divide-y divide-border">
          {assignable.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No users found.</div>}
          {assignable.map((m) => {
            const branchDesks = m.branchId ? desksByBranch.get(m.branchId) ?? [] : [];
            const branchName = branches.find((b) => b.id === m.branchId)?.name ?? "—";
            return (
              <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{branchName}</div>
                </div>
                {m.branchId ? (
                  <SelectField
                    className="w-44"
                    value={m.deskId ?? ""}
                    onChange={(e) => assign(m.id, e.target.value || null)}
                  >
                    <option value="">— No desk —</option>
                    {branchDesks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <span className="text-xs text-muted-foreground italic w-44 text-right">Assign a branch first</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BranchDesks({
  branch,
  desks,
  busy,
  onCreate,
  onRename,
  onDelete,
}: {
  branch: Branch;
  desks: Desk[];
  busy: boolean;
  onCreate: (branchId: string, name: string, code: string) => void;
  onRename: (id: string, name: string, code: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  return (
    <div className="rounded-xl border border-border">
      <div className="px-4 py-2.5 border-b border-border bg-muted/40 font-semibold text-sm">{branch.name}</div>
      <div className="p-3 space-y-2">
        {desks.length === 0 && <div className="text-xs text-muted-foreground px-1">No desks yet.</div>}
        {desks.map((d) =>
          editing === d.id ? (
            <div key={d.id} className="flex items-center gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Desk name"
                className="flex-1 rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:border-brand-cyan"
              />
              <input
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                placeholder="Code"
                className="w-20 rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:border-brand-cyan"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRename(d.id, editName, editCode);
                  setEditing(null);
                }}
                className="text-emerald-600 hover:opacity-70"
                aria-label="Save"
              >
                <Check className="size-4" />
              </button>
              <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground hover:opacity-70" aria-label="Cancel">
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div key={d.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                <span className="font-medium">{d.name}</span>
                {d.code && <span className="text-xs text-muted-foreground ml-1.5">({d.code})</span>}
                <span className="text-xs text-muted-foreground ml-2">{d.memberCount} member{d.memberCount === 1 ? "" : "s"}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditing(d.id);
                  setEditName(d.name);
                  setEditCode(d.code ?? "");
                }}
                className="text-muted-foreground hover:text-brand-cyan-deep"
                aria-label="Edit desk"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(d.id)}
                className="text-muted-foreground hover:text-rose-600"
                aria-label="Delete desk"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        )}

        <div className="flex items-center gap-2 pt-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New desk name (e.g. DK)"
            className="flex-1 rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:border-brand-cyan"
          />
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Code"
            className="w-20 rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:border-brand-cyan"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={() => {
              onCreate(branch.id, newName, newCode);
              setNewName("");
              setNewCode("");
            }}
            className="btn-secondary whitespace-nowrap"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
