# Induction Module — Design

Employee induction: a new team member joins, works through a training track,
unlocks CRM modules as they progress, sits an exam, and on passing receives a
confirmation letter.

> **Scope note.** The existing `onboarding` schema is *client* onboarding
> (investor pipelines, 11 stages). This is unrelated — it is **team member**
> induction. Naming everything `induction_*` keeps the two from colliding.

---

## 1. What already exists (reuse, don't rebuild)

| Need | Existing piece |
|---|---|
| Per-user module visibility | `users.enabledModules` — jsonb array of sidebar hrefs, already enforced in `src/app/dashboard/layout.tsx:420` |
| The list of gateable modules | `src/lib/nav/sidebar-registry.ts` (`SIDEBAR_REGISTRY`) |
| "Employees" | A **view over `users`** — there is no separate employees table. Induction attaches to `users.id` |
| File/video storage | `src/lib/storage/s3.ts` + `file-sniff.ts` |
| Written material | `kb_articles` (KB) and the documents module |
| Letter PDF | `src/lib/pdf/report-header.ts` + the `*-pdf.ts` generators (e.g. `proposal-pdf.ts`) |
| Tenant isolation | `withTenant` + RLS `tenant_isolation` policy per table |
| Invite / joiner creation | Team management (invite → set password on accept) |

---

## 2. Data model (migration `0191_induction.sql`)

Six tables, all with `tenant_id` + `ENABLE`/`FORCE ROW LEVEL SECURITY` +
`tenant_isolation` (per the rule in CLAUDE.md — do not rely on `0001`).

### `induction_tracks`
A curriculum. One per role, typically ("RM Induction", "Ops Induction").

```
id, tenant_id, name, description,
target_roles      jsonb   -- ["rm"] — used for auto-enrolment
pass_mark         int     -- percent, default 70
max_attempts      int     -- default 3, null = unlimited
cooldown_hours    int     -- default 24, between failed attempts
issue_letter      bool    -- default true
status            text    -- draft | active | archived
timestamps
```

### `induction_lessons`
An ordered step inside a track.

```
id, tenant_id, track_id, position int,
title, summary,
kind              text    -- video | document | kb_article | link | checklist
video_key         text    -- S3 key (self-hosted)
video_url         text    -- external (YouTube/Vimeo) alternative
duration_seconds  int     -- authoritative length, for the completion rule
doc_key           text
kb_article_id     uuid    -- reuse the KB
body_md           text    -- inline copy for short steps
unlocks_modules   jsonb   -- ["/dashboard/leads", …] hrefs from SIDEBAR_REGISTRY
required          bool    -- default true
timestamps
UNIQUE (track_id, position)
```

`unlocks_modules` is the heart of requirement 2: finishing a lesson grants
exactly the modules that lesson teaches.

### `induction_enrolments`
One row per user per track.

```
id, tenant_id, track_id, user_id,
status            text    -- not_started | in_progress | exam_ready | passed | failed
started_at, completed_at,
letter_issued_at, letter_token text UNIQUE, letter_key text,
assigned_by_user_id, due_at,
timestamps
UNIQUE (track_id, user_id)
```

### `induction_progress`
Per lesson, per enrolment.

```
id, tenant_id, enrolment_id, lesson_id,
watched_seconds int default 0,
max_position_seconds int default 0,   -- furthest point reached (anti-skip)
completed_at timestamp,
UNIQUE (enrolment_id, lesson_id)
```

### `induction_questions`
```
id, tenant_id, track_id, lesson_id (nullable — ties a question to a lesson),
prompt, options jsonb [{key,text}], correct_keys jsonb, explanation,
points int default 1, active bool
```

### `induction_attempts`
```
id, tenant_id, enrolment_id, attempt_no int,
started_at, submitted_at,
questions jsonb   -- frozen question set + order for this attempt
answers   jsonb,
score_pct numeric, passed bool,
UNIQUE (enrolment_id, attempt_no)
```

---

## 3. Flow 1 — New team member onboarding

```
Owner invites member (existing flow)
        │
        ▼
Member accepts, sets password
        │
        ▼
Auto-enrol: active track whose target_roles ∩ user's roles   ──► induction_enrolments (not_started)
        │
        ▼
First login → redirected to /dashboard/induction
        │
        ▼
Lesson 1 unlocked; the rest greyed with "Complete the previous step"
```

Auto-enrolment happens in the invite-accept transaction, so a joiner is never
left without a track. If no track matches their role, no enrolment is created
and nothing changes for them.

**Landing behaviour.** A user with an incomplete *required* induction gets a
persistent banner and a nudge to `/dashboard/induction`. I recommend **not**
hard-blocking the whole CRM: a new joiner often needs to look something up on
day one, and a hard block turns a training tool into a support ticket. Make
hard-block a per-track opt-in (`block_until_passed`) if you want it.

---

## 4. Flow 2 — Training + progressive module access

### Completion rule for a video

Tracked by a heartbeat: the player posts `{lessonId, position, watched}` every
15s to `POST /api/induction/progress`. A lesson auto-completes when
`watched_seconds >= 0.9 × duration_seconds` **and** `max_position_seconds`
reached the last 10%.

> **Be realistic about this.** Watch-tracking is a good-faith mechanism, not
> DRM. A determined user can post fake heartbeats. The exam is the real
> assessment; the watch rule exists to stop accidental skipping. Don't sell it
> internally as proof someone watched.

### Unlocking modules

