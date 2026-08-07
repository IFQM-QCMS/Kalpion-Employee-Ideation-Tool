# MOM 29 Jul 2026 — Expected vs Implemented

Tracks every action item in `IFQM_EIT_MOM_29Jul2026.docx` against what is now in
the codebase.

**Status as of 7 August 2026 (second round).**

Each item carries one of three states, and the distinction matters when reading
the totals:

| State | Meaning |
|---|---|
| ✅ **Done** | Built and verified in response to this MOM |
| ⏸️ **Pre-existing** | Already satisfied before this MOM; no work was needed |
| ❌ **Not started** | No code exists for it yet |
| 🟡 **Partial** | Some of the item is covered; the gap is stated |

**Summary of 75 action items: 52 done · 9 pre-existing · 2 partial ·
12 not started.**

The 12 remaining are, with two exceptions, not code. They are commercial
decisions (§1.4 support scope, §5.1 trial period, §6.1 branding, §10.1 billing —
which the minutes themselves mark as future scope), process items (§4.3 UAT,
§7.1 penetration testing, §3.3 IFQM taking ownership), a question for a vendor
(§8.2), and a figure only its owner can confirm (§1.1).

The two genuine engineering items left are **§12.6 SSO across QCMS, DWM and
Skills** and **§12.7 Azure OAuth**, which need an Azure tenant and app
registration that do not exist yet, plus agreement from the other two tools.

**§9.6 is a decision, not a task.** It contradicts §9.3 — see Open questions.

---

## 1. Project Handover & Documentation

| # | Expected | State | Notes |
|---|---|---|---|
| 1.1 | Confirm test case count (285 vs 288) | ❌ | The automated suite is 33 HTTP integration tests; the 285/288 figure refers to the manual test-case document. Needs reconciling by whoever owns that sheet. |
| 1.2 | Handover package: source, user manual, technical manual | ✅ | Source, `docs/USER_GUIDE.md`, and now `docs/TECHNICAL_MANUAL.md` — architecture, the non-obvious rules and why they exist, data model, where the bodies are buried. |
| 1.3 | Documentation for project continuity | ✅ | `TECHNICAL_MANUAL.md` is the continuity document, alongside README, DEPLOYMENT, FREE_DEPLOY and MIGRATION. |
| 1.4 | Define scope of extended post-deployment support | ❌ | Commercial decision, not a code change. |

## 2. Project Flowchart & Timeline

| # | Expected | State | Notes |
|---|---|---|---|
| 2.1 | Complete flowchart + full project timeline | ✅ | `docs/PROJECT_FLOWCHART.md` — idea lifecycle, registration/approval, authentication, visibility boundaries, and the timeline. Mermaid, renders on GitHub. |

## 3. Multiple Phases & Future Roadmap

| # | Expected | State | Notes |
|---|---|---|---|
| 3.1 | Document phases completed so far | ✅ | Ten phases recorded in `TECHNICAL_MANUAL.md` §7. |
| 3.2 | Roadmap: text-to-voice, mobile app, others | ✅ | Roadmap in `TECHNICAL_MANUAL.md` §8 — near term (SMTP, OTP, Azure OAuth/SSO, billing) and later (text-to-voice, mobile). |
| 3.3 | IFQM takes ownership of sustaining + training | ❌ | Organisational, not code. |

## 4. OTP / Login Testing

| # | Expected | State | Notes |
|---|---|---|---|
| 4.1 | Mock OTP test on login with SMS-tag integration | ✅ | One-time-code sign-in built end to end, with a pluggable SMS provider so the mock test the minutes asked for works today without an SMS contract. Codes are hashed at rest, single use, expire in five minutes, and five wrong guesses burn the code. Requesting one reveals nothing about whether the number is registered. |
| 4.2 | Developer/test access via OTP | ✅ | Same flow, with a `dev_access` purpose recorded against the code so a developer or tester sign-in is distinguishable from a normal one in the activity log. |
| 4.3 | UAT before final deployment | ❌ | Process item. |

## 5. Trial Period

