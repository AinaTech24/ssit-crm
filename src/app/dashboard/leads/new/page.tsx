"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, UserPlus, Loader2, AlertTriangle, ExternalLink, Camera, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { RmSelector } from "@/components/common/RmSelector";
import { SubDistributorLookup } from "@/components/common/SubDistributorLookup";
import { SelectField } from "@/components/ui/SelectField";
import { ThemeDate } from "@/components/ui/ThemeDate";
import { CustomFieldsSection, missingRequired, type CustomFieldDef } from "@/components/common/CustomFieldInputs";

type DupMatch = {
  id: string;
  name: string;
  stage: string;
  source: string;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
  matchedOn: string[];
};

/** Sources that require / suggest linking an existing client as the referrer. */
const REFERRAL_SOURCES = new Set(["referral", "existing_client"]);

const PRODUCT_OPTIONS = [
  "Equity MF", "Debt MF", "Hybrid MF", "ELSS (Tax)", "Index Funds",
  "SIP", "Lumpsum", "NPS", "Insurance", "PMS", "AIF", "FD / Bonds",
];

const LEAD_TYPES: [string, string][] = [
  ["", "Select…"],
  ["individual", "Individual"],
  ["hni", "HNI"],
  ["nri", "NRI"],
  ["corporate", "Corporate"],
  ["minor", "Minor"],
];

const AUM_BANDS: [string, string][] = [
  ["", "Select…"],
  ["under_10l", "< ₹10 L"],
  ["10l_50l", "₹10 – 50 L"],
  ["50l_2cr", "₹50 L – 2 Cr"],
  ["hni_2cr_plus", "HNI · ₹2 Cr+"],
];

