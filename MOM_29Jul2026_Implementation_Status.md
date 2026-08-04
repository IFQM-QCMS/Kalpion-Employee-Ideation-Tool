# MOM 29 Jul 2026 — Expected vs Implemented

Tracks every action item in `IFQM_EIT_MOM_29Jul2026.docx` against what is now in
the codebase.

**Status as of 4 August 2026.**

Each item carries one of three states, and the distinction matters when reading
the totals:

| State | Meaning |
|---|---|
| ✅ **Done** | Built and verified in response to this MOM |
| ⏸️ **Pre-existing** | Already satisfied before this MOM; no work was needed |
| ❌ **Not started** | No code exists for it yet |
| 🟡 **Partial** | Some of the item is covered; the gap is stated |

**Summary of 75 action items: 11 done · 10 pre-existing · 14 partial ·
40 not started.** The work actioned so far came from §9 (self-registration),
§11 (leaderboard and solution privacy), §12 (on-hold vs inactive) and §14
(mandatory-field marking). The largest untouched blocks are §12–§14, which
together hold most of the remaining console and workflow changes.

---

## 1. Project Handover & Documentation

| # | Expected | State | Notes |
|---|---|---|---|
| 1.1 | Confirm test case count (285 vs 288) | ❌ | The automated suite is 33 HTTP integration tests; the 285/288 figure refers to the manual test-case document. Needs reconciling by whoever owns that sheet. |
| 1.2 | Handover package: source, user manual, technical manual | 🟡 | Source and `docs/USER_GUIDE.md` exist, as do the generated PDFs. No separate technical manual for IFQM. |
| 1.3 | Documentation for project continuity | 🟡 | `README.md`, `docs/DEPLOYMENT.md`, `docs/FREE_DEPLOY.md` and `backend/MIGRATION.md` cover setup and deploy. No single continuity/handover document. |
| 1.4 | Define scope of extended post-deployment support | ❌ | Commercial decision, not a code change. |

## 2. Project Flowchart & Timeline

| # | Expected | State | Notes |
|---|---|---|---|
| 2.1 | Complete flowchart + full project timeline | ❌ | `docs/IFQM_Architecture_Changes.doc` covers architecture, not flow or timeline. |

## 3. Multiple Phases & Future Roadmap

| # | Expected | State | Notes |
|---|---|---|---|
| 3.1 | Document phases completed so far | ❌ | |
| 3.2 | Roadmap: text-to-voice, mobile app, others | ❌ | |
| 3.3 | IFQM takes ownership of sustaining + training | ❌ | Organisational, not code. |

## 4. OTP / Login Testing

| # | Expected | State | Notes |
|---|---|---|---|
| 4.1 | Mock OTP test on login with SMS-tag integration | ❌ | No SMS provider is integrated. Login is password-based; phone numbers are stored and usable as a login identifier, but never as an OTP factor. |
| 4.2 | Developer/test access via OTP | ❌ | |
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
| 7.2 | Disable screenshots and right-click | ❌ | Worth a conversation before building: right-click blocking is trivially bypassed (devtools, view-source, print, phone camera) and mainly annoys legitimate users. The server-side solution redaction in §11.4 is the control that actually holds. |

## 8. API & Data Privacy

| # | Expected | State | Notes |
|---|---|---|---|
| 8.1 | Clarify API key privacy and what the API stores | 🟡 | The QCMS API key is stored per tenant in `org_settings` and never returned to the client. Not written up as a document. |
| 8.2 | Confirm enterprise edition does not leak private info | ❌ | Vendor question. |
| 8.3 | API rate limits: 10,000 total, 2,000/month | ❌ | Per-IP rate limiting exists (global + auth + heavy tiers) but there is no quota accounting per tenant or per month. |
| 8.4 | File upload limit 10 MB, listed under expected benefits | ⏸️ | Enforced via `MAX_FILE_MB=10`, both in multer and in the upload service. Not yet surfaced as a "benefit". |
| 8.5 | Upper limit per organisation + per-file size limit | 🟡 | Per-file limit enforced. No per-tenant storage cap. |
| 8.6 | Evaluate DDoS prevention at tenant level | ❌ | Rate limiting is per-IP, not per-tenant. |

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
| 11.2 | Shareable via social media | ❌ | |
| 11.3 | Compare "All Ideas" view against an "Idea Board" view | ❌ | Both views exist (`/all-ideas`, `/board`); no comparison has been done. |
| 11.4 | Biocon-style: problem, business case, solution as one-line summary; full details hidden until expanded | ✅ | The list endpoint no longer sends any full solution text, and the detail endpoint redacts it unless the viewer is the author, a co-suggester, an assigned or current reviewer, or a manager and above. All Ideas shows a one-line gist with a 🔒 and an explanation. Title, impact, score and status stay public. |

## 12. IFQM Super Admin Login

