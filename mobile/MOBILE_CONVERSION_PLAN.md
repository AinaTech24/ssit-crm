# Growth OS — Native Mobile Conversion Plan

Derived from a four-track audit of the live codebase (modules/screens, 407 API
routes, auth/roles/permissions/statuses, cross-cutting features). This is the
"before building" plan. **No screens are built until this is approved and the
starting modules are chosen.**

Same backend, same APIs, same auth/token, same RBAC, same business rules. Only
the UI/UX is redesigned — real native screens, not a WebView or a shrunk
website.

---

## 1. Scope reality

- **65 modules / 224 web screens / 407 API routes / 8 roles / ~80 capabilities.**
- Full native parity is a **phased program**, not one build. We ship vertical
  slices (a module end-to-end: list → detail → actions → create → states →
  animations) so each phase is usable and real.
- We reuse the existing Expo foundation (Bearer auth, SecureStore, refresh,
  push, camera bridge) and **replace the WebView** with native navigation +
  screens.

---

## 2. Mobile Information Architecture (the core redesign)

65 modules cannot be a sidebar. Mobile uses **5 stable bottom tabs + a global
search + a contextual create-FAB + a notification center**, with all content
**capability-gated** (a tab/section/action only appears if `can()` allows it).

**Bottom tabs (stable, capability-gated content):**

| Tab | Contains | Primary persona |
|---|---|---|
| **Home** | Today worklist (Command Center queues) + role KPI snapshot + alerts + quick actions | all |
| **Clients** | Investors + Families (search, segments, detail-360) | rm, ops, owner, compliance |
| **Pipeline** | Leads + pipeline board + Activities log | rm, marketing, branch_head |
| **Tasks** | Tasks + Review Meetings + Service Requests (the do-list) | all |
| **More** | Hub to the long tail, grouped + searchable (see §4) | all |

**Global, always-available:**
- **Search** (top of Home + pull-down): cross-module via `GET /api/search?q=`
- **Create FAB** (contextual per tab): new Lead / Task / Activity / Investor / Proposal…
- **Notification center**: bell → `GET /api/notifications`, push deep-links via `data.url`
- **Profile/switcher**: account, settings entry, sign-out

**Role tuning:** tabs stay stable; Home + More reorder by role. e.g. Compliance
Home leads with DDQ/expiry/approvals; Marketing's Pipeline becomes Campaigns;
Owner Home leads with firm KPIs. Restricted-license tenants see only
Billing + Support (mirrors web license gate).

---

## 3. Web → Mobile conversion patterns (rules applied everywhere)

| Web pattern | Mobile pattern |
|---|---|
| Data table (50 rows/page) | **Card list** (FlashList, virtualized) → tap → **detail screen**; infinite scroll via `?page=&limit=` |
| Kanban board (leads/tasks) | Horizontal **swimlane board** + **swipe-to-advance** stage; long-press to move |
| Filter bar + dropdowns | **Filter chips** (quick toggles) + **filter bottom sheet** (full set); sort sheet |
| Search box | Sticky **search field** + recent + cross-module results |
| Multi-field form / new page | **Native form screen**: sectioned, native keyboards, date pickers, dropdown sheets, inline validation, sticky Save bar |
| Bulk select (“select all N”) | **Long-press → multi-select mode** + sticky bulk action bar |
| Row action buttons | **Swipe actions** (left/right) + detail action sheet |
| Detail page w/ tabs | **Detail screen** with segmented tabs (Overview / Activity / Docs / etc.) + sticky primary action |
| Status badge | **Color-coded pill** (mapped per entity status enum) |
| Modal/dialog | **Bottom sheet** (forms, confirms) / full-screen modal (heavy flows) |
| Server-rendered dashboard | **Native Home**: KPI cards + alert list (needs JSON endpoint — see §6) |
| Server-rendered report | **Mobile report screen**: summary cards + grouped list + chart + Share-PDF (needs JSON — see §6) |
| Print / PDF link | **Server PDF → native Share sheet** (`/[id]/pdf`, `/statement/pdf`, etc.) |
| Activity timeline | **Timeline list** + **“Log activity” bottom sheet** (call/visit/note, geo check-in) |
| Toast/inline errors | Toast + inline field errors from **backend validation messages** (unchanged) |

