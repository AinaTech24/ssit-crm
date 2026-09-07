"use client";

/**
 * Client book tags.
 *
 * Almost every client is "Motilal Oswal" or "Mutual Fund", so those two are
 * one-click chips rather than something to type — but the field stays free-form
 * underneath, because the day a third book appears nobody should have to wait
 * for a deploy.
 */

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { CLIENT_BOOK_TAGS, normaliseTags } from "@/lib/investors/client-tags";

export function ClientTagsField({
  value,
  onChange,
  label = "Client tags",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState("");
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase());

  function toggle(tag: string) {
    onChange(has(tag) ? value.filter((v) => v.toLowerCase() !== tag.toLowerCase()) : normaliseTags([...value, tag]));
  }

  function addDraft() {
    const t = draft.trim();
    if (!t) return;
    onChange(normaliseTags([...value, t]));
    setDraft("");
  }

  // Anything typed by hand rather than picked from the chips.
  const custom = value.filter((v) => !CLIENT_BOOK_TAGS.some((b) => b.toLowerCase() === v.toLowerCase()));

  return (
    <div>
      <div className="text-xs font-medium mb-1.5">{label}</div>

      <div className="flex flex-wrap gap-1.5">
        {CLIENT_BOOK_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            aria-pressed={has(t)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              has(t)
                ? "border-brand-cyan bg-brand-cyan-light text-brand-cyan-deep"
                : "border-border bg-background hover:bg-accent text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {custom.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {custom.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs">
              {t}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== t))}
                aria-label={`Remove ${t}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // The field usually sits inside a form; Enter adds a tag, it does
              // not submit the client record.
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Another tag…"
          maxLength={60}
          className="input-base text-xs flex-1"
        />
        <button
          type="button"
          onClick={addDraft}
          disabled={!draft.trim()}
          className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-40"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>
    </div>
  );
}