export default function NewLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    avatarUrl: "",
    email: "",
    phone: "",
    city: "",
    source: "manual",
    // Set only when source === "event" — sent as sourceCampaign.
    eventName: "",
    expectedBusinessAmount: "",
    leadType: "",
    aumPotential: "",
    occupation: "",
    altPhone: "",
    altEmail: "",
    followUpDate: "",
    interestProducts: [] as string[],
    currentInvestments: [] as string[],
    notes: "",
    referredByInvestorId: "" as string | null | "",
    referredByName: "" as string | null | "",
    ownerId: "" as string | null | "",
    subDistributorId: "" as string | null | "",
    subDistributorName: "" as string | null | "",
  });
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [cfDefs, setCfDefs] = useState<CustomFieldDef[]>([]);
  const [busy, setBusy] = useState(false);
  // Quick-add first: essentials only, full form behind one toggle.
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DupMatch[]>([]);
  const [dupChecking, setDupChecking] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Firm-managed event list (master_values / lead_event), loaded lazily the
  // first time the Event source is chosen.
  const [events, setEvents] = useState<Array<{ key: string; label: string }> | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);

  // The creator owns the lead they enter. Pre-select them so the field shows
  // what will actually happen (the API defaults to the creator regardless).
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((j) => {
        const meId = j?.user?.id;
        if (alive && meId) setForm((f) => (f.ownerId ? f : { ...f, ownerId: meId }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /** Drop the selected event from the firm's list (soft delete server-side). */
  const removeSelectedEvent = useCallback(async () => {
    const ev = (events ?? []).find((e) => e.label === form.eventName);
    if (!ev) return;
    if (!confirm(`Remove "${ev.label}" from the event list?\n\nLeads already tagged with it keep their attribution.`)) return;
    const res = await fetch(`/api/lead-events?key=${encodeURIComponent(ev.key)}`, { method: "DELETE" });
    if (!res.ok) {
      alert((await res.json().catch(() => ({})))?.error ?? "Could not remove the event.");
      return;
    }
    setEvents((list) => (list ?? []).filter((e) => e.key !== ev.key));
    setForm((s) => ({ ...s, eventName: "" }));
  }, [events, form.eventName]);

  /** Load the firm's event list once, the first time it is needed. */
  const loadEvents = useCallback(async () => {
    if (events !== null) return;
    try {
      const j = await fetch("/api/lead-events").then((r) => r.json());
      setEvents(Array.isArray(j.events) ? j.events : []);
    } catch {
      setEvents([]);
    }
  }, [events]);

  /** Persist a new event so it is in the dropdown for everyone next time. */
  async function saveEvent() {
    const label = newEvent.trim();
    if (label.length < 2) return;
    setSavingEvent(true);
    setErr(null);
    try {
      const res = await fetch("/api/lead-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Could not add the event"); return; }
      const ev = j.event as { key: string; label: string };
      setEvents((prev) => {
        const rest = (prev ?? []).filter((e) => e.key !== ev.key);
        return [...rest, ev].sort((a, b) => a.label.localeCompare(b.label));
      });
      setForm((f) => ({ ...f, eventName: ev.label }));
      setNewEvent("");
      setAddingEvent(false);
    } finally {
      setSavingEvent(false);
    }
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Please choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setErr("Image must be under 5 MB.");
    setUploadingAvatar(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "general");
      fd.append("docType", "avatar");
      if (form.name) fd.append("clientName", form.name);
      const up = await fetch("/api/compliance/upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .catch(() => ({}));
      if (!up?.key) return setErr(up?.error ?? "Photo upload failed");
      setForm((f) => ({ ...f, avatarUrl: up.key }));
      setAvatarPreview(URL.createObjectURL(file));
    } finally {
      setUploadingAvatar(false);
    }
  }
  function clearAvatar() {
    setForm((f) => ({ ...f, avatarUrl: "" }));
    setAvatarPreview(null);
  }

  // Debounced live duplicate scan — fires when phone or email changes,
  // hits /api/leads/check-duplicate, surfaces matches inline.
  useEffect(() => {
    const phoneClean = form.phone.replace(/\D/g, "");
    const emailClean = form.email.trim();
    // Wait until the input is plausibly complete before bothering the API.
    if (phoneClean.length < 10 && emailClean.length < 5) {
      setDuplicates([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setDupChecking(true);
      try {
        const res = await fetch("/api/leads/check-duplicate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phone: phoneClean.length >= 10 ? form.phone : undefined,
            email: emailClean.length >= 5 ? emailClean : undefined,
          }),
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const j = await res.json();
        setDuplicates(j.matches ?? []);
      } catch {
        // ignore — best-effort warning
      } finally {
        setDupChecking(false);
      }
    }, 450);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
  }, [form.phone, form.email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const missCf = missingRequired(cfDefs, customFields);
      if (missCf) { setErr(`${missCf.label} is required.`); return; }
      // Build a clean payload — coerce numbers/dates, omit empties (an empty
      // string would fail the API's enum / uuid / number validators).
      const payload: any = {
        name: form.name,
        avatarUrl: form.avatarUrl || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        source: form.source,
        // The event a lead was met at rides along as the campaign string.
        sourceCampaign: form.source === "event" && form.eventName ? form.eventName : undefined,
        notes: form.notes || undefined,
        leadType: form.leadType || undefined,
        aumPotential: form.aumPotential || undefined,
        occupation: form.occupation || undefined,
        altPhone: form.altPhone || undefined,
        altEmail: form.altEmail || undefined,
        interestProducts: form.interestProducts.length ? form.interestProducts : undefined,
        currentInvestments: form.currentInvestments.length ? form.currentInvestments : undefined,
        expectedBusinessAmount: form.expectedBusinessAmount
          ? Number(form.expectedBusinessAmount)
          : undefined,
        // datetime-local is local + tz-naive; send a proper ISO instant.
        followUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : undefined,
      };
      if (form.referredByInvestorId) {
        payload.referredByInvestorId = form.referredByInvestorId;
        payload.referredByName = form.referredByName;
      }
      if (form.ownerId) payload.ownerId = form.ownerId;
      if (form.subDistributorId) payload.subDistributorId = form.subDistributorId;
      if (Object.keys(customFields).length) payload.customFields = customFields;
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push("/dashboard/leads");
    } finally {
      setBusy(false);
    }
  }

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  function toggleArr(key: "interestProducts" | "currentInvestments", val: string) {
    setForm((s) => {
      const arr = s[key];
      return { ...s, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  }

  const showReferrerLookup = REFERRAL_SOURCES.has(form.source);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link
        href="/dashboard/leads"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to leads
      </Link>

      <div>
        <h1 className="page-title">
          <UserPlus className="size-6 text-brand-cyan" /> New lead
        </h1>
      </div>

      <form onSubmit={submit} className="card-surface p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
        <div className={showAll ? "sm:col-span-2 flex items-center gap-3" : "hidden"}>
          <Avatar src={avatarPreview} name={form.name} size={56} />
          <div className="flex items-center gap-2">
            <label className="btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer">
              {uploadingAvatar ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              {form.avatarUrl ? "Change photo" : "Add photo"}{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
              <input type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
            </label>
            {form.avatarUrl && (
              <button type="button" onClick={clearAvatar} className="btn-ghost text-xs inline-flex items-center gap-1 text-rose-600">
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
          </div>
        </div>
        <Row label="Name" value={form.name} setValue={(v) => set("name", v)} required />
        <Row
          label="Phone"
          value={form.phone}
          setValue={(v) => set("phone", v)}
        // placeholder="+919XXXXXXXXX"
        />
        <Row
          label="Email"
          value={form.email}
          setValue={(v) => set("email", v)}
          type="email"
        />

        {/* Live duplicate warning — shown when /check-duplicate returns matches.
            Doesn't block submission; just nudges the RM to confirm or open the
            existing lead. */}
        {duplicates.length > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-700 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-900">
                {duplicates.length} possible duplicate
                {duplicates.length === 1 ? "" : "s"} found
              </span>
              {dupChecking && <Loader2 className="size-3 animate-spin text-amber-700" />}
            </div>
            <p className="text-[11px] text-amber-900/80">
              These existing leads share a phone or email with what you typed.
              Open the matching record instead of re-creating to avoid duplicate
              follow-ups.
            </p>
            <ul className="space-y-1">
              {duplicates.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between bg-white/70 rounded-md px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      stage: {m.stage} · source: {m.source} · matched on{" "}
                      {m.matchedOn.join(", ")}
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/leads/${m.id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-amber-800 hover:text-amber-900 font-semibold whitespace-nowrap"
                  >
                    Open <ExternalLink className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={showAll ? "contents" : "hidden"}>
          <Row label="City" value={form.city} setValue={(v) => set("city", v)} />
        </div>

        <div>
          <div className="text-xs font-medium mb-1">Source</div>
          <SelectField
            value={form.source}
            onChange={(e) => {
              const v = e.target.value;
              set("source", v);
              // Clear referrer fields if user switches away from a referral source
              if (!REFERRAL_SOURCES.has(v)) {
                setForm((s) => ({ ...s, referredByInvestorId: "", referredByName: "" }));
              }
              if (v === "event") loadEvents();
              else setForm((s) => ({ ...s, eventName: "" }));
            }}
          >
            <option value="referral">Client Referral</option>
            <option value="existing_client">Existing Client Reference</option>
            <option value="website">Website</option>
            <option value="social_media">Social Media</option>
            <option value="webinar">Webinar</option>
            <option value="seminar">Seminar</option>
            <option value="event">Event</option>
            <option value="walk_in">Walk-in</option>
            <option value="google">Google</option>
            <option value="cold_call">Cold Call</option>
            <option value="other">Other</option>
            <option value="manual">Manual entry</option>
          </SelectField>
        </div>

        {/* Event picker — sits in the grid cell NEXT TO Source, and only when
            the source is Event. Choose one the firm already ran, or add a new
            one inline; added events persist and appear here for everyone. */}
        {form.source === "event" && (
          <div className="animate-fade-in">
            <div className="text-xs font-medium mb-1 flex items-center justify-between gap-2">
              <span>
                Event<span className="text-rose-600 ml-0.5">*</span>
              </span>
              {!addingEvent && (
                <button
                  type="button"
                  onClick={() => { setAddingEvent(true); setNewEvent(""); }}
                  className="text-[11px] font-semibold text-brand-cyan hover:underline"
                >
                  + Add event
                </button>
              )}
            </div>

            {addingEvent ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newEvent}
                  onChange={(e) => setNewEvent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveEvent(); }
                    if (e.key === "Escape") { setAddingEvent(false); setNewEvent(""); }
                  }}
                  placeholder="e.g. Andheri Investor Meet 2026"
                  className="input-base flex-1"
                />
                <button
                  type="button"
                  onClick={saveEvent}
                  disabled={savingEvent || newEvent.trim().length < 2}
                  className="btn-primary text-xs px-3 whitespace-nowrap disabled:opacity-50"
                >
                  {savingEvent ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingEvent(false); setNewEvent(""); }}
                  className="btn-secondary text-xs px-3"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
              <SelectField
                value={form.eventName}
                onChange={(e) => set("eventName", e.target.value)}
              >
                <option value="">
                  {events === null
                    ? "Loading events…"
                    : events.length === 0
                      ? "No events yet — use “Add event”"
                      : "Select the event…"}
                </option>
                {(events ?? []).map((ev) => (
                  <option key={ev.key} value={ev.label}>{ev.label}</option>
                ))}
              </SelectField>
              {form.eventName && (
                <button
                  type="button"
                  onClick={removeSelectedEvent}
                  title={`Remove "${form.eventName}" from the event list`}
                  aria-label={`Remove ${form.eventName} from the event list`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <X className="size-4" />
                </button>
              )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              Saved against the lead so you can measure which events actually produce business.
            </p>
          </div>
        )}

        {/* Conditional referrer lookup — appears only for referral / existing-client sources */}
        {showReferrerLookup && (
          <div className="sm:col-span-2 rounded-xl bg-brand-cyan-light/30 border border-brand-cyan/20 p-3.5 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-brand-cyan-deep uppercase tracking-wider">
                Referred by (Client) <span className="text-rose-600">*</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Lookup from Clients module
              </span>
            </div>
            <InvestorLookup
              value={form.referredByInvestorId || null}
              displayName={form.referredByName || null}
              onSelect={(id, name) =>
                setForm((s) => ({
                  ...s,
                  referredByInvestorId: id,
                  referredByName: name,
                }))
              }
              onClear={() =>
                setForm((s) => ({ ...s, referredByInvestorId: "", referredByName: "" }))
              }
              placeholder="Type the existing client's name, PAN, or mobile…"
              required={showReferrerLookup}
            />
            <p className="text-[11px] text-muted-foreground">
              The referring client will be linked so referral credit is tracked end-to-end.
            </p>
          </div>
        )}

        <div className={showAll ? "sm:col-span-2" : "hidden"}>
          <div className="text-xs font-medium mb-1">
            Sub-distributor
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · optional · channel partner credit
            </span>
          </div>
          <SubDistributorLookup
            value={form.subDistributorId || null}
            displayName={form.subDistributorName || null}
            onSelect={(id, name) =>
              setForm((s) => ({
                ...s,
                subDistributorId: id,
                subDistributorName: name,
              }))
            }
            onClear={() =>
              setForm((s) => ({ ...s, subDistributorId: "", subDistributorName: "" }))
            }
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Attribute this lead to a channel partner. On conversion, their
            commission split applies in the brokerage reconciler.
          </p>
        </div>

        <div className="sm:col-span-2">
          <div className="text-xs font-medium mb-1">
            Assign RM
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · defaults to you
            </span>
          </div>
          <RmSelector
            value={form.ownerId || null}
            onChange={(id) => setForm((s) => ({ ...s, ownerId: id ?? "" }))}
            placeholder="You (the person creating this lead)"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            You own every lead you create. Change this only to hand it to a colleague.
          </p>
        </div>

        {/* Essential: "call me next week" is the whole job half the time. */}
        <div className="sm:col-span-2">
          <div className="text-xs font-medium mb-1">Follow-up date</div>
          <ThemeDate
            type="datetime-local"
            value={form.followUpDate}
            onChange={(v) => set("followUpDate", v)}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Sets the next follow-up + creates an RM task so nobody forgets.
          </p>
        </div>

        {/* Everything below is optional detail — hidden until asked for, so a
            lead can be captured mid-phone-call in four fields. */}
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            aria-expanded={showAll}
          >
            {showAll ? "Hide extra details" : "Add full details — photo, email, products, amounts & more"}
          </button>
        </div>

        {/* Qualification — type, products, expected value */}
        <div className={showAll ? "contents" : "hidden"}>
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Lead type</div>
            <SelectField value={form.leadType} onChange={(e) => set("leadType", e.target.value)}>
              {LEAD_TYPES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">AUM potential</div>
            <SelectField value={form.aumPotential} onChange={(e) => set("aumPotential", e.target.value)}>
              {AUM_BANDS.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </SelectField>
          </label>
        </div>

        <div className="sm:col-span-2">
          <div className="text-xs font-medium mb-1">Products of interest</div>
          <Chips
            options={PRODUCT_OPTIONS}
            selected={form.interestProducts}
            onToggle={(v) => toggleArr("interestProducts", v)}
          />
        </div>

        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <Row
            label="Expected business (₹)"
            value={form.expectedBusinessAmount}
            setValue={(v) => set("expectedBusinessAmount", v)}
            type="number"
          />
        </div>

        <Row label="Occupation" value={form.occupation} setValue={(v) => set("occupation", v)} />
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <Row label="Alternate phone" value={form.altPhone} setValue={(v) => set("altPhone", v)} placeholder="Secondary number" />
          <Row label="Alternate email" value={form.altEmail} setValue={(v) => set("altEmail", v)} type="email" placeholder="Secondary email" />
        </div>

        <div className="sm:col-span-2">
          <div className="text-xs font-medium mb-1">
            Current investments
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">· what they already hold elsewhere</span>
          </div>
          <Chips
            options={PRODUCT_OPTIONS}
            selected={form.currentInvestments}
            onToggle={(v) => toggleArr("currentInvestments", v)}
          />
        </div>

        <div className="sm:col-span-2">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Anything the RM should know about this lead…"
            className="input-base"
          />
        </div>

        {/* Firm-defined custom fields (Settings → Custom fields) */}
        <div className="sm:col-span-2">
          <CustomFieldsSection entity="lead" values={customFields} onChange={setCustomFields} onDefsLoaded={setCfDefs} />
        </div>
        </div>

        {err && (
          <div className="sm:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/leads" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={
              busy ||
              !form.name ||
              (showReferrerLookup && !form.referredByInvestorId) ||
              (form.source === "event" && !form.eventName)
            }
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Creating…" : "Create lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({
  label,
  value,
  setValue,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="input-base"
      />
    </label>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${on
              ? "bg-brand-cyan text-white border-brand-cyan"
              : "bg-secondary/40 text-muted-foreground border-border hover:bg-secondary"
              }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
