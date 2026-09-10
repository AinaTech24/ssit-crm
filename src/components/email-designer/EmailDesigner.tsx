"use client";

/**
 * Zoho-style Email Template Designer.
 *
 * Two authoring modes:
 *   - "Designer"  → block-based UI: drag from a palette, configure inline, see live preview
 *   - "HTML"      → raw HTML editor with merge-field hinting
 *
 * Both modes share: subject, preheader, theme (brand color, logo, fonts), and
 * the auto-generated SEBI footer.
 *
 * Designed as a controlled component — parent owns the EmailDesignerBody.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  Type as TypeIcon,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Images,
  MousePointerClick,
  Minus,
  ArrowUpDown,
  Quote,
  Share2,
  Table as TableIcon,
  Code,
  Trash2,
  ChevronUp,
  GripVertical,
  ChevronDown,
  PaintBucket,
  Eye,
  Palette,
  Variable,
  Sparkles,
  X,
  Send,
  Loader2,
  Check,
  UploadCloud,
} from "lucide-react";
import type { EmailDesignerBody, EmailBlock, EmailTheme } from "@/lib/email-designer/types";
import { mergeFieldsByCategory, MERGE_FIELDS, type MergeField } from "@/lib/email-designer/merge-fields";

type Mode = "designer" | "html";
type SectionId = "properties" | "blocks" | "theme" | "fields";

// Sample values keyed by token — the SAME examples the preview API uses to
// render the body — so the subject/preheader preview resolves to realistic text
// (e.g. "Rajesh") instead of showing raw {{investor.first_name}} tokens.
const EXAMPLE_BY_TOKEN: Record<string, string> = Object.fromEntries(
  MERGE_FIELDS.map((f) => [f.token, String(f.example ?? "")])
);
function resolvePreviewTokens(text: string): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, tok) => (tok in EXAMPLE_BY_TOKEN ? EXAMPLE_BY_TOKEN[tok] : m));
}

/** Friendly, content-aware label for a block in the Properties list. */
function blockTypeLabel(b: any): string {
  switch (b.type) {
    case "logo": return "Logo";
    case "hero": return "Hero";
    case "heading": return `Heading (${String(b.level ?? "h2").toUpperCase()})`;
    case "text": return "Paragraph";
    case "button": return "Button";
    case "image": return "Image";
    case "image_row": return "Image row";
    case "data_table": return "Data table";
    case "divider": return "Divider";
    case "spacer": return "Spacer";
    case "quote": return "Quote";
    case "social": return "Social links";
    case "html": return "Custom HTML";
    default: return String(b.type).replace(/_/g, " ");
  }
}