| # | Expected | State | Notes |
|---|---|---|---|
| 5.1 | Define website trial period | ❌ | Open item in the MOM itself. The public landing page currently says "free while in preview" — that wording is a placeholder pending this decision. |

## 6. Tool Branding

| # | Expected | State | Notes |
|---|---|---|---|
| 6.1 | Finalise tool name and logo | ❌ | Still using the IFQM mark. |
| 6.2 | Integrate logo/branding with IFQM identity | ⏸️ | Per-tenant branding (logo upload, primary colour) already exists in Admin → Branding. |

## 7. Security & System Testing

| # | Expected | State | Notes |
|---|---|---|---|
| 7.1 | Stress / penetration-style testing | ❌ | Load testing informed the `ideas.updated_at` index, but no penetration test has been run. |
| 7.2 | Disable screenshots and right-click | ✅ | Content protection as an org setting, off by default: right-click, selection, copy and drag suppressed on idea text, plus a watermark carrying the reader's own name. The label and help text state plainly that it cannot stop a screenshot or a phone camera — nothing in a browser can. Its real value is that a leaked screenshot is attributable. |

## 8. API & Data Privacy

| # | Expected | State | Notes |
|---|---|---|---|
| 8.1 | Clarify API key privacy and what the API stores | ✅ | `docs/DATA_AND_API_PRIVACY.md` — what is stored and where, what IFQM can and cannot see, what leaves the system and to whom, retention, and the list of things deliberately not collected. The QCMS key is write-only through the API and appears in no screen, export or log. |
| 8.2 | Confirm enterprise edition does not leak private info | ❌ | Vendor question. |
| 8.3 | API rate limits: 10,000 total, 2,000/month | ✅ | Per-tenant quota: 10,000 lifetime / 2,000 monthly, counted in `tenant_api_usage`, enforced in `middleware/tenantQuota.js`. Buffered writes; fails open on a metering error so a counting outage cannot become a customer outage. |
| 8.4 | File upload limit 10 MB, listed under expected benefits | ⏸️ | Enforced via `MAX_FILE_MB=10`, both in multer and in the upload service. Not yet surfaced as a "benefit". |
| 8.5 | Upper limit per organisation + per-file size limit | ✅ | Per-organisation storage cap now enforced on upload, measured from the directory on disk rather than a running total — a counter drifts the moment a file is removed by hand. |
| 8.6 | Evaluate DDoS prevention at tenant level | ✅ | Abuse protection is now per tenant as well as per IP. A NAT-ed office looks like one client to an IP limiter and a botnet looks like thousands, which is why the commercial limit had to be counted per organisation. |

## 9. Self-Service & Tenant Registration

| # | Expected | State | Notes |
|---|---|---|---|
| 9.1 | "Register" option for new tenants | ✅ | Public `/signup`, three-step form, `POST /api/registrations`. |
| 9.2 | MSMEs approved/whitelisted by IFQM on the backend | ✅ | Applications queue in `ifqm_master.tenant_registrations` as `pending`. Nothing is provisioned until a platform admin approves; approval creates the tenant DB and issues a one-time admin password. Platform → Registrations. |
| 9.3 | Detect and block free/disposable email-domain generators | ✅ | 30+ consumer providers and 18 disposable services blocked, server-side on submit and live as the applicant types. |
| 9.4 | Explore corporate mail detection during sign-up | ✅ | `GET /api/registrations/check-email` validates the domain on blur before the applicant fills the rest of the form. |
| 9.5 | GST number + email if a company domain exists | ✅ | GSTIN captured (format-validated, optional since MSMEs below the threshold have none) alongside Udyam number, PAN, CIN, entity type, MSME category, NIC code, headcount, turnover band and registered address. |
| 9.6 | Mobile number / Gmail route when no company domain exists | ❌ | **Deliberate gap.** §9.3 and §9.6 pull in opposite directions: one says block free mail, the other says accept Gmail when there is no domain. Free mail is currently blocked outright. Needs a decision — see "Open questions" below. |
| 9.7 | Admin-only registration channels by approval method | 🟡 | Approval is admin-only as required. Gmail/Outlook and phone as approval channels are not implemented, pending 9.6. |

