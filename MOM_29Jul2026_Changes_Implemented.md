# MOM 29 Jul 2026 — Changes Implemented

What was actually built in response to the 29 July review meeting, in the order
someone would want to read it.

**As of 7 August 2026.** Live on production (Vercel + Render + Aiven).

For the item-by-item audit of all 75 action points — including what was *not*
done and why — see `MOM_29Jul2026_Implementation_Status.md`. This document is
the narrative version: what changed, and what it means for the people using it.

| | |
|---|---|
| MOM items completed | **41 of 75** (was 11 before this round) |
| Already satisfied | 10 |
| Partial, gap stated | 5 |
| Not started | 19 — mostly commercial decisions, process items and one contradiction in the minutes |
| Database migrations | 009, 010 (master + tenant) |
| Backend files touched | 19 |
| Frontend files touched | 14 |
| New documents | 5 |

---

## 1. MSME self-registration  · §9

**Before:** an organisation could only exist if an IFQM admin typed it into the
console.

**Now:** a business applies for itself at `/signup`, and a platform admin
approves it.

- Three-step form. Company and applicant first, business details second,
  address and confirmation third — so a rejected work-email is caught before
  anyone has typed a GST number they would have to retype.
- **Field set follows the Udyam certificate**, so applicants transcribe a
  document rather than hunt for answers: Udyam number, PAN, optional GSTIN, CIN,
  entity type, micro/small/medium category, NIC activity code, headcount,
  turnover band, year established, registered address.
- **Aadhaar, bank details and document scans are deliberately not collected.**
  Udyam itself needs them; an ideation tool does not, and holding them would
  make this table a target for no product benefit.
- GSTIN is optional because MSMEs below the threshold genuinely do not have one.
  Rejecting a form over a field the applicant cannot fill is a bug, not
  diligence.
- **Corporate domains only.** 30+ consumer providers and 18 disposable-mail
  services are blocked, checked live as the applicant types and again on submit.
- **Nothing self-serve provisions anything.** Applications sit in a queue as
  `pending`. Approval is what creates the database and the first admin account,
  with a one-time password shown once for the operator to relay.

**Where to look:** Platform → Registrations. Every submitted field is on show,
grouped as the applicant entered it, with the decision controls beside the
evidence.

> **One thing needs your decision.** §9.3 says block free email domains; §9.6
> says accept Gmail when a business has no domain. Both cannot be true. Free
> mail is currently blocked, so a sole trader without a company domain cannot
> register today.

---

## 2. Ideas stopped leaking · §11.4, §13.1, §14.3

**The problem:** the idea list ran `SELECT i.*`, so every browser received the
full text of every proposed solution, and opening one showed it verbatim to any
colleague. The solution is the intellectual contribution — publishing it on
filing lets anyone restate it as their own before the original is even reviewed.

**Now:**

- The list endpoint **never sends a full solution to anyone.** It sends a
  one-line summary and a flag.
- The detail endpoint redacts unless you are the author, a co-suggester, an
  assigned or current reviewer, or a manager and above.
- All Ideas shows the gist with a 🔒 and an explanation of why it is short.
- **The org admin now chooses the rule** (§13.1): author + reviewers (default),
  managers only, or everyone.

Title, category, score and status stay public in every mode, so the pipeline is
still transparent — only the "how" is held back. Enforced server-side, so it
holds against a crafted API call rather than being a UI restriction.

---

## 3. Approval chain · §13.11, §13.12, §13.13

- **Super Admin removed as an approver, everywhere.** Whoever holds an
  organisation's super-admin credentials is usually IT, not the person qualified
  to accept a shop-floor improvement.
- **Final authority is now Plant Head**, replacing Executive. The org admin
  stays in the final set so an idea can never dead-end with nobody able to close
  it.
- **"Under review by ___"** now appears on the idea itself as one readable line,
  instead of leaving the reader to reconstruct it from the timeline. Committee
  reviews name everyone still outstanding.

---

## 4. Leaderboard · §11.1, §11.2

Top three on a podium, ordered 2–1–3 so the winner stands centre and tallest,
with 🏆 🥈 🥉 and gold/silver/bronze. Ranks 4+ continue as rows. On a phone it
collapses to one column — three narrow columns turn names into ellipses.

A **Share** button copies a text summary of the top five (or opens the phone's
share sheet). Deliberately not a link: the leaderboard is behind a tenant login,
so a URL would dead-end for anyone outside the organisation.

---

## 5. On Hold vs Inactive · §12.1, §12.2

These were one badge and are two different questions.

| | Means | Set by |
|---|---|---|
| **Status** | Active / On Hold / Pending | An operator, deliberately |
| **Activity** | Active / Inactive / Never signed in | Derived from sign-ins |