export function EmailDesigner({
  value,
  onChange,
  tenant,
}: {
  value: EmailDesignerBody;
  onChange: (next: EmailDesignerBody) => void;
  tenant?: { displayName?: string | null; arn?: string | null; logoUrl?: string | null; brandColor?: string | null };
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Expand/shrink accordion sections in the left rail — several may be open at
  // once; the rail scrolls (hidden scrollbar) when content overflows.
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    properties: true,
    blocks: true,
    theme: false,
    fields: false,
  });
  const toggleSection = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  // Remember the last designer input the user touched so "Insert field" / the
  // Fields tab drop the token into the right place even after the click blurs it.
  const lastFocused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const mode = (value.mode ?? "designer") as Mode;
  const theme: EmailTheme = useMemo(
    () =>
      (value.theme ?? {
        brandColor: tenant?.brandColor ?? "#d22e32",
        accentColor: "#841f21",
        pageBackground: "#f5f7fb",
        cardBackground: "#ffffff",
        textColor: "#111827",
        mutedColor: "#6b7280",
        fontFamily: "sans",
        baseFontSize: 15,
        containerWidth: 600,
        cornerRadius: 12,
        logoHeight: 40,
        logoAlign: "center",
        logoUrl: tenant?.logoUrl ?? undefined,
      }) as EmailTheme,
    [value.theme, tenant]
  );

  // Give the designer maximum width: collapse the app sidebar while this module
  // is open, then restore the user's saved pin state on leave.
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("ssit:sidebar-collapse")); } catch { /* SSR/no-window */ }
    return () => {
      try { window.dispatchEvent(new CustomEvent("ssit:sidebar-restore")); } catch { /* noop */ }
    };
  }, []);

  // Initialise blocks with sensible defaults
  useEffect(() => {
    if (mode === "designer" && (!value.blocks || value.blocks.length === 0)) {
      onChange({
        ...value,
        blocks: [
          mkBlock("logo", {}),
          mkBlock("hero", { title: "Welcome, {{investor.name}}", subtitle: "Thank you for choosing {{tenant.displayName}}." }),
          mkBlock("text", { html: "We're delighted to be your wealth-management partner. This is the start of a long, fruitful relationship." }),
          mkBlock("button", { label: "View dashboard", url: "{{system.dashboard_url}}" }),
        ],
        theme,
      });
    }
  }, []);

  // Live preview refresh — server renders.
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Always send the latest body, but only RE-RENDER the preview when the body
  // content actually changes. Subject/preheader show in the inbox header (not
  // the email body), so keying the refresh on the body alone stops the preview
  // iframe from reloading — and flickering — on every subject keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;
  const previewKey = JSON.stringify({ ...value, subject: undefined, preheader: undefined });
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void fetch("/api/email-designer/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: valueRef.current }),
      })
        .then(async (r) => {
          if (!r.ok) {
            // Surface the server's actual reason (e.g. a permissions message)
            // rather than a bare status code — "returned 500" told the user
            // nothing and made this class of failure undiagnosable from the UI.
            const detail = await r
              .json()
              .then((d: any) => (typeof d?.error === "string" ? d.error : ""))
              .catch(() => "");
            setPreviewError(detail ? `${detail} (HTTP ${r.status})` : `Preview API returned ${r.status}`);
            return { html: "" };
          }
          setPreviewError(null);
          return r.json();
        })
        .then((d) => setPreviewHtml(d.html ?? ""))
        .catch(() => setPreviewHtml(""));
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  function update<K extends keyof EmailDesignerBody>(patch: Partial<EmailDesignerBody>) {
    onChange({ ...value, ...patch });
  }
  function updateTheme(patch: Partial<EmailTheme>) {
    onChange({ ...value, theme: { ...theme, ...patch } });
  }
  // Select a block and make sure its editor (the Properties section) is visible.
  function selectBlock(id: string) {
    setSelectedId(id);
    setOpen((o) => ({ ...o, properties: true }));
  }
  // Properties lists every block; clicking a block's header expands its editor
  // (and highlights it in the preview) — clicking again collapses it.
  function toggleSelect(id: string) {
    setSelectedId((cur) => (cur === id ? null : id));
    setOpen((o) => ({ ...o, properties: true }));
  }
  function addBlock(type: any) {
    const b = mkBlock(type, {});
    update({ blocks: [...(value.blocks ?? []), b] });
    selectBlock(b.id);
  }
  function updateBlock(id: string, patch: any) {
    update({
      blocks: (value.blocks ?? []).map((b: any) => (b.id === id ? { ...b, ...patch } : b)),
    });
  }
  function removeBlock(id: string) {
    update({ blocks: (value.blocks ?? []).filter((b: any) => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }
  function moveBlock(id: string, dir: -1 | 1) {
    const arr = [...(value.blocks ?? [])];
    const idx = arr.findIndex((b: any) => b.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    update({ blocks: arr });
  }
  /** Drag-drop reorder: move `fromId` to occupy `toId`'s position. */
  function moveBlockTo(fromId: string, toId: string) {
    if (fromId === toId) return;
    const arr = [...(value.blocks ?? [])];
    const from = arr.findIndex((b: any) => b.id === fromId);
    const to = arr.findIndex((b: any) => b.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    update({ blocks: arr });
  }
  async function sendTest() {
    setTestState("sending");
    setTestMsg(null);
    try {
      const res = await fetch("/api/email-designer/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setTestState("error"); setTestMsg(j.error ?? "Send failed"); return; }
      setTestState("sent"); setTestMsg(`Sent to ${j.sentTo}`);
      setTimeout(() => setTestState("idle"), 3500);
    } catch (e: any) {
      setTestState("error"); setTestMsg(e?.message ?? "Network error");
    }
  }

  function insertMergeField(field: MergeField) {
    // Insert into the last-touched designer input (preferred — survives the
    // click that blurs it); fall back to whatever's focused, else the subject.
    const token = `{{${field.token}}}`;
    const active = (lastFocused.current && document.contains(lastFocused.current))
      ? lastFocused.current
      : (document.activeElement as HTMLInputElement | HTMLTextAreaElement | null);
    if (active && ("value" in active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const start = (active as any).selectionStart ?? active.value.length;
      const end = (active as any).selectionEnd ?? active.value.length;
      const newVal = active.value.slice(0, start) + token + active.value.slice(end);
      const evt = new Event("input", { bubbles: true });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (active.tagName === "INPUT" && setter) setter.call(active, newVal);
      else {
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        taSetter?.call(active, newVal);
      }
      active.dispatchEvent(evt);
      try {
        (active as any).setSelectionRange(start + token.length, start + token.length);
      } catch {
        /* noop */
      }
    } else {
      // Append to subject as a fallback
      update({ subject: `${value.subject ?? ""}${token}` });
    }
  }
  const blocks = value.blocks ?? [];

  return (
    <div
      className="card-surface overflow-hidden grid grid-cols-[minmax(0,380px)_minmax(0,1fr)] h-[calc(100vh-11rem)] min-h-[560px]"
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") lastFocused.current = t as any;
      }}
    >
      {/* ============================ LEFT — properties rail ==================== */}
      <div className="border-r border-border flex flex-col min-h-0 bg-card">
        {/* Header: subject / preheader / mode */}
        <div className="px-3.5 py-3 border-b border-border space-y-2 shrink-0">
          <div>
            <label className="text-[10px] font-medium text-muted-foreground">Subject</label>
            <input value={value.subject ?? ""} onChange={(e) => update({ subject: e.target.value })} placeholder="Subject line — visible in the inbox" className="input-base text-sm w-full mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground">Preheader (inbox preview)</label>
            <input value={value.preheader ?? ""} onChange={(e) => update({ preheader: e.target.value })} placeholder="Short preview text after the subject" className="input-base text-sm w-full mt-0.5" />
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-background w-fit">
            <ModeChip active={mode === "designer"} onClick={() => update({ mode: "designer" })} label="Designer" />
            <ModeChip active={mode === "html"} onClick={() => update({ mode: "html" })} label="HTML" />
          </div>
        </div>

        {/* Scrollable accordion rail — hidden scrollbar, mouse-wheel scrolls */}
        <div className="flex-1 overflow-y-auto scrollbar-none min-h-0">
          {mode === "designer" ? (
            <>
              {/* Properties — EVERY block, prefilled, expand to edit in place.
                  Seeing all content at once (Heading, Paragraph, Button, …) makes
                  it obvious which control maps to which part of the preview. */}
              <AccordionSection
                id="properties"
                title="Properties"
                icon={PaintBucket}
                open={open.properties}
                onToggle={() => toggleSection("properties")}
                count={blocks.length}
              >
                {blocks.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-6 px-3">
                    <Sparkles className="size-6 mx-auto text-muted-foreground/40 mb-2" />
                    Add a block below to start building.
                  </div>
                ) : (
                  <BlockList
                    blocks={blocks}
                    selectedId={selectedId}
                    dragId={dragId}
                    onToggleSelect={toggleSelect}
                    onMoveUp={(id) => moveBlock(id, -1)}
                    onMoveDown={(id) => moveBlock(id, 1)}
                    onRemove={removeBlock}
                    onDragStart={setDragId}
                    onDragEnd={() => setDragId(null)}
                    onDropOn={(toId) => { if (dragId) moveBlockTo(dragId, toId); setDragId(null); }}
                    onEditBlock={updateBlock}
                    onInsertField={insertMergeField}
                  />
                )}
              </AccordionSection>

              {/* Blocks — palette to add new blocks (edit/reorder live in Properties) */}
              <AccordionSection id="blocks" title="Add a block" icon={Sparkles} open={open.blocks} onToggle={() => toggleSection("blocks")}>
                <BlockPalette onAdd={addBlock} />
              </AccordionSection>

              {/* Theme */}
              <AccordionSection id="theme" title="Theme" icon={Palette} open={open.theme} onToggle={() => toggleSection("theme")}>
                <ThemePanel theme={theme} onChange={updateTheme} footer={value.footer ?? {}} onFooterChange={(f) => update({ footer: f })} />
              </AccordionSection>

              {/* Merge fields */}
              <AccordionSection id="fields" title="Fields" icon={Variable} open={open.fields} onToggle={() => toggleSection("fields")}>
                <MergeFieldPicker onPick={insertMergeField} />
              </AccordionSection>
            </>
          ) : (
            <>
              {/* HTML mode — raw editor + fields */}
              <div className="p-3.5">
                <HtmlMode html={value.html ?? ""} onChange={(html) => update({ html })} />
              </div>
              <AccordionSection id="fields" title="Fields" icon={Variable} open={open.fields} onToggle={() => toggleSection("fields")}>
                <MergeFieldPicker onPick={insertMergeField} />
              </AccordionSection>
            </>
          )}
        </div>
      </div>

      {/* ============================ RIGHT — full-width live preview ========== */}
      <div className="flex flex-col min-w-0 min-h-0 bg-white">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap bg-card shrink-0">
          <span className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Eye className="size-3.5 text-primary" /> Live preview
          </span>
          <div className="flex items-center gap-2">
            {testMsg && (
              <span className={`text-[11px] ${testState === "error" ? "text-rose-600" : "text-emerald-600"}`}>{testMsg}</span>
            )}
            <button
              onClick={sendTest}
              disabled={testState === "sending"}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-secondary inline-flex items-center gap-1.5 disabled:opacity-50"
              title="Send a sample render of this email to yourself"
            >
              {testState === "sending" ? <Loader2 className="size-3.5 animate-spin" /> : testState === "sent" ? <Check className="size-3.5 text-emerald-600" /> : <Send className="size-3.5" />}
              Send test
            </button>
          </div>
        </div>
        {/* Opened-email header — the Subject + preheader read as the top of the
            message being previewed (not a separate labelled box), with merge
            tokens resolved to sample values so it matches the body preview. */}
        <div className="border-b border-border px-6 pt-4 pb-3 bg-white shrink-0">
          <div className={`text-[17px] font-semibold leading-snug ${value.subject?.trim() ? "text-foreground" : "text-muted-foreground italic"}`}>
            {value.subject?.trim() ? resolvePreviewTokens(value.subject) : "(no subject yet)"}
          </div>
          {value.preheader?.trim() && (
            <div className="text-[13px] text-muted-foreground mt-1 leading-snug">{resolvePreviewTokens(value.preheader)}</div>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <LivePreview html={previewHtml} error={previewError} scrollToId={mode === "designer" ? selectedId : null} />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Full-width live preview + layer outline
// =============================================================================

/** Full-width email preview. Hides the iframe's own scrollbar and — whenever the
 *  content re-renders or the selected block changes — scrolls that block to the
 *  centre of the viewport so the author always sees what they're editing. */
function LivePreview({ html, error, scrollToId }: { html: string; error: string | null; scrollToId: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc =
    html ||
    (error
      ? `<div style='padding:40px;color:#b91c1c;text-align:center;font-family:system-ui;'>Preview unavailable — ${error}.<br/><span style='color:#6b7280;font-size:12px'>Your email content is saved; this is just a preview issue.</span></div>`
      : "<div style='padding:48px;color:#9ca3af;text-align:center;font-family:system-ui;'>Rendering preview…</div>");

  const sync = () => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    // Hide the email's own scrollbar (srcDoc is same-origin).
    if (doc.head && !doc.getElementById("__hide_sb")) {
      const st = doc.createElement("style");
      st.id = "__hide_sb";
      st.textContent = "html{scrollbar-width:none;-ms-overflow-style:none;} ::-webkit-scrollbar{width:0;height:0;display:none;}";
      doc.head.appendChild(st);
    }
    // Neutralise link clicks in the preview: button/link hrefs still hold
    // unresolved merge tokens (e.g. "{{tenant.websiteUrl}}"), which as a relative
    // URL would navigate the iframe INTO the app and throw. This is only a
    // preview — real sends resolve the tokens to working URLs. Block once per
    // loaded document (the flag lives on the doc, so a reload re-arms it).
    if (!(doc as any).__linksBlocked) {
      (doc as any).__linksBlocked = true;
      doc.addEventListener(
        "click",
        (e) => {
          const a = (e.target as HTMLElement | null)?.closest?.("a");
          if (a) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true
      );
    }
    if (scrollToId) {
      doc.getElementById(`eb-${scrollToId}`)?.scrollIntoView({ block: "center", behavior: "auto" });
    }
  };

  // Re-centre when the selection changes (no reload) — the load handler covers
  // content edits (which reload the iframe and reset scroll).
  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, html]);

  return (
    <iframe
      ref={ref}
      title="Email preview"
      srcDoc={srcDoc}
      onLoad={sync}
      className="w-full h-full bg-white block"
      style={{ border: 0 }}
    />
  );
}

/** Collapsible (expand/shrink) accordion section for the left properties rail. */
function AccordionSection({
  title,
  icon: Icon,
  open,
  onToggle,
  count,
  action,
  titleClassName,
  children,
}: {
  id: SectionId;
  title: string;
  icon: any;
  open: boolean;
  onToggle: () => void;
  count?: number;
  action?: React.ReactNode;
  titleClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold hover:bg-secondary/30 transition-colors"
      >
        <Icon className="size-3.5 text-primary shrink-0" />
        <span className={`flex-1 text-left truncate ${titleClassName ?? ""}`}>{title}</span>
        {action}
        {count != null && (
          <span className="text-[10px] text-muted-foreground bg-secondary rounded-full px-1.5 leading-5">{count}</span>
        )}
        <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {/* grid-rows 0fr↔1fr gives a smooth height transition without measuring */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-3.5 pb-3.5 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function blockSummary(b: any): string {
  switch (b.type) {
    case "logo": return "Brand logo";
    case "hero": return b.title || "Hero";
    case "heading": return b.text || "Heading";
    case "text": return (b.html || "").replace(/<[^>]+>/g, "").slice(0, 36) || "Text";
    case "button": return b.label || "Button";
    case "image": return b.alt || b.url || "Image";
    case "image_row": return `${(b.items ?? []).length} images`;
    case "data_table": return b.caption || `${(b.rows ?? []).length}-row table`;
    case "divider": return "Divider";
    case "spacer": return `Spacer · ${b.height ?? 24}px`;
    case "quote": return b.text || "Quote";
    case "social": return "Social links";
    case "html": return "Custom HTML";
    default: return b.type;
  }
}

/** The Properties list: every block shown with a content-aware label + summary,
 *  expandable in place to reveal its prefilled editor. Also supports drag / up /
 *  down / delete so the whole content of the email is authored from one panel. */
function BlockList({
  blocks, selectedId, dragId,
  onToggleSelect, onMoveUp, onMoveDown, onRemove,
  onDragStart, onDragEnd, onDropOn, onEditBlock, onInsertField,
}: {
  blocks: any[];
  selectedId: string | null;
  dragId: string | null;
  onToggleSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOn: (id: string) => void;
  onEditBlock: (id: string, patch: any) => void;
  onInsertField: (f: MergeField) => void;
}) {
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) => {
        const Icon = PALETTE.find((p) => p.type === b.type)?.icon ?? TypeIcon;
        const sel = selectedId === b.id;
        // logo/divider/spacer have no text to insert merge fields into.
        const canInsertField = !["logo", "divider", "spacer"].includes(b.type);
        return (
          <div
            key={b.id}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => { e.preventDefault(); onDropOn(b.id); }}
            className={`rounded-lg border overflow-hidden transition-colors ${
              sel ? "border-primary" : "border-border"
            } ${dragId === b.id ? "opacity-40" : ""}`}
          >
            <div
              onClick={() => onToggleSelect(b.id)}
              className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${
                sel ? "bg-primary/5" : "hover:bg-secondary/40"
              }`}
            >
              <span
                draggable
                onDragStart={(e) => { e.stopPropagation(); onDragStart(b.id); }}
                onDragEnd={onDragEnd}
                onClick={(e) => e.stopPropagation()}
                title="Drag to reorder"
                className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing shrink-0"
              >
                <GripVertical className="size-3.5" />
              </span>
              <Icon className={`size-3.5 shrink-0 ${sel ? "text-primary" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground leading-none">{blockTypeLabel(b)}</div>
                <div className="text-[11px] truncate text-foreground/80 leading-tight mt-0.5">{blockSummary(b)}</div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={(e) => { e.stopPropagation(); onMoveUp(b.id); }} disabled={i === 0} title="Move up" className="btn-icon h-5 w-5 disabled:opacity-30"><ChevronUp className="size-3" /></button>
                <button onClick={(e) => { e.stopPropagation(); onMoveDown(b.id); }} disabled={i === blocks.length - 1} title="Move down" className="btn-icon h-5 w-5 disabled:opacity-30"><ChevronDown className="size-3" /></button>
                <button onClick={(e) => { e.stopPropagation(); onRemove(b.id); }} title="Delete block" className="btn-icon h-5 w-5 text-rose-600"><Trash2 className="size-3" /></button>
              </div>
              <ChevronDown className={`size-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${sel ? "rotate-180" : ""}`} />
            </div>
            {sel && (
              <div className="border-t border-border p-2.5 bg-card space-y-1.5">
                {canInsertField && (
                  <div className="flex justify-end">
                    <FieldMenu onPick={onInsertField} />
                  </div>
                )}
                <BlockEditor block={b} onChange={(patch) => onEditBlock(b.id, patch)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// SIDEBAR — palette, theme, merge fields
// =============================================================================

const PALETTE: Array<{ type: any; label: string; icon: any }> = [
  { type: "logo", label: "Logo", icon: ImageIcon },
  { type: "hero", label: "Hero", icon: Sparkles },
  { type: "heading", label: "Heading", icon: HeadingIcon },
  { type: "text", label: "Text", icon: TypeIcon },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "image_row", label: "Image row", icon: Images },
  { type: "data_table", label: "Data table", icon: TableIcon },
  { type: "divider", label: "Divider", icon: Minus },
  { type: "spacer", label: "Spacer", icon: ArrowUpDown },
  { type: "quote", label: "Quote", icon: Quote },
  { type: "social", label: "Social", icon: Share2 },
  { type: "html", label: "Custom HTML", icon: Code },
];

function BlockPalette({ onAdd, disabled }: { onAdd: (t: any) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Add a block</div>
      {disabled && (
        <div className="text-[11px] text-muted-foreground italic mb-2">
          Switch to <strong>Designer</strong> mode to use blocks. HTML mode is a raw paste-area.
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {PALETTE.map((p) => (
          <button
            key={p.type}
            disabled={disabled}
            onClick={() => onAdd(p.type)}
            className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 disabled:opacity-40 text-xs transition-colors"
          >
            <p.icon className="size-4 text-primary" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemePanel({
  theme,
  onChange,
  footer,
  onFooterChange,
}: {
  theme: EmailTheme;
  onChange: (patch: Partial<EmailTheme>) => void;
  footer: any;
  onFooterChange: (f: any) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <Section title="Brand colors">
        <ColorRow label="Primary" value={theme.brandColor} onChange={(v) => onChange({ brandColor: v })} />
        <ColorRow label="Accent (headings)" value={theme.accentColor} onChange={(v) => onChange({ accentColor: v })} />
        <ColorRow label="Page background" value={theme.pageBackground} onChange={(v) => onChange({ pageBackground: v })} />
        <ColorRow label="Card background" value={theme.cardBackground} onChange={(v) => onChange({ cardBackground: v })} />
      </Section>

      <Section title="Logo">
        <label className="text-[10px] text-muted-foreground">Logo image</label>
        <ImageUploadInput value={theme.logoUrl ?? ""} onChange={(v) => onChange({ logoUrl: v })} placeholder="https://…/logo.png" />
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <label className="text-[10px] text-muted-foreground">Logo height</label>
            <input
              type="number"
              min={20}
              max={120}
              value={theme.logoHeight ?? 40}
              onChange={(e) => onChange({ logoHeight: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Logo align</label>
            <select
              value={theme.logoAlign ?? "center"}
              onChange={(e) => onChange({ logoAlign: e.target.value as any })}
              className="input-base text-xs w-full"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Typography">
        <label className="text-[10px] text-muted-foreground">Font family</label>
        <select
          value={theme.fontFamily ?? "sans"}
          onChange={(e) => onChange({ fontFamily: e.target.value as any })}
          className="input-base text-xs w-full"
        >
          <option value="sans">Sans-serif (system)</option>
          <option value="serif">Serif (Georgia)</option>
          <option value="modern">Modern (Inter)</option>
          <option value="rounded">Rounded</option>
        </select>
        <label className="text-[10px] text-muted-foreground mt-2 block">Base font size (px)</label>
        <input
          type="number"
          min={12}
          max={20}
          value={theme.baseFontSize ?? 15}
          onChange={(e) => onChange({ baseFontSize: Number(e.target.value) })}
          className="input-base text-xs w-full"
        />
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Container width</label>
            <input
              type="number"
              min={480}
              max={800}
              value={theme.containerWidth ?? 600}
              onChange={(e) => onChange({ containerWidth: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Corner radius</label>
            <input
              type="number"
              min={0}
              max={24}
              value={theme.cornerRadius ?? 12}
              onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
        </div>
      </Section>

      <Section title="Footer (SEBI compliance)">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeArn ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeArn: e.target.checked })}
          />
          Include ARN / EUIN line
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeAddress ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeAddress: e.target.checked })}
          />
          Include firm address
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeUnsubscribe ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeUnsubscribe: e.target.checked })}
          />
          Include unsubscribe link
        </label>
        <label className="text-[10px] text-muted-foreground mt-2 block">Custom footer text (optional)</label>
        <textarea
          rows={2}
          value={footer.customText ?? ""}
          onChange={(e) => onFooterChange({ ...footer, customText: e.target.value })}
          className="input-base text-xs w-full"
        />
      </Section>
    </div>
  );
}

function MergeFieldPicker({ onPick }: { onPick: (f: MergeField) => void }) {
  const cats = mergeFieldsByCategory();
  const entries = Object.entries(cats);
  // Each category is its own expand/shrink dropdown (first one open by default).
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(entries.map(([c], i) => [c, i === 0]))
  );
  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-[10px] text-muted-foreground mb-1">
        Click a field to insert it at the cursor. Use{" "}
        <code className="bg-secondary px-1 rounded">{`{{token}}`}</code> syntax anywhere in your text.
      </div>
      {entries.map(([cat, fields]) => (
        <div key={cat} className="rounded-lg border border-border overflow-hidden bg-card">
          <button
            onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold bg-secondary/30 hover:bg-secondary/50 transition-colors"
          >
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
            <span className="flex-1 text-left uppercase tracking-wider text-muted-foreground">{cat}</span>
            <span className="text-[10px] text-muted-foreground bg-background rounded-full px-1.5 leading-4">{fields.length}</span>
            <ChevronDown className={`size-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${open[cat] ? "rotate-180" : ""}`} />
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open[cat] ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <div className="p-1 space-y-0.5">
                {fields.map((f) => (
                  <button
                    key={f.token}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(f)}
                    className="w-full text-left rounded hover:bg-primary/10 p-1.5"
                  >
                    <div className="text-xs font-medium">{f.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{`{{${f.token}}}`}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact "Insert field" dropdown — drops a merge token into the last-touched
 *  input. preventDefault on mousedown keeps that input focused through the click. */
function FieldMenu({ onPick }: { onPick: (f: MergeField) => void }) {
  const [open, setOpen] = useState(false);
  const cats = mergeFieldsByCategory();
  return (
    <div className="relative">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Insert a personalisation field"
        className="text-[11px] px-1.5 py-1 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1"
      >
        <Variable className="size-3" /> Field
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-50 w-60 max-h-72 overflow-y-auto scrollbar-thin card-elevated bg-card p-1.5 text-xs">
            {Object.entries(cats).map(([cat, fields]) => (
              <div key={cat}>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-1.5 pt-1.5">{cat}</div>
                {fields.map((f) => (
                  <button
                    key={f.token}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(f); setOpen(false); }}
                    className="w-full text-left rounded hover:bg-primary/10 p-1.5"
                  >
                    <div className="font-medium">{f.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{`{{${f.token}}}`}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Image field with a real upload button (presigned S3 PUT → public URL). */
function ImageUploadInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(file: File) {
    setBusy(true); setErr(null);
    try {
      const presign = await fetch("/api/content-library/upload-url", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "image/png" }),
      });
      const pj = await presign.json();
      if (!presign.ok) throw new Error(pj.error ?? "Could not start upload");
      const put = await fetch(pj.url, { method: "PUT", headers: { "content-type": file.type || "image/png" }, body: file });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
      onChange(pj.publicUrl);
    } catch (e: any) { setErr(e?.message ?? "Upload failed"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "https://…/image.png"} className="input-base text-xs flex-1 font-mono" />
        <label className="shrink-0 inline-flex items-center gap-1 px-2 rounded-md border border-border hover:bg-secondary cursor-pointer text-[11px]" title="Upload image">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />} Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.currentTarget.value = ""; }} />
        </label>
      </div>
      {err && <div className="text-[10px] text-rose-600">{err}</div>}
    </div>
  );
}

// =============================================================================
// CANVAS — per-type block editor (rendered in the right properties panel)
// =============================================================================

function BlockEditor({ block, onChange }: { block: any; onChange: (patch: any) => void }) {
  switch (block.type) {
    case "logo":
      return <div className="text-[11px] text-muted-foreground italic">Logo URL is set in the Theme panel.</div>;
    case "hero":
      return (
        <div className="space-y-1.5">
          <input value={block.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Hero title" className="input-base text-sm w-full" />
          <input value={block.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Subtitle" className="input-base text-xs w-full" />
          <label className="text-[10px] text-muted-foreground">Hero image (optional)</label>
          <ImageUploadInput value={block.imageUrl ?? ""} onChange={(v) => onChange({ imageUrl: v })} placeholder="Hero image URL (optional)" />
          <SelectInline label="Align" value={block.align ?? "center"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]} />
        </div>
      );
    case "heading":
      return (
        <div className="space-y-1.5">
          <input value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} className="input-base text-sm w-full font-semibold" />
          <div className="flex gap-1.5">
            <SelectInline label="Level" value={block.level} onChange={(v) => onChange({ level: v })} options={[{ value: "h1", label: "H1" }, { value: "h2", label: "H2" }, { value: "h3", label: "H3" }]} />
            <SelectInline label="Align" value={block.align ?? "left"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
          </div>
        </div>
      );
    case "text":
      return (
        <div>
          <textarea
            rows={3}
            value={block.html ?? ""}
            onChange={(e) => onChange({ html: e.target.value })}
            placeholder="Paragraph text — supports basic HTML: <b>, <i>, <a href='…'>, <br>"
            className="input-base text-xs w-full"
          />
          <SelectInline label="Align" value={block.align ?? "left"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
        </div>
      );
    case "button":
      return (
        <div className="space-y-1.5">
          <input value={block.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Button label" className="input-base text-sm w-full" />
          <input value={block.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…" className="input-base text-xs w-full font-mono" />
          <div className="flex gap-1.5">
            <SelectInline label="Style" value={block.style ?? "solid"} onChange={(v) => onChange({ style: v })} options={[{ value: "solid", label: "Solid" }, { value: "outline", label: "Outline" }]} />
            <SelectInline label="Align" value={block.align ?? "center"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
            <label className="flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={block.fullWidth ?? false} onChange={(e) => onChange({ fullWidth: e.target.checked })} /> Full width
            </label>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-1.5">
          <ImageUploadInput value={block.url ?? ""} onChange={(v) => onChange({ url: v })} />
          <div className="grid grid-cols-3 gap-1.5">
            <input value={block.alt ?? ""} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Alt text" className="input-base text-xs col-span-2" />
            <input type="number" value={block.width ?? 560} onChange={(e) => onChange({ width: Number(e.target.value) })} placeholder="Width" className="input-base text-xs" />
          </div>
          <input value={block.linkUrl ?? ""} onChange={(e) => onChange({ linkUrl: e.target.value })} placeholder="Optional link URL (image becomes clickable)" className="input-base text-xs w-full font-mono" />
        </div>
      );
    case "image_row":
      return (
        <div className="space-y-1.5">
          {(block.items ?? []).map((it: any, i: number) => (
            <div key={i} className="space-y-1 rounded-md border border-border p-1.5">
              <div className="text-[10px] text-muted-foreground">Image {i + 1}</div>
              <ImageUploadInput value={it.url} onChange={(v) => onChange({ items: block.items.map((x: any, ix: number) => (ix === i ? { ...x, url: v } : x)) })} placeholder={`Image ${i + 1} URL`} />
              <input value={it.alt ?? ""} onChange={(e) => onChange({ items: block.items.map((x: any, ix: number) => (ix === i ? { ...x, alt: e.target.value } : x)) })} placeholder="Alt text" className="input-base text-xs w-full" />
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                items: [
                  ...(block.items ?? []),
                  { url: "", alt: "" },
                ].slice(0, 3),
              })
            }
            className="btn-ghost text-[11px]"
          >
            + Add image (max 3)
          </button>
        </div>
      );
    case "data_table":
      return (
        <div className="space-y-1.5">
          <input value={block.caption ?? ""} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption (optional)" className="input-base text-xs w-full" />
          {(block.rows ?? []).map((r: any, i: number) => (
            <div key={i} className="flex gap-1.5 items-center">
              <input value={r.label} onChange={(e) => onChange({ rows: block.rows.map((x: any, ix: number) => (ix === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className="input-base text-xs flex-1" />
              <input value={r.value} onChange={(e) => onChange({ rows: block.rows.map((x: any, ix: number) => (ix === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value" className="input-base text-xs flex-1 font-mono" />
              <button onClick={() => onChange({ rows: block.rows.filter((_: any, ix: number) => ix !== i) })} className="btn-icon h-7 text-rose-600">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => onChange({ rows: [...(block.rows ?? []), { label: "", value: "" }] })} className="btn-ghost text-[11px]">
            + Add row
          </button>
        </div>
      );
    case "divider":
      return (
        <div className="flex gap-2 items-center">
          <label className="text-[11px]">Thickness</label>
          <input type="number" min={1} max={6} value={block.thickness ?? 1} onChange={(e) => onChange({ thickness: Number(e.target.value) })} className="input-base text-xs w-16" />
          <label className="text-[11px]">Color</label>
          <input type="color" value={block.color ?? "#e5e7eb"} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 rounded border" />
        </div>
      );
    case "spacer":
      return (
        <div className="flex items-center gap-2">
          <label className="text-[11px]">Height (px)</label>
          <input type="number" min={4} max={120} value={block.height ?? 24} onChange={(e) => onChange({ height: Number(e.target.value) })} className="input-base text-xs w-20" />
        </div>
      );
    case "quote":
      return (
        <div className="space-y-1.5">
          <textarea rows={2} value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} placeholder="Quote text" className="input-base text-xs w-full italic" />
          <input value={block.author ?? ""} onChange={(e) => onChange({ author: e.target.value })} placeholder="Author (optional)" className="input-base text-xs w-full" />
        </div>
      );
    case "social":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(block.links ?? {}).map(([k, v]) => (
            <input
              key={k}
              value={String(v ?? "")}
              onChange={(e) => onChange({ links: { ...(block.links ?? {}), [k]: e.target.value } })}
              placeholder={`${k} URL`}
              className="input-base text-xs"
            />
          ))}
        </div>
      );
    case "html":
      return (
        <textarea
          rows={5}
          value={block.html ?? ""}
          onChange={(e) => onChange({ html: e.target.value })}
          placeholder="<!-- Paste custom HTML — merge fields ({{token}}) are supported -->"
          className="input-base text-xs w-full font-mono"
        />
      );
    default:
      return null;
  }
}

// =============================================================================
// HTML mode
// =============================================================================

function HtmlMode({ html, onChange }: { html: string; onChange: (v: string) => void }) {
  return (
    <div className="card-surface">
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <Code className="size-3.5 text-primary" />
        Paste any HTML — Outlook/Gmail-safe code is recommended. Merge fields like{" "}
        <code className="bg-secondary px-1 rounded">{`{{investor.name}}`}</code> are substituted at send time.
      </div>
      <textarea
        rows={28}
        value={html}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_HTML_TEMPLATE}
        className="w-full p-3 font-mono text-xs bg-white outline-none resize-none"
        spellCheck={false}
      />
    </div>
  );
}

const DEFAULT_HTML_TEMPLATE = `<!-- Custom HTML email - merge fields {{investor.name}} are supported -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;">
      <tr><td style="padding:32px;">
        <h1 style="color:#841f21;margin:0 0 12px;">Welcome, {{investor.name}}</h1>
        <p>Hi {{investor.first_name}},</p>
        <p>Thank you for choosing {{tenant.displayName}}.</p>
        <p style="margin-top:24px;">
          <a href="{{system.dashboard_url}}" style="background:#d22e32;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
            View dashboard
          </a>
        </p>
        <hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb;"/>
        <p style="color:#6b7280;font-size:12px;">
          {{tenant.displayName}} · ARN-{{tenant.arn}}<br/>
          Mutual fund investments are subject to market risks.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

// =============================================================================
// Small helpers
// =============================================================================

function ModeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs ${active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary/40"}`}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 rounded border" />
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input-base text-xs flex-1 font-mono" />
      <label className="text-[11px] text-muted-foreground w-20 text-right">{label}</label>
    </div>
  );
}

function SelectInline({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base text-xs">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// =============================================================================
// Factory
// =============================================================================

function mkBlock(type: any, patch: any = {}): EmailBlock {
  const id = uuid();
  const defaults: Record<string, any> = {
    logo: { type: "logo" },
    hero: { type: "hero", title: "Welcome, {{investor.name}}", subtitle: "", imageUrl: "", imageAlt: "", align: "center" },
    heading: { type: "heading", text: "Section heading", level: "h2", align: "left" },
    text: { type: "text", html: "Type your message here. Use the merge field picker to insert variables.", align: "left" },
    button: { type: "button", label: "View dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false },
    image: { type: "image", url: "", alt: "", width: 560, align: "center" },
    image_row: { type: "image_row", items: [{ url: "", alt: "" }, { url: "", alt: "" }] },
    data_table: { type: "data_table", caption: "", rows: [{ label: "Scheme", value: "{{transaction.scheme_name}}" }, { label: "Amount", value: "₹{{transaction.amount}}" }, { label: "Date", value: "{{transaction.transaction_date}}" }] },
    divider: { type: "divider", thickness: 1, color: "#e5e7eb" },
    spacer: { type: "spacer", height: 24 },
    quote: { type: "quote", text: "A great client relationship is built on trust.", author: "" },
    social: { type: "social", links: { website: "", linkedin: "", facebook: "", instagram: "", youtube: "", twitter: "" } },
    html: { type: "html", html: "<!-- Custom HTML — merge fields supported -->" },
  };
  return { id, ...defaults[type], ...patch };
}