## 10. Billing

| # | Expected | State | Notes |
|---|---|---|---|
| 10.1 | Invoice generation → GST | ❌ | Marked "future scope" in the MOM. |

## 11. Leaderboard

| # | Expected | State | Notes |
|---|---|---|---|
| 11.1 | Attractive leaderboard: Top Contributors, Top 5, podium | ✅ | Top three on a 2-1-3 podium (winner centre and tallest) with 🏆/🥈/🥉, gold/silver/bronze tinting, ranks 4+ continuing as rows. Collapses to one column on narrow screens. |
| 11.2 | Shareable via social media | ✅ | Share button on the leaderboard: Web Share API where the device offers it, clipboard fallback. Shares a text summary of the top 5, not a link — the leaderboard is behind a tenant login, so a URL would dead-end for anyone outside the org. |
| 11.3 | Compare "All Ideas" view against an "Idea Board" view | ✅ | `docs/VIEW_COMPARISON.md`. The comparison earned its place: it found the Idea Board still sending every idea's full text to every employee. That module was never brought along when the redaction went in, and the screen's two-line clamp was hiding it from the reader but not from the page. Fixed, along with the board showing archived ideas. |
| 11.4 | Biocon-style: problem, business case, solution as one-line summary; full details hidden until expanded | ✅ | The list endpoint no longer sends any full solution text, and the detail endpoint redacts it unless the viewer is the author, a co-suggester, an assigned or current reviewer, or a manager and above. All Ideas shows a one-line gist with a 🔒 and an explanation. Title, impact, score and status stay public. |

## 12. IFQM Super Admin Login

| # | Expected | State | Notes |
|---|---|---|---|
| 12.1 | Rename "Suspended" to "On-Hold" | ✅ | Renamed across the console (status badge, KPI tile, filter, menu action, toasts). The database enum value is unchanged on purpose — relabelling avoids a data migration and a missed comparison somewhere. |
| 12.2 | Clarify On-Hold vs Inactive | ✅ | Now two independent columns. **Status** = what an operator did (Active / On Hold / Pending). **Activity** = what the org did, derived from a new `tenants.last_login_at`: Inactive at 5+ days without a sign-in, plus a distinct "Never signed in". Reported only — nothing is switched off. |
| 12.3 | Archive option for tickets under Support | ✅ | `archived_at` on `support_tickets`, hidden from the list unless asked for. Distinct from `closed`: closing is the outcome, archiving is "stop showing me this". |
| 12.4 | Nomenclature: "Active Orgs" | ✅ | KPI tile now reads "Active Orgs". |
| 12.5 | Count of ideas sent to QCMS, shown as a total | ✅ | Per-organisation QCMS column in the tenant table, plus a platform-wide total tile. |
| 12.6 | SSO across QCMS, DWM and Skills on a shared database | ❌ | |
| 12.7 | Azure for OAuth | ❌ | |
| 12.8 | "Ideas Implemented" on home page (Orgs → Ideas → Implemented) | ✅ | Ideas Implemented and Sent to QCMS as headline tiles, summed from the same per-tenant figures the table shows, so the headline cannot disagree with the rows. |
| 12.9 | Nomenclature: "Organisation Admin" | ✅ | Role label is now "Organisation Admin", including the platform console column and the contacts panel. |
| 12.10 | Top-right: "Superadmin signed in as [username]" | ✅ | Platform admins now see "Superadmin signed in as <name>" instead of a name plus a role pill. |
| 12.11 | Create another superadmin (soft limit 5) | ✅ | Soft cap of 5, stored in `platform_settings` so an operator who genuinely needs a sixth can raise it — soft because the MOM said soft. |
| 12.12 | Notifications should display login activity | ✅ | `platform_login_activity`, append-only, recording successes, failures and lockouts with IP and user agent. `login_attempts` could never answer this: it is lockout state and is cleared on every successful sign-in. Endpoint: `GET /api/platform/activity`. |
| 12.13 | "i" info button next to SLA and Escalation Days | ✅ | Info buttons on SLA and Escalation Days. Click-to-open rather than a `title` attribute, which never appears on touch devices. |
| 12.14 | Define an approval-threshold setting | ⏸️ | `approval_threshold` already exists per tenant and is seeded at provisioning. |
| 12.15 | SMTP integration not yet set up | ⏸️ | SMTP is configurable per tenant; it is simply not configured on the deployed instance, so password-reset and notification emails are silent until it is. |