| # | Expected | State | Notes |
|---|---|---|---|
| 12.1 | Rename "Suspended" to "On-Hold" | ✅ | Renamed across the console (status badge, KPI tile, filter, menu action, toasts). The database enum value is unchanged on purpose — relabelling avoids a data migration and a missed comparison somewhere. |
| 12.2 | Clarify On-Hold vs Inactive | ✅ | Now two independent columns. **Status** = what an operator did (Active / On Hold / Pending). **Activity** = what the org did, derived from a new `tenants.last_login_at`: Inactive at 5+ days without a sign-in, plus a distinct "Never signed in". Reported only — nothing is switched off. |
| 12.3 | Archive option for tickets under Support | ❌ | |
| 12.4 | Nomenclature: "Active Orgs" | ❌ | Currently "Active". |
| 12.5 | Count of ideas sent to QCMS, shown as a total | ❌ | The data exists (`ideas.qcms_pushed_at`, `qcms_push_status`) but is not aggregated to the console. |
| 12.6 | SSO across QCMS, DWM and Skills on a shared database | ❌ | |
| 12.7 | Azure for OAuth | ❌ | |
| 12.8 | "Ideas Implemented" on home page (Orgs → Ideas → Implemented) | 🟡 | `implemented_count` is already computed per tenant by the platform API; it is not yet shown as a drill-down path. |
| 12.9 | Nomenclature: "Organisation Admin" | ❌ | |
| 12.10 | Top-right: "Superadmin signed in as [username]" | 🟡 | The top bar shows the name and a "Platform Admin" chip; not the requested phrasing. |
| 12.11 | Create another superadmin (soft limit 5) | 🟡 | Create/delete platform admins already exists (Platform → Settings). No soft limit of 5. |
| 12.12 | Notifications should display login activity | ❌ | Login attempts are recorded in `ifqm_master.login_attempts` for lockout, but not surfaced as notifications. |
| 12.13 | "i" info button next to SLA and Escalation Days | ❌ | |
| 12.14 | Define an approval-threshold setting | ⏸️ | `approval_threshold` already exists per tenant and is seeded at provisioning. |
| 12.15 | SMTP integration not yet set up | ⏸️ | SMTP is configurable per tenant; it is simply not configured on the deployed instance, so password-reset and notification emails are silent until it is. |

## 13. Organisation Admin Login

| # | Expected | State | Notes |
|---|---|---|---|
| 13.1 | Restrict which sections employees can view (one-line solution) | 🟡 | The restriction is enforced (see 11.4) but it is **not yet configurable** by the Org Admin — the rule is currently fixed in code. |
| 13.2 | Org Admin control over ideas, including archiving old ideas | ❌ | |
| 13.3 | All Ideas: add filter and export to CSV/PDF | 🟡 | Search, status and impact filters exist. No export on this view (Analytics has Excel export; ideas have a per-idea PDF). |
| 13.4 | Bulk import fields: Salutation, First Name, Last Name, Year of Birth only | ❌ | Import currently uses a full name and a full date of birth. |
| 13.5 | Dashboard: Rejected Ideas view | ❌ | Rejected is a filterable status but has no dedicated view. |
| 13.6 | Rate limit 10 MB listed under expected benefits | ⏸️ | Same as 8.4. |
| 13.7 | QCMS API key: user guide only, no key exposure | ⏸️ | The key is write-only in the API — it is never returned to a client. A user guide is still to be written. |
| 13.8 | Hierarchy: typing a user shows their full reporting chain via dropdown | ❌ | |
| 13.9 | User list: filter by Manager, Executive etc. without pulling the whole DB | ❌ | |
| 13.10 | Idea Management: "Patentability" decision option | ❌ | |
| 13.11 | Remove Super Admin from the approval chain | ❌ | |
| 13.12 | Final approval authority: Plant Head (replacing Executive) | ❌ | |
| 13.13 | Show current review stage ("Under review by ___") | 🟡 | The workflow timeline and current reviewer are visible in the idea detail; not phrased as a single status line. |
| 13.14 | Customisable hierarchy per org via Excel template (Year of Birth, not DOB) | ❌ | Bulk import exists; the hierarchy template and the YOB change do not. |

## 14. Employee Login

| # | Expected | State | Notes |
|---|---|---|---|
| 14.1 | Dashboard: Rejected Ideas view | ❌ | Same as 13.5. |
| 14.2 | Export idea to PDF including attachment file names | 🟡 | Per-idea PDF export exists (`ideaPdfService`). Attachment file names in the PDF need confirming. |
| 14.3 | Employees can only view idea title and part of the solution | ✅ | See 11.4. Enforced server-side, so it holds even against a crafted API call. |
| 14.4 | Mark mandatory fields with a red asterisk | ✅ | Title, Present Situation and Proposed Solution in the submit wizard. Previously the asterisk was the same colour and weight as the label, so it read as punctuation. Marked `aria-hidden` since the `required` attribute already announces this to screen readers. |
| 14.5 | Form fields: Situation Title, Description, Solution, Business Case (colour-coded feasibility), Time Required dropdown (<3 / 3–6 / 6–12 months) | 🟡 | Business case fields exist (`investment_required`, `feasibility`, `implementation_duration`, `benefits_expected`, `support_required`). The specific field set, colour coding and fixed dropdown bands do not match the MOM. |
| 14.6 | Solution category tags: Process Improvement, QCD | ❌ | Categories exist per tenant but not these fixed tags. |
| 14.7 | Remove the Idea Template section | ⏸️ | No idea-template section exists in the current UI. |
| 14.8 | Remove "Submit Idea Anonymously" | ❌ | Still present (`is_anonymous`). |
| 14.9 | Capture a timestamp for every idea submitted | ⏸️ | `submitted_at`, `created_at` and `updated_at` are all recorded. |
| 14.10 | Upvote/downvote for all employees; predictions possibly restricted to seniors | ⏸️/❌ | Community voting is open to all employees. The prediction-access restriction is unresolved — the MOM itself says "confirm scope". |
| 14.11 | Team Lead sits within the Employee hierarchy | ⏸️ | `team_lead` is already a role in the hierarchy chain. |

## 15. Infrastructure & Hosting

| # | Expected | State | Notes |
|---|---|---|---|
| 15.1 | Compare Azure, AWS, Hostinger on cost and reliability | 🟡 | No formal comparison. A working zero-cost deployment now exists and is documented in `docs/FREE_DEPLOY.md`: Vercel (frontend) + Render (backend) + Aiven MySQL, with the trade-offs written up — cold starts, ephemeral uploads, 1 GB database. Useful as a baseline to compare paid options against. |

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
