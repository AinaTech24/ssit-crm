-- Rewrite KAIZEN #1 shorter and more scannable. The first cut read like an
-- essay; MFDs skim. Same argument, ~60% fewer words, bullets over prose.
-- Screenshots and slug are untouched.
UPDATE kb_articles
   SET hook = $h$Leads arrive from Instagram, referrals and your website — then scatter across WhatsApp, a notebook and someone’s memory.$h$,
       read_minutes = 3,
       scenario_md = $scenario$It is the 5th. You are working out how last month went.

Leads did come in. An Instagram reel. Two referrals. A few from the website.

But they are scattered — some in WhatsApp, one a missed call, two in a notebook, a few in an RM’s private Excel.

And one prospect had said: *“Call me after Diwali, I’ll start a SIP.”*

That was six weeks ago. Nobody called. He started a SIP with someone else.

Nothing broke. No complaint. You simply lost business you had already paid to acquire — and you cannot prove where it leaked.$scenario$,
       questions = $q$[
         "How many leads came in last month — and from where?",
         "Which source gives you clients, not just enquiries?",
         "Which RM converts best? Who has forgotten follow-ups right now?",
         "How many prospects said ‘call me later’ and were never called?",
         "How long does an enquiry take to become an investment?"
       ]$q$::jsonb,
       solution_md = $solution$**The real problem:** follow-ups live in someone’s memory. Memory fails.

Here is the fix, in four steps.

---

### 1. One place, one Source list

- Every lead goes into **Leads**, with **Source** picked from a fixed list — Referral, Website, Social Media, Meta Ads, Google Ads, Walk-in, Existing Client.
- Website enquiries **create themselves** through a public form (Settings → Lead Forms). Source is already set.
- Fixed list = no more “Insta”, “instagram” and “IG reel” as three different sources. You can finally add them up.

### 2. A date, not a memory

- Every lead carries a **Next Follow-Up date**.
- “Call me after Diwali” → set that date, move the lead to **Contact in Future**. It leaves today’s list, not the system.
- Switch on the rule **“Lead follow-up due → create owner task.”** On the date, the CRM raises a task for the lead’s owner. Nobody has to remember.
- Live in two views: **Due today** and **Overdue follow-up**.

> Make **Overdue = 0** the number you check every morning.

### 3. See where leads are stuck

The **Pipeline Board** shows every open lead as a card in its stage.

Look for **piles**. Eleven leads stuck at “Proposal Shared” is not eleven lazy RMs — your proposal is not closing. That is a process to fix.

### 4. Get the answers

Open **Reports → Lead Funnel & Conversion**.

**By source** — leads, converted, **conversion %**, avg days.

Read conversion %, not lead count. 20 leads → 6 clients (30%) beats 200 leads → 3 clients (1.5%). That is the difference between scaling ad spend and wasting it.

**By RM** — conversion % next to **overdue follow-ups**.

Read those two columns together:
- High conversion, zero overdue → your template. Find out what they do and teach it.
- Many leads, low conversion, stack of overdue → not a motivation problem. A capacity or process problem.

**Headline numbers** — avg days from enquiry to client, follow-ups overdue, and leads with **no follow-up date at all** (the silent leak).

Every tile clicks through to the actual list.

---

### Do this in 20 minutes

1. Set **Source** on every open lead.
2. Give every open lead a **Next Follow-Up date**. Unsure? Two weeks out.
3. Turn on the **“Lead follow-up due”** rule.
4. Open **Lead Funnel & Conversion** and note your conversion % by source. That is your baseline.

The prospect who said “call me after Diwali” is still worth a call. In a system, he gets one.$solution$,
       updated_at = now()
 WHERE slug = 'lead-tracking-follow-up-source-rm';