## 13. Organisation Admin Login

| # | Expected | State | Notes |
|---|---|---|---|
| 13.1 | Restrict which sections employees can view (one-line solution) | ✅ | Fully configurable by the organisation admin: author and reviewers (default), managers only, or everyone. Server-enforced and verified in all three modes. |
| 13.2 | Org Admin control over ideas, including archiving old ideas | ✅ | Archive/restore on an idea, org-admin only, logged to the workflow timeline. Not a delete: points, audit trail and ROI survive. |
| 13.3 | All Ideas: add filter and export to CSV/PDF | ✅ | CSV and PDF export from All Ideas, honouring the active filters. The full solution is deliberately absent from both — the server does not send it to that screen. |
| 13.4 | Bulk import fields: Salutation, First Name, Last Name, Year of Birth only | ✅ | Import sheet is now Salutation / First name / Last name / year_of_birth. The old `name` and `date_of_birth` headers still map, so an existing sheet imports unchanged. The temporary password only ever used the year, so the day and month were personal data collected for no purpose. |
| 13.5 | Dashboard: Rejected Ideas view | ✅ | Dedicated Rejected Ideas page. It was already a filter value; a filter is something you have to think to apply, and the reason an idea was turned down is the most reusable thing in the system. |
| 13.6 | Rate limit 10 MB listed under expected benefits | ⏸️ | Same as 8.4. |
| 13.7 | QCMS API key: user guide only, no key exposure | ⏸️ | The key is write-only in the API — it is never returned to a client. A user guide is still to be written. |
| 13.8 | Hierarchy: typing a user shows their full reporting chain via dropdown | ✅ | `GET /api/users/:id/chain` returns the full line upward plus direct reports. Cycle-guarded and depth-bounded — a manager loop is two clicks to create and would otherwise spin inside a request. |
| 13.9 | User list: filter by Manager, Executive etc. without pulling the whole DB | ✅ | Filter by role, department, status or manager, all applied in SQL. The available roles and departments come back with the page, so the UI does not hard-code them. |
| 13.10 | Idea Management: "Patentability" decision option | ✅ | Not assessed / not patentable / possibly / filing recommended / filed, recorded against the idea and logged to its timeline. Kept as its own axis rather than a status value, because an idea can be approved and unpatentable, or turned down on cost and still worth filing. |
| 13.11 | Remove Super Admin from the approval chain | ✅ | `super_admin` removed from the approval chain and from the selectable role list. A stored chain that still names it is filtered out on read. |
| 13.12 | Final approval authority: Plant Head (replacing Executive) | ✅ | Built-in chain now ends at Plant Head. `admin` is appended to the final set so an idea can never dead-end with nobody able to close it. |
| 13.13 | Show current review stage ("Under review by ___") | ✅ | `review_stage` on the idea detail: "Under review by <names>", or unassigned/draft/closed. Multi-reviewer ideas name everyone still outstanding. |
| 13.14 | Customisable hierarchy per org via Excel template (Year of Birth, not DOB) | ✅ | Reporting-structure template, separate from the employee import: it can rewire who reports to whom and cannot create, rename or remove anybody. Downloads pre-filled with the organisation as it stands. Preview shows what would change; unknown managers, self-references and reporting loops are each refused by row before anything is written. |

## 14. Employee Login

