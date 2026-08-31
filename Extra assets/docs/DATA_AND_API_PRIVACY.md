# What the system stores, and who can read it

MOM 29 Jul 2026 §8.1 — "clarify whether the API key is private and what
information is stored by the API".

Written to be answerable to a customer, so it says what is stored, where, who
can reach it, and what is deliberately not collected.

---

## 1. The QCMS API key

**It is write-only through the API.** `GET /api/integrations/settings` returns
`qcms_api_key_set: true` or `false` and never the value itself. There is no
endpoint, export, log line or screen anywhere in the product that prints it.

| | |
|---|---|
| Stored in | `ifqm_<org>.org_settings`, one row, that organisation's schema only |
| Readable by | Nobody through the product. A database administrator with direct SQL access can read it, as with any secret at rest |
| Set by | Organisation admin, Admin → API & Integration |
| Changed by | Pasting a new one. Leaving the field blank keeps the existing key — an untouched field cannot wipe it |
| Sent to | The configured QCMS base URL, over HTTPS, as a request header |

Each organisation holds its own key. One organisation's key is in one
organisation's database and cannot be read from another.

**Rotate it** by pasting a new one. If you believe it has been exposed, revoke
it in QCMS first — that stops the old key working immediately, which pasting a
new one here does not.

---

## 2. What the platform operator (IFQM) can see

This is the question most customers actually want answered.

**Can see:** organisation name, code, status, when someone last signed in,
counts of users and ideas, how many ideas were implemented, how many reached
QCMS, month-by-month idea volume, and the contact details of that
organisation's own admin — because IFQM provisions that account and needs
somebody to talk to.

**Cannot see, at all:** any employee other than the org admin; any idea's title,
text, score or attachments; any uploaded file; any comment or vote; any
individual's points or activity.

This is enforced in the API, not by convention. `platformService.js` carries the
rule in writing at the top of the file, and two endpoints were removed for
breaking it — one returned every employee's name, email, employee ID,
department, location and points; the other returned the full org chart with
per-person idea counts.

The counts above are computed with `COUNT`/`GROUP BY` inside each organisation's
own database, so the individual rows never leave it.

---

## 3. What is stored, by location

### The registry — `ifqm_master`

Shared infrastructure. Deliberately holds as little about individuals as
possible.

| Data | Notes |
|---|---|
| Organisations | Name, code, domain, which schema they live in, status, last sign-in, quotas |
| IFQM staff accounts | Name, email, bcrypt password hash |
| Registration applications | What an applying business submitted (see §4) |
| Login directory | Email or phone → which organisation. Needed so somebody can sign in without typing an org code |
| Sign-in activity | Who signed in, when, from what IP and browser, success or failure. Kept 180 days |
| Failed-attempt counters | For lockout. Cleared on a successful sign-in |
| One-time codes | **Hashed**, never in clear. Expire in minutes and are deleted after a day |
| API usage counters | A number per organisation per month |

### Per organisation — `ifqm_<code>`

Everything about that organisation's people and their work. Separate database,
reachable only with that organisation's identity resolved.

Employees (name, work email, phone, employee ID, department, business unit,
location, role, manager, birth **year**, bcrypt password hash) · ideas and their
full text · attachments · votes, ratings, comments · approval history · points ·
notifications · that organisation's settings.

---

## 4. What is deliberately not collected

Each of these was a decision, not an oversight.

- **Aadhaar numbers.** Government Udyam registration asks for one. This tool has
  no use for it, and holding a national identity number for no purpose makes the
  database worth attacking.
- **Bank account details.** Same reasoning.
- **Document scans.** No certificates or ID images are uploaded at registration.
- **Full date of birth.** The temporary first-login password is built from the
  birth year alone, so the day and month were being collected for nothing. The
  bulk import now asks for the year only.
- **Passwords, ever.** Only bcrypt hashes are stored. A password cannot be
  recovered from the database — resetting is the only route, by design.
- **OTP codes in clear.** Hashed, like passwords. Anyone reading the table
  cannot sign in with what they find.
- **Idea content, in the platform console.** Covered above.

---

## 5. What leaves the system

| Goes to | What | When |
|---|---|---|
| QCMS | Approved ideas: code, title, text, category, submitter name, scores | Only for organisations that configured a QCMS key, only for approved ideas |
| SMTP server | Notification and password-reset emails | Only if the organisation configured email |
| SMS gateway | The sign-in code and the recipient's number | Only if one-time-code sign-in is enabled |
| AI provider | Idea title and text, for scoring | **Only if the organisation sets an AI provider.** Blank by default, and the built-in scorer needs no external call — nothing leaves the system |

That last row is the important one for §8.2. Out of the box, **no idea text is
sent to any third party.** Scoring runs locally. An organisation that chooses to
plug in OpenAI or Gemini is choosing to send idea text to that vendor, and
should check that vendor's data-retention terms — which is a question for the
vendor's enterprise agreement, not something this application can answer on
their behalf.

---

## 6. Retention

| Data | Kept |
|---|---|
| Ideas, comments, votes, approval history | Until the organisation deletes them. Archiving hides, it does not delete |
| Attachments | Until the idea is deleted |
| Sign-in activity | 180 days, then pruned |
| One-time codes | Deleted a day after expiry |
| Failed-attempt counters | Cleared on a successful sign-in |
| Password reset tokens | Deleted on use or expiry |
| Rejected registration applications | Kept, so a resubmission can be recognised |
| A deleted organisation | Registry row removed. Its database is dropped only when the operator explicitly ticks that box |

---

## 7. Transport and storage

All traffic is HTTPS; the server redirects plaintext and sends HSTS. Database
connections to a managed host use TLS. Passwords and one-time codes are bcrypt
hashed. Session tokens are signed JWTs, checked against the database on **every**
request — so deactivating someone, changing their role, or resetting their
password ends their session immediately rather than whenever the token expires.

Attachments are not web-accessible. There is no public URL for an uploaded file;
every download goes through an authenticated endpoint that checks the requester
may see that idea.
