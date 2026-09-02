-- Seed KAIZEN #1 — "Call me after Diwali" (lead tracking, follow-ups, source & RM conversion).
-- Idempotent: only inserts when that slug is absent, so re-running (or an admin
-- later editing the article in Super Admin) is never clobbered.
--
-- Screenshots are intentionally left empty — image files are uploaded from the
-- admin UI (Super Admin → Knowledge Base) so they land in S3 with real keys.
INSERT INTO kb_articles (
  series, episode_no, slug, title, hook,
  scenario_md, questions,
  solution_md, screenshots, modules,
  read_minutes, published, published_at, sort_order
)
SELECT
  'KAIZEN',
  1,
  'lead-tracking-follow-up-source-rm',
  $t$“Call me after Diwali” — and the lead you never called again$t$,
  $h$Leads come in from Instagram, referrals and your website. They land in WhatsApp, a notebook and someone’s memory. Three months later you cannot say which source gave you a single client.$h$,
  $scenario$It is the first week of the month. You are trying to answer a simple question: **how did last month actually go?**

You know leads came in. One from an Instagram reel. Two referrals from an existing client. A few from the website enquiry form. Someone walked in.

But the leads are **not in one place**. Some are in WhatsApp chats. One is a missed call you meant to return. Two are written in a notebook. Your RM has a few in a personal Excel file that only he updates.

Then the harder part. One prospect had said, *“Sounds good — call me after Diwali, I’ll start a SIP then.”* That was six weeks ago. Nobody called. He didn’t chase you either — he simply started a SIP with someone else who did call.

And when you sit down to plan the next month, you cannot answer:

- The reel got 40 enquiries. Did **any** of them become a client?
- Your best RM says he is “following up with everyone.” Is he?
- The referrals from your top client — what happened to them? Because those are the ones you cannot afford to lose.

Nothing dramatic went wrong. No complaint, no compliance issue. You just **quietly lost business you had already paid to acquire** — and you have no way to prove where it leaked.$scenario$,
  $q$[
    "How many leads did you actually receive last month — and from which source?",
    "Which source gives you clients, not just enquiries?",
    "Which of your RMs converts best — and who is sitting on forgotten follow-ups right now?",
    "How many prospects said ‘contact me later’ and were never contacted?",
    "How long does an enquiry take to become a first investment in your firm?",
    "If your RM resigned tomorrow, would you still have his lead list?"
  ]$q$::jsonb,
  $solution$The fix is not “be more disciplined.” It is making the follow-up **impossible to forget** and the numbers **impossible to hide.**

### 1. Every lead enters through one door

Go to [Leads](/dashboard/leads) → **New lead**. The field that matters most is **Source** — and it is a fixed list, not free text: Referral, Website, Social Media, Meta Ads, Google Ads, LinkedIn, YouTube, Webinar, Seminar, Walk-in, Existing Client, Cold Call, Event.

Fixed values are the whole point. “Insta”, “instagram” and “IG reel” typed by three people can never be added up. One list can.

For website enquiries you do not type anything at all. Build a form under **Settings → Lead Forms**, embed the public link on your site, and every submission **creates the lead automatically** with the source already set.

For a referral, set the source to *Referral* or *Existing Client* and record **who referred them**. That link is kept, so the referral chain is traceable back to the client who gave it to you.

### 2. The follow-up that cannot be forgotten

Every lead carries a **Next Follow-Up date**. That single field is what breaks the “call me after Diwali” failure.

Set the date to the day he asked for, and move the lead to the **Contact in Future** stage. It leaves your working list — so it stops cluttering today — but it does **not** leave the system.

Then turn on the workflow rule **“Lead follow-up due → create owner task.”** On the follow-up date, the CRM **creates a task for whoever owns that lead**. It appears in their task list and their Command Center. Nobody has to remember anything.

Two views you should live in:

- **Leads → Due today** — the calls to make today
- **Leads → Overdue follow-up** — the ones that have already slipped

The target for “Overdue” is zero. It is the single most honest number about whether your desk is actually working its pipeline.

### 3. See the pipeline instead of imagining it

The **Pipeline Board** shows every open lead as a card in its stage — New, Contacted, Meeting Scheduled, Proposal Shared, Contact in Future, and so on. Drag a card and the stage updates.

You are looking for **piles**. Eleven leads stuck in “Proposal Shared” is not eleven lazy RMs — it means your proposal is not closing, and that is a process to fix, not a person to blame.

### 4. Slice it three ways

On the [Leads](/dashboard/leads) list, filter by **Stage**, **Source** and **Owner (RM)** — together. That answers questions you cannot ask a notebook:

- Social Media + still open → is anyone working the reel enquiries?
- Referral + Lost → the most expensive column in your business
- One RM + Overdue follow-up → a coaching conversation, backed by data

### 5. The answer layer: Lead Funnel & Conversion

Open **Reports → Lead Funnel & Conversion (Source × RM)**. This is where the month-end questions get answered on one screen. Pick a window (30 / 90 / 180 / 365 days) and you get:

**By source** — leads, converted, **conversion %**, lost, and average days to convert.

Read the conversion column, not the lead count. A source with 20 leads and 6 clients (30%) is worth far more than one with 200 leads and 3 clients (1.5%). That is the difference between scaling your ad spend and wasting it.

**By RM** — leads, converted, **conversion %**, lost, **overdue follow-ups**, average days to convert.

Read the last two columns together. An RM with a high conversion % and zero overdue follow-ups is your template — find out what he does on the second call and teach it. An RM with plenty of leads, low conversion and a stack of overdue follow-ups does not have a motivation problem; he has a **capacity or a process** problem, and now you can see which.

**Open pipeline by stage** — where leads are sitting, and how many of those have an overdue follow-up.

Plus the headline numbers: total leads, converted and conversion %, still open, **average days from enquiry to client**, follow-ups overdue, leads with **no follow-up date set at all** (the silent leak), and due today.

Every one of those tiles is clickable — it takes you to the actual list of leads behind the number, so a metric always turns into a worklist.

### 6. It survives your team changing

Leads belong to the **firm**, not to a person’s phone. Reassign an owner and the full history — every stage change, call log, note and follow-up date — moves with the lead. When someone resigns, you hand over a pipeline instead of reconstructing one.

---

### What to do in the next 20 minutes

1. Set **Source** on every open lead you have. Even retrospectively — you need the baseline.
2. Give every open lead a **Next Follow-Up date**. If you don’t know, use two weeks out.
3. Turn on the **“Lead follow-up due”** workflow rule.
4. Open **Reports → Lead Funnel & Conversion** and note your conversion % by source. That is your starting line.
5. Make **Leads → Overdue follow-up = 0** the one number you check every morning.

The prospect who said “call me after Diwali” is still worth a call. In a system, he gets one.$solution$,
  '[]'::jsonb,
  $m$["Leads","Pipeline","Tasks","Workflow Rules","Reports","Referrals"]$m$::jsonb,
  6,
  true,
  now(),
  10
WHERE NOT EXISTS (
  SELECT 1 FROM kb_articles WHERE slug = 'lead-tracking-follow-up-source-rm'
);