"Suspended" now reads **On Hold** everywhere a human sees it. "Inactive" means
no sign-in for 5+ days and **carries no consequence** — nothing is switched off,
nobody is emailed, and the organisation can still sign in normally. It exists so
a quiet account gets noticed before renewal.

A distinct **"Never signed in"** flags a provisioned organisation nobody ever
logged into, which usually means a failed handover.

---

## 6. Idea submission · §14.4, §14.5, §14.6, §14.8

- **Red asterisks** on mandatory fields. They were previously the same colour
  and weight as the label, so they read as punctuation rather than an
  instruction.
- **Time Required** as three fixed bands (<3 months, 3–6, 6–12), so estimates
  are comparable across ideas instead of being free text.
- **Feasibility is colour-coded** — red/amber/green buttons rather than a
  dropdown, because a dropdown hides the very thing that makes it scannable.
- **Solution category tags:** Process Improvement, Quality, Cost, Delivery. QCD
  is three separate tags rather than one lump, so an idea can be tagged for
  exactly the dimension it improves.
- **Anonymous submission removed** from the form. The column and masking logic
  stay in the backend on purpose: ideas already filed anonymously must keep that
  promise, and stripping the feature retroactively would expose their authors.

---

## 7. Archiving and patentability · §12.3, §13.2, §13.10

**Archiving is not deleting.** An archived idea keeps its points, its approval
history and its recorded savings — it just leaves the working lists. Reversible,
logged, org-admin only. Support tickets can be archived too, which is distinct
from closing: closing is the outcome of the conversation, archiving is "stop
showing me this".

**Patentability** is its own axis, not a status value: Not assessed / Not
patentable / Possibly / Filing recommended / Filed. An idea can be approved and
unpatentable, or turned down on cost and still worth a provisional filing —
folding it into the status enum would lose exactly those cases.

---

## 8. Rejected ideas get a screen · §13.5, §14.1

Rejected was already a filter value, which is not the same thing: a filter is
something you have to think to apply, and nobody browsing their pipeline thinks
"let me go and read the failures". The reason an idea was turned down is the
most reusable thing in the system — re-filing a near-identical idea six months
later is the waste this prevents.

---

## 9. Exports · §13.3

CSV and PDF from All Ideas, honouring whatever filters are active. The PDF route
uses the browser's own print-to-PDF, so you get your platform's real save
dialogue and no PDF library is shipped to every visitor.

The full solution text is deliberately absent from both — the server does not
send it to that screen, so an export appearing to contain it would either be
empty or a privacy hole depending on who clicked.

---

## 10. Platform console · §12.4, §12.5, §12.8, §12.10, §12.11, §12.12, §12.13

- **"Active Orgs"** (§12.4) and **"Superadmin signed in as \<name\>"** (§12.10).
- **Ideas Implemented** and **Sent to QCMS** as headline tiles (§12.5, §12.8),
  summed from the same per-tenant figures the table shows, so the headline can
  never disagree with the rows beneath it. Per-organisation QCMS column too.
- **Platform admins soft-capped at 5** (§12.11), stored as a setting rather than
  a constant — the MOM said soft, and every one of these accounts can reach
  every customer organisation.
- **Sign-in activity feed** (§12.12): a new append-only record of successes,
  failures and lockouts with IP and device. The existing `login_attempts` table
  could never answer this — it is lockout state and is wiped on every successful
  sign-in.
- **Info buttons** (§12.13) — see §13 below, where this grew considerably.

---

## 11. Users and bulk import · §13.4, §13.8, §13.9

- **Import sheet is now Salutation / First name / Last name / Year of birth.**
  The temporary first-login password only ever used the year, so the day and
  month were personal data collected for no purpose. Old sheets still import —
  the previous `name` and `date_of_birth` headers are kept as aliases.
- **Filter users** by role, department, status or manager, applied in SQL. The
  console never pulls the whole user table into the browser to narrow it.
- **Reporting line** (§13.8): one call returns a person's managers all the way
  up, plus their direct reports. Cycle-guarded — a manager loop is two clicks to
  create and would otherwise spin inside a request.

---

## 12. Per-tenant API quotas · §8.3, §8.5, §8.6

10,000 requests lifetime and 2,000 per month, counted **per organisation**
rather than per IP. That distinction is the whole point: an office behind one
NAT gateway looks like a single client to an IP limiter, while a botnet looks
like thousands — neither matches the number the MOM specifies.

Both limits are overridable per organisation. Counting is buffered rather than
written on every request, and enforcement **fails open**: a metering outage must
not become a customer outage.

---