On lesson completion, in one transaction:

```
users.enabledModules = distinct(users.enabledModules ∪ lesson.unlocks_modules)
```

Then the sidebar shows the new modules on next render.

> ### ⚠ The one thing that must not be got wrong
>
> `enabledModules` is **navigation filtering, not authorisation.** Hiding a
> sidebar item does not stop anyone from typing the URL or calling the API.
> Every route already enforces `requireCap(...)` / `requireAny(...)`, and that
> stays the security boundary.
>
> So induction gating = "don't overwhelm a new joiner with 60 modules on day
> one." It is **not** a way to withhold data from someone who shouldn't see it.
> Use roles/capabilities for that. If we ever want training to be a real
> access control, it needs enforcement in `requireCap`, not in the nav.

### Not breaking existing staff

Turning this on must not strip modules from people already working. Two guards:

1. Only users **created after** the tenant activates a track are auto-enrolled.
2. `enabledModules = null` means "no per-user restriction" (today's behaviour
   for most users, per `layout.tsx:420`). Induction only ever **adds** hrefs;
   it never removes them, and it never converts a `null` into a list for an
   existing user.

Owners bypass all of it (`isOwnerUser`).

---

## 5. Flow 3 — Exam → confirmation letter

```
All required lessons complete
        │
        ▼   status = exam_ready
Start attempt  ──► questions frozen into induction_attempts.questions
        │           (shuffled; correct_keys never sent to the client)
        ▼
Submit ──► graded server-side ──► score_pct
        │
   ┌────┴────┐
 pass       fail
   │          │
   │          └─► attempt_no++ ; retry after cooldown_hours ;
   │              show per-lesson weak areas (questions carry lesson_id) ;
   │              at max_attempts → notify the owner for manual review
   ▼
status = passed
generate letter PDF ──► S3 (letter_key)
mint letter_token (random 32 bytes)
letter_issued_at = now()
notify member + owner
```

### The confirmation letter

Generated with the existing branded PDF stack (`report-header.ts` +
firm branding), containing: firm letterhead, member name, role, track name,
completion date, score, and an owner signature block.

Served at `/induction/letter/[token]` — an unauthenticated, unguessable link so
it can be forwarded to the member's personal email.

**Security notes**, since this is a document about a named person:
- Token is single-purpose and random; it grants read access to *one* letter.
- The page is `noindex` and the link should carry an expiry (suggest 90 days)
  with the option to re-issue.
- Serve the PDF via the existing `SecureLinkButtons` / `lib/secure-download`
  pattern — never put the `/api/...` URL in an `<a href>` (see the project's
  existing rule on this).
- The letter is an internal confirmation of training completion. It should not
  be worded as an employment contract or offer letter unless the firm's own
  counsel approves that wording — that is a legal document, not a CRM artefact.

---

## 6. Surface area

### Member
| Route | Purpose |
|---|---|
| `/dashboard/induction` | My track: ordered lessons, progress ring, locked/unlocked state |
| `/dashboard/induction/[lessonId]` | Player / reader + "Mark complete" |
| `/dashboard/induction/exam` | Take the exam |
| `/dashboard/induction/result` | Score, weak areas, letter link |

### Admin (owner / `induction.manage`)
| Route | Purpose |
|---|---|
| `/dashboard/settings/induction` | Track list, builder (lessons, order, `unlocks_modules` picker fed by `SIDEBAR_REGISTRY`), question bank |
| `/dashboard/induction/team` | Who's enrolled, % complete, attempts, stalled joiners |

### APIs
```
POST   /api/induction/progress            heartbeat + completion
POST   /api/induction/lessons/:id/complete
POST   /api/induction/exam/start
POST   /api/induction/exam/submit
GET    /api/induction/letter/:token       public, token-guarded
CRUD   /api/induction/tracks|lessons|questions   (induction.manage)
```

### RBAC
Two new capabilities in `src/lib/auth/rbac.ts`:
- `induction.view` — every role (it's your own training)
- `induction.manage` — `["compliance", "branch_head"]` + owner bypass

Remember to pass `session.permissions` as the third argument — several existing
routes omitted it and silently ignored custom grants.

---

## 7. Build order

1. **Migration + schema** (6 tables, RLS policies) — nothing user-visible.
2. **Admin track builder** — so real content can be loaded before any joiner sees it.
3. **Member track view + video player + progress** — requirement 1 & 2 without unlocking.
4. **Module unlocking** on lesson completion — requirement 2, the `enabledModules` write.
5. **Exam engine** — question bank, attempts, grading.
6. **Letter PDF + token route** — requirement 3.
7. **Auto-enrolment on invite accept** + the team progress dashboard.

Steps 1–3 are independently useful: a track you can watch is worth shipping
before the exam exists.

---

## 8. Open questions for you

1. **Videos: self-hosted (S3) or YouTube/Vimeo links?** S3 keeps them private
   and costs bandwidth; unlisted YouTube is free and streams better on poor
   connections. The schema supports both — which is the default?
2. **Hard-block the CRM until induction passes, or nudge?** I recommend nudge
   (see §3).
3. **Who signs the letter** — always the owner, or the joiner's reporting
   manager?
4. **Does a failed candidate at max attempts get locked out**, or just flagged
   to the owner? I recommend flagged; auto-lockout of a real employee is a
   people decision, not a software one.
5. **Should induction completion expire** (annual refresher for compliance)?
   Cheap to add now (`valid_until` on the enrolment), expensive to retrofit.
