"use client";

/**
 * Lesson player. For self-hosted video we can watch `timeupdate` and enforce
 * the watch rule; for an embedded external player (YouTube/Vimeo iframe) we
 * cannot see playback at all, so the completion rule falls back to the explicit
 * button — which the server also allows when `durationSeconds` is unset.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Unlock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Props = {
  lesson: {
    id: string;
    title: string;
    kind: string;
    videoUrl: string | null;
    videoSrc: string | null;
    bodyMd: string | null;
    durationSeconds: number | null;
  };
  initial: { watchedSeconds: number; completed: boolean };
};

const HEARTBEAT_MS = 15_000;

export function LessonPlayer({ lesson, initial }: Props) {
  const router = useRouter();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watched = useRef(initial.watchedSeconds);
  const maxPos = useRef(0);
  const [completed, setCompleted] = useState(initial.completed);
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (markComplete: boolean) => {
      const res = await fetch("/api/induction/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          watchedSeconds: Math.round(watched.current),
          positionSeconds: Math.round(maxPos.current),
          markComplete,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      return data;
    },
    [lesson.id]
  );

  // Periodic heartbeat while the tab is open and the video is playing.
  useEffect(() => {
    if (completed) return;
    const t = setInterval(() => {
      void send(false).catch(() => {
        /* a dropped beat is not worth interrupting the user */
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [completed, send]);

  // Accumulate watch time from the native player.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let last = 0;
    const onTime = () => {
      const now = el.currentTime;
      // Only count forward movement, so scrubbing back doesn't inflate the total.
      if (now > last && now - last < 2) watched.current += now - last;
      last = now;
      if (now > maxPos.current) maxPos.current = now;
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, []);

  async function markComplete() {
    setBusy(true);
    try {
      const data = await send(true);
      setCompleted(true);
      const unlocked: string[] = data?.unlocked ?? [];
      toast.success(
        unlocked.length
          ? `Step complete — ${unlocked.length} module${unlocked.length === 1 ? "" : "s"} unlocked`
          : "Step complete"
      );
      router.refresh();
      router.push("/dashboard/induction");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save progress");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {lesson.videoSrc ? (
        <video
          ref={videoRef}
          src={lesson.videoSrc}
          controls
          controlsList="nodownload"
          className="w-full rounded-xl border bg-black aspect-video"
        />
      ) : lesson.videoUrl ? (
        <div className="aspect-video w-full rounded-xl border overflow-hidden bg-black">
          <iframe
            src={lesson.videoUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            title={lesson.title}
          />
        </div>
      ) : null}

      {lesson.bodyMd && (
        <div className="card-surface p-5 text-sm whitespace-pre-wrap leading-relaxed">
          {lesson.bodyMd}
        </div>
      )}

      <div className="card-surface p-4 flex items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Unlock className="size-3.5" />
          Finishing this step unlocks the modules it covers.
        </div>
        {completed ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="size-4" /> Completed
          </span>
        ) : (
          <button onClick={markComplete} disabled={busy} className="btn-primary shrink-0">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Mark complete
          </button>
        )}
      </div>
    </div>
  );
}