## 13. Plain-language help throughout the app

Not a numbered MOM item beyond §12.13, but the same problem at a larger scale.

Most of this product's settings are named in the vocabulary of the people who
built it — SLA, escalation, threshold, engagement index, slug, feature flag. An
org admin at a 40-person workshop is not obliged to know any of those, and a
field whose meaning has to be guessed gets set wrong or left alone.

**A small "i" now sits beside 58 such terms**, explaining each in plain English:
what the setting does, what happens if it is wrong, and a concrete number or
example where one helps.

It opens on **hover** for a mouse user, on **tap** for a phone (hover does not
exist on touch, so a hover-only tooltip is invisible to every phone user), and
on **keyboard focus**. Clicking pins it open so a long explanation cannot vanish
because the pointer drifted.

Covered: Review SLA and Escalation Days · workflow mode, approval chain,
reviewer and final roles, approval threshold, chain preview, reporting structure
· solution visibility · every feature flag · all SMTP fields · AI score,
community score, engagement index, impact level, feasibility, time required,
solution tags, tangible/intangible benefit, ROI, patentability · draft, archived,
review stage, co-suggesters · org code, default org, On Hold, activity state,
API quota, QCMS pushed, admin limit, registration queue · Udyam, GSTIN, NIC code
· employee ID, bulk import, year of birth, reporting line, QCMS API key.

---

## 14. Documentation · §1.2, §1.3, §2.1, §3.1, §3.2, §13.7, §15.1

| Document | Contents |
|---|---|
| `docs/TECHNICAL_MANUAL.md` | For whoever inherits the code: architecture, the non-obvious rules and *why* each exists, data model, ten completed phases, roadmap, QCMS key operator guide, and a "where the bodies are buried" table |
| `docs/PROJECT_FLOWCHART.md` | Four Mermaid flows — idea lifecycle, registration/approval, authentication, visibility boundaries — plus the project timeline |
| `docs/HOSTING_COMPARISON.md` | Azure vs AWS vs Hostinger, with a recommendation and the reasoning |
| `MOM_29Jul2026_Implementation_Status.md` | Item-by-item audit of all 75 points |
| This file | Narrative summary |

**Hosting recommendation: Azure** — not on cost, but because §12.7 already
commits to Entra ID for OAuth and §12.6 asks for SSO across QCMS, DWM and
Skills. Cross-cloud identity federation is the expensive part, and the price gap
at this scale is smaller than the engineering time it would consume.

That document also flags something that needs doing regardless of provider:
**uploads live on local disk.** That is fine on one always-on server and quietly
wrong the moment there is a second instance or a recycled filesystem —
attachments vanish while their database rows survive. It is already a live
limitation on the current free-tier deployment.

---

## What is deliberately not done

Four things where building the obvious thing would have been wrong:

1. **§9.6 — Gmail registration for domain-less businesses.** Contradicts §9.3.
   Needs your decision, not a guess.
2. **§7.2 — disabling right-click and screenshots.** Bypassed by devtools,
   view-source, print or a phone camera, and it mainly annoys legitimate users.
   The server-side redaction in §2 above is the control that actually holds,
   because the text is never sent.
3. **§14.5 field renaming** to "Situation Title" and "Description". Those map
   onto columns holding real data — a data migration, not a label change.
4. **§1.1 test-case count.** The minutes say both 285 and 288; neither matches
   the automated suite (33 integration tests). That figure belongs to the manual
   test-case sheet and needs its owner to confirm.

---

## Verification

Everything above was checked, not assumed:

- 33/33 backend integration tests pass
- Frontend builds clean
- Migrations are idempotent — re-running applies nothing
- Schema and every tenant migration apply **twice under `sql_mode=ANSI`**, which
  is the MySQL-8 strictness that broke the first cloud deployment
- Solution redaction exercised across all three visibility modes and both role
  paths, against a real database
- Quota counting and rejection verified (3 requests → counted 3; over-limit →
  429). **Two bugs were caught this way**: the meter was mounted where the
  tenant was not yet known and would have counted nothing forever, and a stale
  cache let usage under-report for a full minute
- Registration endpoints exercised end to end: free-mail, disposable, malformed
  GSTIN and missing consent all rejected; corporate accepted; duplicate
  collapsed; queue requires auth; approval provisions; double-approve returns 409
- Info buttons confirmed rendering and opening with correct text in a live browser

**One limitation to note:** new interface text is English only. The other six
language files carry unrelated in-progress work and were left untouched. Missing
keys fall back to English, so nothing breaks — but Hindi, Kannada, Marathi,
Tamil, Telugu and Malayalam users will see English on the new screens until
those files are updated.
