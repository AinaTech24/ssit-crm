-- Seed KAIZEN #2 — the client who told you money was coming, and you forgot.
-- Idempotent on slug, so an admin editing it later is never clobbered.
INSERT INTO kb_articles (
  series, episode_no, slug, title, hook,
  scenario_md, questions, solution_md, screenshots, modules,
  read_minutes, published, published_at, sort_order
)
SELECT
  'KAIZEN', 2,
  'expected-inflows-fd-maturity-bonus',
  $t$“My FD matures in March” — and in March, nobody called$t$,
  $h$Your client tells you money is coming. You mean to remember. Three months later the money is in his savings account — or someone else’s scheme.$h$,
  $scenario$A client mentions it casually, at the end of a review call:

*“My FD matures in March. Around ₹12 lakh. Remind me then, we’ll invest it.”*

You say you will. You mean it.

March comes. You are dealing with a redemption, two KYC rejections and a bounced SIP. Nobody calls him.

In May he mentions the money is “parked in savings for now.” Or worse — his bank RM called him in the first week of March, and it is already in their scheme.

You did not lose this to poor performance or bad advice. You lost it to a date nobody wrote down.

And it is not one client. Across your book, in any given quarter, there are FD maturities, annual bonuses, LIC maturities, gratuity, a property sale. Money you already know about — and cannot see anywhere.$scenario$,
  $q$[
    "How much money is landing in your clients’ hands over the next 90 days?",
    "Who told you they had money coming — and when exactly?",
    "Who is supposed to make that call, and will they remember?",
    "Of the money that matured last quarter, how much did you actually invest?",
    "If your RM forgets, does anything in your system catch it?"
  ]$q$::jsonb,
  $solution$**The real problem:** this is the easiest money you will ever raise — a client volunteering that funds are coming — and it lives in nobody’s system.

### 1. Capture it while you are still on the call

On the client’s profile, under **Expected inflows**, click **Add** and record four things:

- **Source** — FD maturity, bonus, LIC maturity, property sale, gratuity, ESOP, PPF/EPF…
- **Amount** — even a rough one
- **Date** — the 1st of the month is fine if that is all you know
- **Confidence** — high (he confirmed the date), medium (roughly that month), low (vague, still worth tracking)

Ten seconds, during the call.

### 2. The reminder sets itself

Saving creates a **task for the owning RM**, due a set number of days **before** the money lands (14 by default — change it per inflow).

It behaves like every other task: it appears in their list, in Command Center, and it pings them.

> You are not relying on memory. You are relying on a date.

### 3. See the whole quarter at once

**Expected Inflows** (in Operations) groups every tracked inflow **by month**, with a ₹ total per month and four numbers at the top:

- **Expected next 90 days** — your near-term opportunity, in rupees
- **Total upcoming**
- **Date passed, not actioned** — money that matured while you were busy. Target: zero.
- **Captured** — what you actually invested, as a % of matured money

That last one is the honest scoreboard. Most firms have never measured it.

### 4. Close the loop

When the money lands and you invest it, mark the inflow **invested** and record the amount. The reminder task closes itself.

Mark it **lapsed** if it went elsewhere — that is not failure, it is data. A pattern of lapses on one RM, or one source, tells you exactly where to coach.

---

### Do this in 20 minutes

1. Think of the **three** clients who told you money is coming this year. Add them now.
2. Make it a habit: every review call ends with *“anything maturing in the next twelve months?”*
3. Check **Expected Inflows** on the 1st of every month.
4. Watch **Date passed, not actioned**. If it is above zero, something slipped.

The client who said “my FD matures in March” is telling you where your next ₹12 lakh comes from. Write it down.$solution$,
  $shots$[
    {
      "storageKey": "kb/kaizen-02/1-expected-inflows.png",
      "caption": "Every expected inflow grouped by month, with a ₹ total per month — and the number that matters most: money whose date passed with nobody acting on it.",
      "alt": "SSIT CRM Expected Inflows page showing upcoming client money grouped by month with rupee totals"
    }
  ]$shots$::jsonb,
  $m$["Clients","Expected Inflows","Tasks","Reminders"]$m$::jsonb,
  3, true, now(), 20
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE slug = 'expected-inflows-fd-maturity-bonus');