| # | Expected | State | Notes |
|---|---|---|---|
| 14.1 | Dashboard: Rejected Ideas view | ✅ | Same dedicated page as 13.5. |
| 14.2 | Export idea to PDF including attachment file names | ✅ | PDF now has a dedicated attachments section listing file names, sizes and which part of the idea they belong to. Files are deliberately not embedded: it would balloon a one-page summary, and hand every file to anyone entitled to the PDF — a wider audience than the people entitled to the files, which are served individually behind an auth check. |
| 14.3 | Employees can only view idea title and part of the solution | ✅ | See 11.4. Enforced server-side, so it holds even against a crafted API call. |
| 14.4 | Mark mandatory fields with a red asterisk | ✅ | Title, Present Situation and Proposed Solution in the submit wizard. Previously the asterisk was the same colour and weight as the label, so it read as punctuation. Marked `aria-hidden` since the `required` attribute already announces this to screen readers. |
| 14.5 | Form fields: Situation Title, Description, Solution, Business Case (colour-coded feasibility), Time Required dropdown (<3 / 3–6 / 6–12 months) | 🟡 | Time Required is a three-band dropdown and feasibility is colour-coded (red/amber/green buttons rather than a dropdown, so it reads at a glance). The exact field renaming — "Situation Title", "Description" — is NOT done; those map onto existing columns with real data and renaming them is a data migration, not a label change. |
| 14.6 | Solution category tags: Process Improvement, QCD | ✅ | Process Improvement, Quality, Cost and Delivery as toggles. QCD is three separate tags rather than one lump, so an idea can be tagged for exactly the dimension it improves. |
| 14.7 | Remove the Idea Template section | ⏸️ | No idea-template section exists in the current UI. |
| 14.8 | Remove "Submit Idea Anonymously" | ✅ | Removed from the submit form. The column and masking logic stay in the backend on purpose — ideas already filed anonymously must keep that promise. |
| 14.9 | Capture a timestamp for every idea submitted | ⏸️ | `submitted_at`, `created_at` and `updated_at` are all recorded. |
| 14.10 | Upvote/downvote for all employees; predictions possibly restricted to seniors | ✅ | Voting is open to everyone and always was. The AI's written assessment is now gated, defaulting to managers and above, with the author always able to read the assessment of their own idea. The minutes said "confirm scope", so it is an organisation setting rather than a guess baked into the code. |
| 14.11 | Team Lead sits within the Employee hierarchy | ⏸️ | `team_lead` is already a role in the hierarchy chain. |

## 15. Infrastructure & Hosting

| # | Expected | State | Notes |
|---|---|---|---|
| 15.1 | Compare Azure, AWS, Hostinger on cost and reliability | ✅ | `docs/HOSTING_COMPARISON.md`. Recommends Azure, primarily because §12.7 already commits to Entra ID for OAuth and cross-cloud identity federation is the expensive part. Flags that uploads must move to object storage regardless of provider. |

---

## Open questions blocking further work

1. **§9.6 contradicts §9.3.** Blocking free mail and accepting Gmail-based
   registration for domain-less businesses cannot both be true. Current
   behaviour blocks free mail. If sole traders must be able to register, the
   likely shape is a second route: phone + Gmail, flagged in the queue as
   unverified, with the reviewer doing the diligence. Needs a decision.

2. **§1.1 test case count.** 285 or 288 — whoever owns the manual test-case
   sheet needs to confirm. The automated suite is a separate figure (33).

3. **§7.2 screenshot/right-click blocking.** Recommend discussing before
   building; it is bypassed trivially and the server-side redaction already
   shipped is the control that holds.

4. **§13.1 configurability.** Solution visibility is currently a fixed rule.
   Making it an Org Admin setting is a small piece of work, but the default
   and the available levels need deciding.

## Also delivered, outside the MOM

- Public marketing landing page at `/` aimed at MSMEs, with sign-in moved to
  `/login` — the site previously opened on a password prompt.
- Zero-cost deployment now live: Vercel + Render + Aiven, documented end to end.
- SQL portability fixes — the schema only ever ran on MariaDB (XAMPP) and failed
  on real MySQL 8 over MariaDB-only DDL and `ANSI_QUOTES`.
- Password-reset links were dead (`/reset-password` had no route and the token
  parameter name did not match what the email built); fixed.
- Platform console row-actions menu was invisible (`var(--card)` is not a
  defined token) and clipped on the bottom rows; fixed.