---

## 4. Module → mobile surface map (all 65)

Surface = where it lives. Pattern = primary mobile UI. Access = capability gate.

### Tab: Home
| Module | Mobile surface / pattern | Primary APIs | Access |
|---|---|---|---|
| Command Center | Home “Today” worklist (queues, severity, deep links) | command-center/digest, snooze | dashboard.view.* |
| Role Dashboards (Owner/RM/Ops/Compliance/Marketing cockpits) | Home KPI cards + top-movers | **needs JSON (§6)** | dashboard.view.<role> |
| Next-Best-Action | Home “Suggested actions” cards | /api/nba, ai/* | license-gated |
| Notifications | Bell → center; push deep-links | notifications, mark-read | self |

### Tab: Clients
| Module | Pattern | APIs | Access |
|---|---|---|---|
| Investors | Card list + filters sheet + **360 detail** (Overview/Portfolio/Activity/Docs/Goals/Insurance) + create | investors, [id], bulk, documents, statement/pdf, kyc, gifts, blueprint | investor.view.* / edit.* |
| Families | Card list + family detail (members, wealth band) + statement PDF | families, [id], members, merge, statement/pdf | investor.view.* |
| Referrals | List + detail + create | (referrals routes) | rm/branch_head |
| Duplicates | Merge suggestion cards + resolve sheet | duplicates/ignore, investors/merge | data-admin |

### Tab: Pipeline
| Module | Pattern | APIs | Access |
|---|---|---|---|
| Leads | Card list **and** swimlane board + detail + convert + blueprint advance | leads, [id], stage, convert, blueprint/advance, notes | lead.view.* / edit.* |
| Pipeline Board | Board view of leads | leads (board query) | lead.view.* |
| Activities | Timeline + “Log activity” sheet (call/visit/note + geo) | activities, [id] | rm/ops |
| Discovery | Discovery flow + share link | discovery, share | rm |

### Tab: Tasks
| Module | Pattern | APIs | Access |
|---|---|---|---|
| Tasks | Card list + board + detail + create + complete/swipe + recurrence | tasks, [id], bulk, restore | task.view.* / edit.* |
| Review Meetings | List + schedule sheet + complete-with-outcome (fans out tasks) | review-meetings, bulk, portfolio, ical | review_meeting.* |
| Service Requests | List + detail + status flow + SEBI complaint sub-type | service-requests, bulk | service_request.* / complaint.manage |

### Tab: More — grouped hub (capability-gated)
| Group | Modules → mobile |
|---|---|
| **Investments** | SIPs (+at-risk, defend), SIP Rejections, Equity/DMAT, Transactions, Portfolio Intelligence (drill), Schemes (browse+evaluation), Business Entries |
| **Planning** | Financial Plans, Goals, Risk Profiles, Proposals (+ schemes, send, PDF), Calculators (run + save-to-client + share PDF) |
| **Insurance** | Policies (+renew, protection-gap), Claims (+scorecard), Commission |
| **Communications** | Communications/compose, WhatsApp/email threads, Campaigns (launch/control/recipients), Templates (approve), Segments, Announcements, Calendar |
| **Reports** | Reports hub: catalog → mobile report screens; saved/custom reports run+export+send (**needs JSON, §6**) |
| **Compliance** | Compliance cockpit, AMFI circulars, audit checklist, inspection pack, Complaints disclosure, Legal registrations, SOPs (ack/version), Audit log |
| **Operations** | RTA imports (upload + status), Reconciliation (exceptions resolve), Commission reconciliation, Documents (upload/scan), Duplicates |
| **Finance** | Finances (expenses/P&L/progress), Business expenses/budgets, Billing/receipts, Sub-distributors |
| **Team / HR** | Employees (+org, compliance), Attendance (clock-in, grid, regularizations), Leave applications, Team scorecard/targets, Desks |
| **Automation** | Workflows: recipe library (browse/install/enable), rules list/toggle, run history + retry. *(Full canvas editor = “open on desktop” deep link.)* |
| **Marketing** | Content library (branded PDF, send-bulk), SSIT library, Product offerings, AMC empanelments |
| **Settings** | Profile, Security/2FA, Appearance/theme, Org/firm-profile, Masters, Notification-templates, Onboarding-fields, Integrations (Zoho/WhatsApp/email OAuth), Assignment-rules, Blueprints, Targets, Lead-forms, Desks |
| **Help** | Help/FAQ, Support/feedback, Tech stack, Trash (restore) |

---

## 5. Permission → mobile access rule

- **Reuse `can(roles, capability, permissions)` verbatim** — ship the capability
  matrix to the client (via the `/api/me` endpoint, §6) so the app gates the
  same way the server enforces. Server remains the source of truth (every call
  is still authorized backend-side).
- **Tab/section visibility:** hide a More-group or tab if no child capability passes.
- **Action visibility:** hide/disable create/edit/delete/send/approve buttons by capability (e.g. `proposal.send`, `compliance.approve`, `template.approve`, `settings.users` = owner-only).
- **Field-gating:** respect `isFieldAllowed` / license `allowedFields` (PAN/AUM/SIP/KYC) — mask or omit fields the tenant can’t see.
- **Scope:** list endpoints already scope by RLS + role (assigned vs all); the app just renders what the API returns.
- **License gate:** restricted subscription → app shows only Billing + Support (mirrors web).
- **Session/expiry:** 401/refresh-fail → session-expired screen → re-login; revoked → sign out.

---

## 6. Missing / mobile-needed APIs (honest gaps — never faked)

Most endpoints already exist with search/filter/pagination/upload/export/PDF.
The real gaps are **server-rendered surfaces with no JSON**:

| # | Gap | Why mobile needs it | Recommended endpoint |
|---|---|---|---|
| 1 | **`/api/me`** (capabilities + license + flags) | App must gate tabs/actions/fields the same as server; today capabilities are computed server-side only | `GET /api/me` → `{ user, roles, permissions, capabilities[], license{status,enabledModules,allowedFields}, featureFlags }` |
| 2 | **Role dashboard data JSON** | OwnerCockpit/RmDashboard/etc. are RSC; no JSON to render Home natively | `GET /api/dashboard/home?scope=` → KPI blocks + top-movers (per role) |
| 3 | **Command Center worklist JSON** | Home “Today” needs the categorized queues as data | confirm `command-center/digest` returns full JSON; else `GET /api/command-center` |
| 4 | **Parametric reports JSON** | ~30–50 report pages are RSC-only | generic `GET /api/reports/[key]?<params>` → `{ columns, rows, summary, chart }` mirroring each report |
| 5 | **Cursor pagination (optional)** | Smoother infinite scroll on huge lists than offset | add `?cursor=` alongside existing `?page=` on investors/leads/tasks/transactions |
| 6 | **Notification unread badge sync** | App badge + tab badge | exists (`?unreadOnly=1`); add lightweight `GET /api/notifications/count` if needed |

> Principle: where a response is merely *shaped* awkwardly for mobile, we adapt
> in the app layer. We only add **new** endpoints where data is otherwise
> unreachable (the RSC dashboards/reports) or where gating data (`/api/me`) is
> required. No API contracts change.

---

## 7. Native architecture

**Stack (building on the existing Expo SDK 56 app):**
- **Navigation:** expo-router (file-based) — tabs + nested stacks + modals + shared-element transitions.
- **Data:** TanStack Query (server cache, pagination, optimistic updates, retry) + Zustand (local UI state).
- **API layer:** one typed client (Bearer inject + 401→refresh→retry interceptor, already have refresh), one hook per resource (`useInvestors`, `useLead`, `useTasks`…). Centralized error → app states.
- **Auth:** reuse SecureStore token + `/api/auth/mobile-login|mobile-2fa|refresh`; `/api/me` on boot for capabilities.
- **Forms:** react-hook-form + **reuse the web Zod schemas** (shared validation), native date/select/sheet inputs, backend-error surfacing.
- **Lists:** FlashList virtualization; skeletons; pull-to-refresh; infinite scroll.
- **Design system:** theme tokens (color/space/type/radius/shadow) honoring tenant appearance settings; primitives — Card, ListRow, Badge, Chip, FilterSheet, BottomSheet, FAB, StickyActionBar, Skeleton, EmptyState, ErrorState, Avatar, StatusPill.
- **Motion:** Reanimated 3 + Gesture Handler (swipe), Moti (entrance/exit), expo-haptics, shimmer skeletons, shared-element list→detail. Subtle, fast, professional.
- **Files/media:** native picker + camera (already bridged), S3 upload via existing upload/upload-url routes, PDF via Share sheet.

**Folder structure (`mobile/`):**
```
app/                 expo-router routes (tabs, stacks, modals)
src/
  api/               client.ts, query hooks per resource, types
  components/ui/      design-system primitives
  components/domain/  StatusPill, KpiCard, ActivityItem, ...
  features/<module>/  screens for each module
  state/             zustand stores
  theme/             tokens, ThemeProvider
  lib/               auth, capabilities (can()), formatters, validation (shared zod)
  navigation/        tab config, role-aware menu
```

**Production app states (every screen):** loading · skeleton · empty · search-empty ·
validation-error · API-error · permission-denied · network-error · timeout · retry ·
success · offline · syncing · session-expired · unauthorized. Built as shared components.

---

## 8. Phased build sequence

| Phase | Scope | Outcome |
|---|---|---|
| **A. Foundation** | expo-router app shell, design system, API client + Query, auth reuse + `/api/me`, app-state components, theme, navigation skeleton. Backend: add `/api/me` (+ dashboard/reports JSON when their phases arrive). | Runnable shell, login → empty tabs, capability gating live |
| **B. Daily core (P0)** | **Home** (Command Center), **Clients** (investor list+360+activity+docs+create), **Pipeline** (leads list+board+detail+convert), **Tasks** (list+detail+create+complete) | ~80% of daily RM/owner usage, fully native |
| **C. Engagement (P1)** | Review Meetings, Service Requests, Communications/compose, Notification center, global Search, Activities, Calendar | Client-servicing loop complete |
| **D. Domain (P2)** | Insurance, SIPs/rejections, Equity, Financial Plans/Goals, Proposals, Families deep, Campaigns/Templates | Product breadth |
| **E. Management/admin (P3)** | Reports hub + dashboards (JSON), Compliance, Finances, HR (attendance/leave/employees/team), Workflows (browse/enable/runs), Settings | Owner/compliance/ops/HR complete |
| **F. Polish** | Animation pass, perf/virtualization tuning, offline/caching, full app-state coverage, accessibility, store build | Production-ready |

Recommended start: **Phase A + Phase B**, plus the **`/api/me`** endpoint.

---

## 9. Decisions needed before building
1. Approve the **5-tab IA** (Home · Clients · Pipeline · Tasks · More) or adjust.
2. Confirm **Phase A + B** as the starting scope (or pick different P0 modules).
3. Approve adding the **`/api/me`** endpoint (and later the dashboard/report JSON endpoints) — additive, no contract changes.
4. Confirm the local **dev DB + demo login** (already set up) as the build/test environment.
