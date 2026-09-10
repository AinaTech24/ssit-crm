"use client";

/**
 * Induction admin — build tracks, lessons and the question bank, and see how
 * the team is progressing.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, GraduationCap, ListChecks, HelpCircle, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Track = any;
type Lesson = any;
type Question = any;

const ROLES = ["rm", "branch_head", "back_office", "ops", "marketing", "compliance", "assistant", "gifting_hr"];

export function InductionManager({ moduleOptions }: { moduleOptions: { href: string; label: string; group: string }[] }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [enrolments, setEnrolments] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const [tab, setTab] = useState<"lessons" | "questions" | "team">("lessons");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/induction/tracks");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not load");
      setTracks(data.tracks ?? []);
      setLessons(data.lessons ?? []);
      setQuestions(data.questions ?? []);
      setEnrolments(data.enrolments ?? []);
      setTeam(data.team ?? []);
      setActiveTrack((cur) => cur ?? data.tracks?.[0]?.id ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load induction data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body: any) {
    setBusy(true);
    try {
      const res = await fetch("/api/induction/tracks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      toast.success("Saved");
      await load();
      return data;
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: string, id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/induction/tracks?kind=${kind}&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Delete failed");
      toast.success("Deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const track = tracks.find((t) => t.id === activeTrack) ?? null;
  const trackLessons = lessons.filter((l) => l.trackId === activeTrack);
  const trackQuestions = questions.filter((q) => q.trackId === activeTrack);
  const trackEnrolments = enrolments.filter((e) => e.track_id === activeTrack);

  if (loading) {
    return (
      <div className="card-surface p-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tracks */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <GraduationCap className="size-4 text-brand-cyan" /> Tracks
          </h2>
          <button
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={() =>
              post({
                action: "track",
                name: "New induction track",
                targetRoles: [],
                passMark: 70,
                cooldownHours: 24,
                issueLetter: true,
                status: "draft",
              })
            }
          >
            <Plus className="size-3.5" /> New track
          </button>
        </div>

        {tracks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No tracks yet. Create one, add lessons, then set it to Active so new joiners are enrolled.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTrack(t.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                  t.id === activeTrack
                    ? "bg-brand-cyan text-white border-brand-cyan"
                    : "border-border hover:bg-accent"
                }`}
              >
                {t.name}
                <span className="ml-1.5 opacity-70">({t.status})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {track && (
        <>
          {/* Track settings */}
          <div className="card-surface p-4 space-y-3">
            <h3 className="text-sm font-semibold">Track settings</h3>
            <form
              className="grid sm:grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget as HTMLFormElement);
                void post({
                  action: "track",
                  id: track.id,
                  name: String(f.get("name") ?? track.name),
                  description: String(f.get("description") ?? "") || null,
                  targetRoles: ROLES.filter((r) => f.get(`role_${r}`) === "on"),
                  passMark: Number(f.get("passMark") ?? 70),
                  cooldownHours: Number(f.get("cooldownHours") ?? 24),
                  maxAttempts: f.get("maxAttempts") ? Number(f.get("maxAttempts")) : null,
                  issueLetter: f.get("issueLetter") === "on",
                  status: String(f.get("status") ?? "draft") as any,
                });
              }}
            >
              <label className="text-xs">
                Name
                <input name="name" defaultValue={track.name} className="input mt-1 w-full" />
              </label>
              <label className="text-xs">
                Status
                <select name="status" defaultValue={track.status} className="input mt-1 w-full">
                  <option value="draft">Draft</option>
                  <option value="active">Active (auto-enrols new joiners)</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="text-xs sm:col-span-2">
                Description
                <input name="description" defaultValue={track.description ?? ""} className="input mt-1 w-full" />
              </label>
              <label className="text-xs">
                Pass mark (%)
                <input name="passMark" type="number" min={1} max={100} defaultValue={track.passMark} className="input mt-1 w-full" />
              </label>
              <label className="text-xs">
                Retry cooldown (hours)
                <input name="cooldownHours" type="number" min={0} defaultValue={track.cooldownHours} className="input mt-1 w-full" />
              </label>
              <label className="text-xs">
                Max attempts (blank = unlimited)
                <input name="maxAttempts" type="number" min={1} defaultValue={track.maxAttempts ?? ""} className="input mt-1 w-full" />
              </label>
              <div className="text-xs">
                <div className="mb-1">Auto-enrol roles</div>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <label key={r} className="inline-flex items-center gap-1 text-[11px] border rounded px-1.5 py-0.5">
                      <input
                        type="checkbox"
                        name={`role_${r}`}
                        defaultChecked={(track.targetRoles ?? []).includes(r)}
                        className="size-3"
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              <label className="text-xs inline-flex items-center gap-2">
                <input type="checkbox" name="issueLetter" defaultChecked={track.issueLetter} className="size-3.5" />
                Issue a confirmation letter on pass
              </label>
              <div className="sm:col-span-2 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => remove("track", track.id)}
                  className="text-xs text-rose-600 hover:underline inline-flex items-center gap-1"
                >
                  <Trash2 className="size-3.5" /> Delete track
                </button>
                <button className="btn-primary text-xs" disabled={busy}>Save track</button>
              </div>
            </form>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {([
              ["lessons", ListChecks, `Lessons (${trackLessons.length})`],
              ["questions", HelpCircle, `Questions (${trackQuestions.length})`],
              ["team", Users, `Team (${trackEnrolments.length})`],
            ] as const).map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => setTab(key as any)}
                className={`px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px ${
                  tab === key ? "border-brand-cyan text-brand-cyan-deep" : "border-transparent text-muted-foreground"
                }`}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === "lessons" && (
            <div className="card-surface p-4 space-y-3">
              {trackLessons.map((l) => (
                <div key={l.id} className="border rounded-lg p-3 text-xs flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">
                      {l.position}. {l.title}
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {l.kind}
                      {l.durationSeconds ? ` · ${Math.round(l.durationSeconds / 60)} min` : ""}
                      {(l.unlocksModules ?? []).length ? ` · unlocks ${l.unlocksModules.length} module(s)` : ""}
                    </div>
                  </div>
                  <button onClick={() => remove("lesson", l.id)} className="text-rose-600 shrink-0">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}

              <form
                className="border-t pt-3 grid sm:grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget as HTMLFormElement;
                  const f = new FormData(form);
                  const mods = moduleOptions
                    .map((m) => m.href)
                    .filter((h) => f.get(`mod_${h}`) === "on");
                  void post({
                    action: "lesson",
                    trackId: track.id,
                    position: Number(f.get("position") ?? trackLessons.length + 1),
                    title: String(f.get("title") ?? ""),
                    summary: String(f.get("summary") ?? "") || null,
                    kind: String(f.get("kind") ?? "video"),
                    videoUrl: String(f.get("videoUrl") ?? "") || null,
                    durationSeconds: f.get("duration") ? Number(f.get("duration")) * 60 : null,
                    bodyMd: String(f.get("bodyMd") ?? "") || null,
                    unlocksModules: mods,
                    required: true,
                  }).then(() => form.reset());
                }}
              >
                <label className="text-xs">
                  Position
                  <input name="position" type="number" min={1} defaultValue={trackLessons.length + 1} className="input mt-1 w-full" />
                </label>
                <label className="text-xs">
                  Kind
                  <select name="kind" defaultValue="video" className="input mt-1 w-full">
                    <option value="video">Video</option>
                    <option value="document">Document</option>
                    <option value="link">Link</option>
                    <option value="checklist">Checklist</option>
                  </select>
                </label>
                <label className="text-xs sm:col-span-2">
                  Title
                  <input name="title" required className="input mt-1 w-full" placeholder="e.g. How we handle a new lead" />
                </label>
                <label className="text-xs sm:col-span-2">
                  Summary
                  <input name="summary" className="input mt-1 w-full" />
                </label>
                <label className="text-xs">
                  Video URL (YouTube / Vimeo embed)
                  <input name="videoUrl" type="url" className="input mt-1 w-full" placeholder="https://www.youtube.com/embed/…" />
                </label>
                <label className="text-xs">
                  Duration (minutes)
                  <input name="duration" type="number" min={0} className="input mt-1 w-full" />
                </label>
                <label className="text-xs sm:col-span-2">
                  Notes shown under the video
                  <textarea name="bodyMd" rows={3} className="input mt-1 w-full" />
                </label>

                <div className="text-xs sm:col-span-2">
                  <div className="mb-1 font-medium">Modules unlocked by this lesson</div>
                  <div className="max-h-40 overflow-y-auto border rounded p-2 grid sm:grid-cols-2 gap-1 scrollbar-thin">
                    {moduleOptions.map((m) => (
                      <label key={m.href} className="inline-flex items-center gap-1.5 text-[11px]">
                        <input type="checkbox" name={`mod_${m.href}`} className="size-3" />
                        <span className="truncate">
                          {m.label} <span className="text-muted-foreground">· {m.group}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2 flex justify-end">
                  <button className="btn-primary text-xs" disabled={busy}>
                    <Plus className="size-3.5" /> Add lesson
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === "questions" && (
            <div className="card-surface p-4 space-y-3">
              {trackQuestions.map((q) => (
                <div key={q.id} className="border rounded-lg p-3 text-xs flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{q.prompt}</div>
                    <div className="text-muted-foreground mt-0.5">
                      {(q.options ?? []).map((o: any) => o.key).join(" / ")} · correct:{" "}
                      {(q.correctKeys ?? []).join(", ")}
                    </div>
                  </div>
                  <button onClick={() => remove("question", q.id)} className="text-rose-600 shrink-0">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}

              <form
                className="border-t pt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget as HTMLFormElement;
                  const f = new FormData(form);
                  const options = ["A", "B", "C", "D"]
                    .map((k) => ({ key: k, text: String(f.get(`opt_${k}`) ?? "").trim() }))
                    .filter((o) => o.text);
                  const correct = ["A", "B", "C", "D"].filter((k) => f.get(`ok_${k}`) === "on");
                  if (options.length < 2) return toast.error("Give at least two options");
                  if (correct.length === 0) return toast.error("Tick at least one correct answer");
                  void post({
                    action: "question",
                    trackId: track.id,
                    lessonId: String(f.get("lessonId") ?? "") || null,
                    prompt: String(f.get("prompt") ?? ""),
                    options,
                    correctKeys: correct,
                    points: 1,
                    active: true,
                  }).then(() => form.reset());
                }}
              >
                <label className="text-xs block">
                  Question
                  <input name="prompt" required className="input mt-1 w-full" />
                </label>
                <label className="text-xs block">
                  Relates to lesson (for weak-area feedback)
                  <select name="lessonId" defaultValue="" className="input mt-1 w-full">
                    <option value="">— none —</option>
                    {trackLessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.position}. {l.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid sm:grid-cols-2 gap-2">
                  {["A", "B", "C", "D"].map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-xs w-4">{k}</span>
                      <input name={`opt_${k}`} className="input flex-1" placeholder={`Option ${k}`} />
                      <label className="text-[11px] inline-flex items-center gap-1">
                        <input type="checkbox" name={`ok_${k}`} className="size-3" /> correct
                      </label>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary text-xs" disabled={busy}>
                    <Plus className="size-3.5" /> Add question
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === "team" && (
            <div className="card-surface p-4 space-y-3">
              {trackEnrolments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Nobody enrolled yet. Set the track Active to auto-enrol new joiners, or add someone below.
                </p>
              ) : (
                <ul className="divide-y text-xs">
                  {trackEnrolments.map((e) => (
                    <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="font-medium">{e.user_name ?? "—"}</span>
                      <span className="text-muted-foreground">
                        {e.done_count} / {trackLessons.length} steps · {e.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="border-t pt-3 flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget as HTMLFormElement);
                  const userId = String(f.get("userId") ?? "");
                  if (!userId) return;
                  void post({ action: "enrol", trackId: track.id, userId });
                }}
              >
                <label className="text-xs flex-1">
                  Enrol a team member
                  <select name="userId" defaultValue="" className="input mt-1 w-full">
                    <option value="">— pick —</option>
                    {team.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-secondary text-xs" disabled={busy}>Enrol</button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
