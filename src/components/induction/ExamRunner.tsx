"use client";

/**
 * Exam runner. The question set comes from the server WITHOUT answer keys, and
 * grading happens server-side — nothing here can be tampered with to pass.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Q = {
  id: string;
  prompt: string;
  options: { key: string; text: string }[];
  points: number;
};

type Result = {
  passed: boolean;
  scorePct: number;
  passMark?: number;
  letterUrl?: string | null;
};

export function ExamRunner() {
  const router = useRouter();
  const toast = useToast();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [passMark, setPassMark] = useState<number>(70);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/induction/exam?action=start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Could not start (${res.status})`);
      setAttemptId(data.attemptId);
      setQuestions(data.questions ?? []);
      setPassMark(data.passMark ?? 70);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start the exam");
    } finally {
      setBusy(false);
    }
  }

  function toggle(qId: string, key: string) {
    setAnswers((prev) => {
      const cur = new Set(prev[qId] ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, [qId]: [...cur] };
    });
  }

  async function submit() {
    const unanswered = questions.filter((q) => !(answers[q.id]?.length));
    if (unanswered.length > 0) {
      toast.error(`${unanswered.length} question${unanswered.length === 1 ? "" : "s"} still unanswered`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/induction/exam?action=submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId, answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Could not submit (${res.status})`);
      setResult(data);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not submit the exam");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card-surface p-8 text-center">
        <div
          className={`mx-auto size-14 rounded-full grid place-items-center mb-3 ${
            result.passed ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
          }`}
        >
          {result.passed ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
        </div>
        <div className="text-lg font-bold">
          {result.passed ? "Passed" : "Not passed this time"}
        </div>
        <div className="text-3xl font-bold tabular-nums mt-2">{result.scorePct}%</div>
        <p className="text-xs text-muted-foreground mt-1">
          Pass mark {result.passMark ?? passMark}%
        </p>

        <div className="mt-5 flex items-center justify-center gap-2">
          {result.passed && result.letterUrl && (
            <a href={result.letterUrl} target="_blank" rel="noreferrer" className="btn-primary">
              Open confirmation letter
            </a>
          )}
          <Link href="/dashboard/induction" className="btn-secondary">
            Back to induction
          </Link>
        </div>
        {!result.passed && (
          <p className="text-xs text-muted-foreground mt-4 max-w-sm mx-auto">
            Revisit the steps and try again once the retry window opens.
          </p>
        )}
      </div>
    );
  }

  if (!attemptId) {
    return (
      <div className="card-surface p-8 text-center">
        <div className="text-sm font-semibold">Ready to start?</div>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          You'll answer every question in one sitting. Reloading resumes the same paper.
        </p>
        <button onClick={start} disabled={busy} className="btn-primary mt-4">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Start exam
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <div key={q.id} className="card-surface p-5">
          <div className="text-sm font-medium">
            <span className="text-muted-foreground mr-2">{i + 1}.</span>
            {q.prompt}
          </div>
          <div className="mt-3 space-y-2">
            {q.options.map((o) => {
              const checked = (answers[q.id] ?? []).includes(o.key);
              return (
                <label
                  key={o.key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition ${
                    checked ? "border-brand-cyan bg-brand-cyan-light/30" : "border-border hover:bg-accent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(q.id, o.key)}
                    className="size-3.5 rounded border-slate-300"
                  />
                  <span className="text-sm">{o.text}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button onClick={submit} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit exam
        </button>
      </div>
    </div>
  );
}
