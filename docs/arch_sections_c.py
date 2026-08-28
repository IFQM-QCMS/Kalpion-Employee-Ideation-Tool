# -*- coding: utf-8 -*-
"""Part C: detailed design. Sections 7 to 14, plus the design diagrams."""
import arch_figures as F


def build(doc, H, para, bullets, table, figure, fig):
    doc.add_page_break()
    H(doc, "PART C - DETAILED DESIGN DIAGRAMS", 1)
    para(doc, "Part B showed what the system is made of. This part shows what it does - the steps "
              "that happen when somebody presses a button, the shape of the data, and the screens "
              "themselves.")

    # -- 7 ------------------------------------------------------------------
    H(doc, "7. System Workflow", 1)
    para(doc, "The life of an idea, from somebody having a thought to the saving being recorded. "
              "Everything else in the product exists to keep an idea moving along this path.")
    figure(doc, "Figure D-1", "Idea lifecycle", F.D1_WORKFLOW, legend=F.D1_LEGEND,
           note="Points are awarded once at each step: 10 for submitting, 25 when approved, 65 "
                "when implemented. The larger number at the end is deliberate - it rewards ideas "
                "that were actually carried out, not ideas that merely sounded good.")

    H(doc, "7.1 The two ways an idea can be approved", 2)
    table(doc, ["", "One reviewer at a time", "A committee together"], [
        ["How it moves", "Up the reporting line, one manager at a time",
         "Everyone assigned sees it at the same time"],
        ["Who decides", "Each person in turn passes it on or closes it",
         "A set share must agree, for example 75 per cent"],
        ["Best for", "Everyday improvements with a clear owner",
         "Ideas that cross departments, or need several opinions"],
        ["If nobody answers", "Moves up a level automatically after the escalation period",
         "Same"],
    ], widths=[1.1, 2.6, 2.5], font_size=8.5)

    H(doc, "7.2 Two things worth being clear about", 2)
    bullets(doc, [
        "The review period and the escalation period are different. The first flags an idea as "
        "late so somebody chases it, and changes nothing. The second actually moves the idea to "
        "the next person. The escalation period should always be the longer of the two.",
        "Rejection is not a dead end. The reason is kept, and rejected ideas have their own "
        "screen, because the reason an idea was turned down is one of the most reusable things "
        "in the system.",
    ])

    # -- 8 ------------------------------------------------------------------
    H(doc, "8. Data Flow", 1, page_break=True)
    para(doc, "Where information comes from, what is done with it, and where it ends up. Two "
              "levels: the whole system as one process, then the same thing opened up.")
    figure(doc, "Figure D-2", "Data flow, level 0 (context)", F.D2_DFD0, legend=F.D2_LEGEND)
    figure(doc, "Figure D-3", "Data flow, level 1 (inside the system)", F.D3_DFD1, legend=F.D3_LEGEND,
           note="The two stores are worth noticing. D1 is shared by everybody and holds almost "
                "nothing about individuals. D2 exists once per customer and holds everything about "
                "their people and ideas. No process ever reads D2 for an organisation other than "
                "the one the signed-in user belongs to.")

    # -- 9 ------------------------------------------------------------------
    H(doc, "9. Database Design", 1, page_break=True)
    para(doc, "There are two kinds of database. One registry, shared, holding as little as "
              "possible. Then one database per customer, holding everything about that customer.")

    H(doc, "9.1 The registry", 2)
    figure(doc, "Figure D-4", "Registry tables and relationships", F.D4_ER_MASTER, legend=F.D4_LEGEND)

    H(doc, "9.2 One customer organisation", 2)
    figure(doc, "Figure D-5", "Per-organisation tables and relationships", F.D5_ER_TENANT,
           legend=F.D5_LEGEND,
           note="The users table points at itself - that is the reporting line, and it is what "
                "ideas travel along when they escalate.")

    H(doc, "9.3 Design decisions in the data", 2)
    table(doc, ["Decision", "Reason"], [
        ["Approval history is append-only",
         "Every status change is written as a new row and nothing is ever edited. It is the audit "
         "trail, and an audit trail you can edit is not one."],
        ["Archiving is a date, not a delete",
         "An archived idea keeps its points, its history and its recorded saving. It just leaves "
         "the working lists. Deleting would destroy exactly the evidence the scheme is measured on."],
        ["Patentability is its own column",
         "An idea can be approved and not patentable, or turned down on cost and still worth "
         "filing. Folding it into the status would lose precisely those cases."],
        ["Both an estimate and a commitment for dates",
         "One column is what the submitter guessed; another is what the owner committed to after "
         "approval. Keeping one column would lose the comparison."],
        ["Year of birth, not date of birth",
         "The temporary first password uses only the year, so the day and month were personal "
         "data collected for nothing."],
        ["Settings are key and value rows",
         "Each organisation has its own settings and new ones are added constantly. A column per "
         "setting would mean a schema change every time."],
        ["Tags stored as a short list in one column",
         "The set of tags is fixed and small and is never queried relationally. A separate table "
         "would be ceremony with no benefit."],
    ], widths=[1.9, 4.3], font_size=8.5)

    # -- 10 -----------------------------------------------------------------
    H(doc, "10. API Architecture and Specification", 1, page_break=True)
    para(doc, "One HTTP interface, used by the screens and by nothing else at present. Everything "
              "lives under /api. There are 133 endpoints across 19 groups. Those figures, and the "
              "per-group counts in 10.5, are read out of the route files by a script rather than "
              "maintained by hand, because a hand-counted endpoint table is correct on the day it "
              "is typed and wrong a fortnight later.")

    H(doc, "10.1 Conventions", 2)
    table(doc, ["Aspect", "Convention"], [
        ["Base path", "/api. There is no version prefix - the only caller is the product's own "
                      "screens, which are deployed together with the server. A version prefix "
                      "would be added the day an outside party is given access."],
        ["Format", "JSON in, JSON out, UTF-8. Uploads are multipart form data. Two endpoints "
                   "answer with bytes rather than JSON: the attachment download and the idea PDF."],
        ["Success", 'An object with success set to true, plus named data. There is no generic '
                    '"data" wrapper; the key says what it holds - ideas, user, subscription.'],
        ["Failure", 'An object with success false and error set to one plain-English sentence, '
                    'suitable for showing to a person unaltered. Some errors carry an extra '
                    'field, such as retry_after on a lockout.'],
        ["Authentication", "A signed token in the Authorization header, as a Bearer token."],
        ["Organisation", "Taken from the token, never from anything the caller can set freely. "
                         "There is no tenant parameter on any endpoint."],
        ["Naming", "Paths are lower case with hyphens; JSON fields are lower case with "
                   "underscores, matching the column names they mostly come from."],
        ["Dates", "Sent as strings. Timestamps are MySQL DATETIME in the server's zone; plain "
                  "dates are YYYY-MM-DD. Anything that is not exactly YYYY-MM-DD is stored as "
                  "empty rather than guessed at."],
        ["Paging", "page and limit as query parameters where a list can grow. Lists are capped "
                   "at 100 rows and the cap is applied by the server, not requested by the caller."],
        ["Idempotency", "There are no idempotency keys. Where repeating a call would do harm - a "
                        "second approval on one idea - the endpoint takes a named database lock "
                        "and the repeat is refused with 409 rather than silently applied twice."],
    ], widths=[1.3, 4.9], font_size=8.5)

    H(doc, "10.2 Authentication and authorisation", 2)
    para(doc, "Every request carries the same header, and every guarded endpoint runs the same "
              "three checks in the same order. Nothing endpoint-specific happens before them.")
    table(doc, ["Step", "What is checked", "Refusal"], [
        ["1  Token", "Authorization: Bearer <token>. The signature and expiry are verified.",
         "401 with 'Not authenticated'"],
        ["2  Freshness", "The account is read back from the database and its password-change "
                         "stamp compared with the one inside the token.",
         "401 - the session was opened before a password change, or the account is gone or "
         "deactivated"],
        ["3  Role", "The route names the roles allowed to reach it. Where the rule depends on the "
                    "row rather than the role - your own idea, your report's idea - the service "
                    "checks again after loading it.",
         "403 with 'Insufficient permissions'"],
    ], widths=[1.1, 3.2, 1.9], font_size=8.5)
    para(doc, "Ten endpoints have no token check, and they are exactly the ones that cannot: the "
              "eight sign-in and password-reset calls under /auth, and the two under "
              "/registrations. Every other endpoint in the system is guarded. Of the ten, only "
              "the two registration endpoints are reachable by somebody who has no account at "
              "all, which is what makes them the pair worth watching.", italic=False)

    H(doc, "10.3 Status codes", 2)
    table(doc, ["Code", "Means", "Typical cause"], [
        ["200", "Done", "Everything, including creations - the API does not use 201"],
        ["400", "The request is wrong",
         "A required field is missing, a value is not in the allowed set, an organisation code "
         "is the wrong length"],
        ["401", "Not signed in, or no longer signed in",
         "No token, a tampered or expired token, a wrong password, a session opened before a "
         "password change"],
        ["403", "Signed in, but not allowed",
         "The role does not reach this route, or the row belongs to somebody else"],
        ["404", "No such thing",
         "An unknown id, or an unknown path - which answers 'Unknown action' rather than an HTML "
         "page"],
        ["409", "Conflicts with the current state",
         "The application was already approved, the organisation code is taken, the idea is "
         "being decided by somebody else right now"],
        ["413", "Too large", "The upload exceeds the organisation's own limit, or its storage "
                             "allowance is full"],
        ["429", "Too many",
         "Rate limited by address, locked out after five wrong passwords, or over the plan's "
         "monthly request allowance"],
        ["500", "A fault on our side",
         "Always the generic sentence. The detail - table names, file paths, stack - goes to the "
         "log, never to the caller"],
    ], widths=[0.5, 1.7, 4.0], font_size=8.5)

    H(doc, "10.4 Rate limits and quotas", 2)
    table(doc, ["Limit", "Applies to", "Allowance", "On breach"], [
        ["Global", "Each calling address", "300 requests per minute, configurable",
         "429 'Too many requests. Please slow down.'"],
        ["Sign-in", "Each calling address, on /auth", "30 attempts per 15 minutes, configurable",
         "429 'Too many authentication attempts.'"],
        ["Heavy operations", "Each calling address, on bulk import and similar",
         "10 per hour", "429"],
        ["Account lockout", "One account", "5 wrong passwords, then 15 minutes",
         "429 carrying retry_after in seconds"],
        ["Plan allowance", "One organisation", "The monthly figure on its plan",
         "429 - but sign-in, support, notifications, branding, settings and the health checks "
         "are always let through, so an organisation over its allowance can still get in and "
         "raise a ticket"],
    ], widths=[1.2, 1.5, 1.7, 1.8], font_size=8.5)

    H(doc, "10.5 The endpoint map", 2)
    para(doc, "All 19 groups. Counts are from the route files as they stand.")
    table(doc, ["Group", "No.", "What it covers", "Who may call it"], [
        ["/platform", "35", "Organisations and their detail, the registration queue, plans and "
                            "billing, support tickets, platform settings, sign-in activity",
         "IFQM platform staff only - a blanket guard on the whole group"],
        ["/users", "18", "People, bulk import, the reporting line, the hierarchy template, "
                         "role and department filters",
         "Organisation admin, except the lookups every signed-in user needs"],
        ["/ideas", "18", "Submit and draft, list, read, duplicate check, review actions, "
                         "committee assignment, savings, implementation, archive, patentability",
         "Signed-in, then narrowed per route: reviewer roles to decide, admin to archive"],
        ["/auth", "10", "Sign in, sign out, one-time codes, password reset and change",
         "Eight are open by necessity; change-password needs a session"],
        ["/votes", "8", "Ratings, up and down votes, the idea board", "Signed-in"],
        ["/challenges", "5", "Time-limited campaigns", "Signed-in to read, admin to run"],
        ["/support", "5", "Tickets raised by a customer and their messages", "Signed-in"],
        ["/settings", "4", "One organisation's own settings, an email test, and its subscription",
         "Reading is open to the organisation; writing is admin"],
        ["/export", "4", "Ideas and leaderboard spreadsheets, analytics, single-idea PDF",
         "Signed-in; analytics is restricted to senior roles"],
        ["/branding", "4", "Logo and colours", "Anyone reads, admin writes"],
        ["/integrations", "4", "The QCMS key, the approved-ideas list, and the push",
         "Organisation admin"],
        ["/comments", "3", "Threaded comments on an idea", "Signed-in"],
        ["/categories", "3", "The organisation's own idea categories", "Signed-in reads, admin writes"],
        ["/upload", "3", "Attach a file, download one through a check, remove one", "Signed-in"],
        ["/registrations", "2", "A business applying for a workspace, and the live email check",
         "Open. The only pair reachable without an account"],
        ["/score", "2", "Re-score an idea, and explain a score", "Signed-in"],
        ["/notifications", "2", "The unread list, and marking them read", "Signed-in"],
        ["/reports", "2", "Analytics figures behind the charts", "Signed-in, scoped by role"],
        ["/leaderboard", "1", "The ranked contributor list", "Signed-in"],
    ], widths=[1.0, 0.35, 2.6, 2.25], font_size=7.6,
        caption="Table 10.1  Every route group, with its endpoint count")

    H(doc, "10.6 Endpoint specifications", 2)
    para(doc, "Ten endpoints in full. They were chosen to cover every shape the API takes: an "
              "open call, a guarded write, a redacted read, a role-guarded state change, a file "
              "in, a file out, a provisioning call, an outbound integration, and a billing read.")

    table(doc, ["10.6.1   POST /api/auth/login", ""], [
        ["Purpose", "Exchange an email address or phone number and a password for a session."],
        ["Auth", "None. This is the call that creates one."],
        ["Request", '{ "email": "priya@acme.co.in", "password": "...", "org_slug": "acme", '
                    '"client_timezone": "Asia/Kolkata" }'],
        ["Fields", "email accepts an email address, a registered phone number, or an employee "
                   "number. org_slug is optional - left out, the organisation is resolved from "
                   "the sign-in directory. client_timezone is optional and is used only to "
                   "describe roughly where a platform-admin sign-in came from."],
        ["200", '{ "success": true, "user": { "id": 41, "name": "Priya S", "role": "employee", '
                '"points": 120, "must_change_password": false }, "token": "eyJ..." }'],
        ["400", '"Email and password are required."'],
        ["401", '"Invalid email/phone or password. 3 attempt(s) remaining."'],
        ["429", '"Too many failed attempts. Please try again in 15 minute(s)." - plus '
                'retry_after in seconds'],
        ["Notes", "A wrong password, an unknown account and a deactivated account all answer the "
                  "same way and take the same time, because a password check runs against a dummy "
                  "hash even when nothing matched. Every attempt, successful or not, is written to "
                  "the sign-in record."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.2   POST /api/ideas/submit", ""], [
        ["Purpose", "Submit an idea, or convert one of the author's own drafts into a submission. "
                    "POST /api/ideas/draft is the same call with the same body and saves a draft "
                    "instead."],
        ["Auth", "Any signed-in user."],
        ["Request", '{ "title": "...", "present_situation": "...", "proposed_solution": "...", '
                    '"impact_areas": "Quality,Cost", "impact_level": "High", '
                    '"tangible_benefit": "...", "investment_required": "Under Rs 50,000", '
                    '"feasibility": "High", "time_required": "3_6m", '
                    '"solution_tags": ["quality","cost"], "co_suggester_ids": [12, 19, 24], '
                    '"is_anonymous": false, "id": 142 }'],
        ["Required", "title, present_situation, proposed_solution. Everything else is optional - "
                     "a half-formed idea is still worth capturing, and a reviewer can ask for the "
                     "rest. id is present only when editing an existing draft."],
        ["Validated", "feasibility must be Low, Medium or High; time_required one of three bands; "
                      "solution_tags are filtered against a fixed set. An unrecognised value is "
                      "stored as empty rather than creating a fourth band or a one-off tag that "
                      "every filter would then miss. The author is dropped from their own "
                      "co-suggester list, as are duplicates."],
        ["200", '{ "success": true, "idea_id": 142, "idea_code": "Kalpion-0142", "ai_score": 78, '
                '"points_added": 10 }'],
        ["400", '"Title, present situation and proposed solution are required."'],
        ["Side effects", "Scores the idea, sets the review due date from the organisation's SLA, "
                         "routes it to the author's line manager, writes a workflow entry, awards "
                         "10 points, and queues an email. Points are awarded once: re-submitting "
                         "an already-submitted idea returns points_added 0."],
        ["Notes", "Two submissions in the same instant can collide on the generated idea code. "
                  "The insert is retried with a fresh code rather than surfacing a 500 on a "
                  "perfectly valid submission."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.3   GET /api/ideas", ""], [
        ["Purpose", "The list of ideas this person is allowed to see."],
        ["Auth", "Any signed-in user. The scope is worked out from the role, not requested."],
        ["Query", "search, status, impact, archived, tag, time_required - all optional"],
        ["200", '{ "success": true, "ideas": [ { "id": 142, "idea_code": "Kalpion-0142", '
                '"title": "...", "solution_summary": "First sentence only.", '
                '"solution_redacted": true, "ai_score": 78, "status": "Under Review", '
                '"submitter_name": "Priya S", "created_at": "2026-07-02 11:04:19" } ] }'],
        ["Guaranteed absent", "proposed_solution and present_situation are set to empty on every "
                              "row of this response, for every caller including an administrator. "
                              "The full text is only ever served by 10.6.4. Where the organisation "
                              "has closed the solution section altogether, solution_summary is "
                              "emptied too and solution_hidden_by_policy is set."],
        ["Scope", "An employee sees their own ideas in full and everybody else's as title and "
                  "status. A manager additionally sees their reports'. A plant head, executive or "
                  "administrator sees all of them."],
        ["Notes", "This endpoint used to select every column, so the whole text of every idea "
                  "reached every employee's browser while the screen showed only a snippet. "
                  "Truncating on screen is not privacy - see ADR-005."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.4   GET /api/ideas/:id", ""], [
        ["Purpose", "One idea, with as much of it as this reader is entitled to."],
        ["Auth", "Any signed-in user. Entitlement is decided per row."],
        ["200", '{ "success": true, "idea": { "id": 142, ..., "proposed_solution": "...", '
                '"solution_redacted": false, "viewer_inside": true, "workflow": [ ... ], '
                '"attachments": [ ... ], "comments": [ ... ] } }'],
        ["Redaction", "The author, the co-suggesters and anybody in the approval chain always "
                      "read the full text - viewer_inside is true. For everybody else the "
                      "organisation's own setting decides: the full text, a preview of a set "
                      "length, or nothing. solution_redacted says which happened, so the screen "
                      "can explain rather than appear broken."],
        ["403", '"Insufficient permissions." - the idea belongs to another part of the '
                'organisation this reader has no line to'],
        ["404", '"Not found." - and the same answer for an id in another organisation, which is '
                'unreachable from this connection in any case'],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.5   POST /api/ideas/review-action", ""], [
        ["Purpose", "Approve, reject or pass an idea onward, with a reason."],
        ["Auth", "Reviewer roles: team lead, project lead, manager, department manager, senior "
                 "manager, plant head, executive, admin, super admin. The service then checks "
                 "that this particular reviewer is the one the idea is waiting on."],
        ["Request", '{ "idea_id": 142, "decision": "approve", "comment": "Costed and worth doing." }'],
        ["200 (passed on)", '{ "success": true, "decision": "Escalated", '
                            '"escalated_to": "R Kulkarni", "points_awarded": 0 }'],
        ["200 (final)", '{ "success": true, "decision": "Approved", "points_awarded": 25 }'],
        ["403", "This person is not the reviewer this idea is waiting on"],
        ["409", '"This idea is being updated by someone else. Please try again."'],
        ["Concurrency", "The whole decision is taken under a named database lock keyed on the "
                        "idea. A double-tapped Approve button used to read 'no recent action' "
                        "twice and write two, so an idea could be approved five times with five "
                        "audit entries. The lock lives in MySQL rather than in the process, so it "
                        "holds across two servers."],
        ["Side effects", "Appends to the idea's history, awards points, notifies the next "
                         "reviewer or the author, and queues an email."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.6   POST /api/upload", ""], [
        ["Purpose", "Attach a file to one section of an idea."],
        ["Auth", "Any signed-in user, who must own the idea being attached to."],
        ["Request", "multipart/form-data with file, idea_id and section. section is one of "
                    "situation, solution, benefits, support."],
        ["200", '{ "success": true, "filename": "Kalpion-0142-1722512345-plan.pdf" }'],
        ["Accepted", "pdf, png, jpg, jpeg, gif, xlsx, xls, csv, docx, doc"],
        ["400", '"File type not allowed.", "No file uploaded.", or '
                '"File exceeds this organisation\'s 5 MB limit."'],
        ["403", '"Unauthorized or idea not found."'],
        ["413", "The organisation's total storage allowance would be exceeded"],
        ["Notes", "The size limit is the organisation's own setting, not a fixed 10 MB. No public "
                  "URL is returned and none exists - the file is only reachable through 10.6.7."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.7   GET /api/upload/:id/download", ""], [
        ["Purpose", "Fetch an attachment, after checking that this reader may have it."],
        ["Auth", "Any signed-in user. The attachment must belong to an idea in this "
                 "organisation that this reader may see."],
        ["200", "The file itself, as bytes. Not JSON."],
        ["Headers sent", "Content-Disposition: attachment - never inline, so an uploaded file "
                         "cannot execute in the application's own origin. Plus X-Content-Type-"
                         "Options: nosniff, a sandboxing Content-Security-Policy, and "
                         "Cache-Control: private, no-store so it stays out of shared caches."],
        ["403", '"This attachment is not available." or "Invalid attachment path."'],
        ["404", '"Attachment not found." or "File missing on disk." - the second is what a lost '
                'file on the current hosting looks like; see section 21.2'],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.8   POST /api/platform/registrations/:id/approve", ""], [
        ["Purpose", "Approve an MSME application, which provisions their workspace."],
        ["Auth", "IFQM platform staff only."],
        ["Request", '{ "slug": "acme", "plan_id": 3, "trial_days": 14, '
                    '"billing_note": "Rate agreed with the regional office." }'],
        ["Fields", "slug is the organisation code and defaults to the one proposed on the "
                   "application. plan_id and trial_days are chosen by the approver, who has the "
                   "company's headcount and turnover in front of them at that moment. Left out, "
                   "trial_days falls back to the platform default of 14."],
        ["What it does", "Creates the database, builds all 17 tables, creates the first "
                         "administrator, registers the organisation, assigns the plan and starts "
                         "the trial clock - as one sequence."],
        ["200", '{ "success": true, "tenant_id": 12, "slug": "acme", '
                '"admin_email": "ops@acme.co.in", "temp_password": "..." }'],
        ["400", '"Organisation code must be 2-30 characters."'],
        ["409", '"This application has already been approved." or "Organisation code \\"acme\\" '
                'is taken. Approve with a different code."'],
        ["Notes", "The temporary password is returned exactly once and is never retrievable "
                  "again - it is not stored in readable form anywhere. The operator relays it out "
                  "of band and the new administrator must change it at first sign-in."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.9   POST /api/integrations/push", ""], [
        ["Purpose", "Hand approved ideas to the QCMS quality system."],
        ["Auth", "Organisation admin."],
        ["Request", '{ "idea_ids": [142, 155], "only_pending": true }'],
        ["200", '{ "success": true, "attempted": 2, "imported": 1, "duplicate": 1, "failed": 0, '
                '"results": [ { "id": 142, "idea_code": "Kalpion-0142", "status": "imported", '
                '"message": "..." } ] }'],
        ["400", '"QCMS integration is turned off. Enable it and save your API key first." or '
                '"No QCMS API key saved."'],
        ["Partial success", "The call answers 200 even when some ideas failed. Each idea carries "
                            "its own status, because refusing the whole batch over one bad row "
                            "would mean redoing the ones that worked."],
        ["Duplicates", "A duplicate is counted as success, not failure. The idea has arrived; "
                       "retrying would create a second copy in the customer's quality system."],
    ], widths=[1.0, 5.2], font_size=8.5)

    table(doc, ["10.6.10   GET /api/settings/subscription", ""], [
        ["Purpose", "Where this organisation's account stands, and how long is left. This is "
                    "what the banner across the top of the screen reads."],
        ["Auth", "Any signed-in user of the organisation. It carries no other organisation's "
                 "figures and no price the caller is not already paying."],
        ["200", '{ "success": true, "subscription": { "billing_status": "trial", '
                '"state": "trial", "days_left": 6, "blocked": false, '
                '"trial_ends_at": "2026-08-16", "label": "Trial - 6 day(s) left" }, '
                '"plan": { "code": "STARTER", "name": "Starter", "amount_paise": 250000, '
                '"billing_cycle": "monthly", "gst_percent": 18, "gst_mode": "included", '
                '"max_users": 100 }, "quota": { "monthly": 60000, "used_month": 4120, '
                '"percent": 7, "source": "plan", "enforced": true } }'],
        ["Money", "Always whole paise, never rupees as a decimal. Rounding errors on money are "
                  "the kind of bug that gets found by a customer."],
        ["blocked", "True once a trial or paid period has lapsed. The screens read this to put "
                    "the workspace on hold. An organisation with no end date on file is never "
                    "blocked - locking somebody out because a field was left empty is the wrong "
                    "way round."],
    ], widths=[1.0, 5.2], font_size=8.5)

    # -- 11 -----------------------------------------------------------------
    H(doc, "11. Use Cases", 1, page_break=True)
    para(doc, "Who can do what. The important line on this diagram is the one around the IFQM "
              "platform administrator: they sit outside the organisation and can never reach idea "
              "content, however senior they are.")
    figure(doc, "Figure D-6", "Use case overview", F.D6_USECASE, legend=F.D6_LEGEND)

    # -- 12 -----------------------------------------------------------------
    H(doc, "12. Sequence Diagrams", 1, page_break=True)
    para(doc, "Five journeys, chosen because each one shows something that is not obvious from "
              "the structure alone.")

    H(doc, "12.1 Signing in", 2)
    figure(doc, "Figure D-7", "Sign in with a password", F.D7_SEQ_LOGIN, legend=F.D7_LEGEND)

    H(doc, "12.2 Submitting an idea", 2)
    figure(doc, "Figure D-8", "Submit an idea", F.D8_SEQ_SUBMIT, legend=F.D8_LEGEND)

    H(doc, "12.3 Reviewing and escalating", 2)
    figure(doc, "Figure D-9", "A decision, and what happens when nobody decides",
           F.D9_SEQ_APPROVAL, legend=F.D9_LEGEND)

    H(doc, "12.4 A business applying for a workspace", 2)
    figure(doc, "Figure D-10", "MSME registration and approval", F.D10_SEQ_REGISTER,
           legend=F.D10_LEGEND)

    H(doc, "12.5 Handing an idea to QCMS", 2)
    figure(doc, "Figure D-11", "Push an approved idea to QCMS", F.D11_SEQ_QCMS,
           legend=F.D11_LEGEND)

    # -- 13 -----------------------------------------------------------------
    H(doc, "13. Module and Service Structure", 1, page_break=True)
    para(doc, "There is no class diagram in this document, and this section explains why rather "
              "than leaving a reader to notice the absence.")
    para(doc, "The server is not written in classes. It is written as ES modules that export "
              "plain functions - 35 service modules, none of which declares a class, holds "
              "instance state or takes part in an inheritance hierarchy. Drawing boxes labelled "
              "IdeaService with a compartment of methods would describe a design nobody wrote, "
              "and would suggest objects being constructed and held that do not exist anywhere "
              "in the codebase.")
    para(doc, "So the unit of structure here is the module, and that is what is drawn: each "
              "module, the functions it exports, the ones it keeps to itself, and which modules "
              "it is allowed to call. The notation is the familiar one - a plus sign is exported "
              "and callable from elsewhere, a minus sign is private to the file - because it is "
              "the meaning people already have for those symbols, not because a class is implied.")
    figure(doc, "Figure D-12", "Module structure, taking the idea path as the example",
           F.D12_CLASS, legend=F.D12_LEGEND,
           note="One path through the system, drawn in full. There are 35 service modules; every "
                "one of them follows this same shape - a controller above it that only handles "
                "HTTP, the database connection passed in as the first argument, and calls that "
                "only ever travel downward.")

    H(doc, "13.1 What holds the structure together", 2)
    table(doc, ["Rule", "What it means", "Why it matters"], [
        ["A service never sees the request",
         "Every exported function takes the database connection first and plain values after. "
         "There is no req, res or session object inside the services folder.",
         "The rules can be called directly from a test, and a service cannot come to depend on "
         "who is calling it or how."],
        ["Calls only go downward",
         "Controllers call services; services call other services, helpers and the database "
         "layer. No service calls a controller.",
         "The dependency graph has no cycles, so any module can be read on its own."],
        ["Shared vocabulary lives in its own module",
         "ideaSections.js holds the list of idea section names and the rule for which of them an "
         "employee may see. It imports nothing.",
         "Without it, settingsService and ideaService would each need the other, which is a "
         "circular import - the concrete reason that module exists."],
        ["The role check happens twice",
         "The route names the roles that may reach it; the service checks again once it has "
         "loaded the row.",
         "The route check cannot know whether this idea is yours. Only the service, holding the "
         "row, can decide that."],
    ], widths=[1.5, 2.4, 2.3], font_size=8.5)

    H(doc, "13.2 The modules, grouped by what they are about", 2)
    table(doc, ["Group", "Modules"], [
        ["Ideas", "ideaService, ideaSections, ideaPdfService, votingService, commentService, "
                  "challengeService, categoryService, approvalStages"],
        ["People", "userService, userImportService, hierarchyTemplateService, directoryService, "
                   "leaderboardService"],
        ["Access", "authService, otpService, smsService, hashPool"],
        ["Organisation", "settingsService, brandingService, notificationService, supportService, "
                         "activityService"],
        ["Platform", "platformService, platformSettingsService, registrationService, planService, "
                     "subscriptionService"],
        ["Outward", "qcmsService, integrationService, mailerService, aiService"],
        ["Output", "exportService, reportService, uploadService"],
        ["Shared", "coreHelpers"],
    ], widths=[1.2, 5.0], font_size=8.5,
        caption="Table 13.1  All 35 service modules")

    # -- 14 -----------------------------------------------------------------
    H(doc, "14. User Interface and Screen Flow", 1, page_break=True)
    para(doc, "How somebody moves through the product, and roughly what the main screens look "
              "like. These are layouts, not final visuals.")
    figure(doc, "Figure D-13", "Screen flow", F.D13_SCREENFLOW, legend=F.D13_LEGEND)
    figure(doc, "Figure D-14", "Wireframes of the main screens", F.D14_WIREFRAMES, legend=F.D14_LEGEND)

    H(doc, "14.1 Interface principles", 2)
    table(doc, ["Principle", "What it means"], [
        ["The landing page explains before it asks",
         "A business arriving for the first time gets an explanation of the product, not a "
         "password box. Signing in is one click away for people who already have an account."],
        ["Long forms are broken into steps",
         "The submission form is six short steps rather than one long page, so nothing is "
         "abandoned halfway."],
        ["Jargon is explained where it appears",
         "60 small information buttons sit beside technical terms. They open on hover for a "
         "mouse, on tap for a phone, and on keyboard focus. A phone user gets the same help as "
         "everybody else."],
        ["Required fields are obvious before the error",
         "Marked with a red asterisk. Previously they were the same colour as the label and read "
         "as punctuation."],
        ["Detail opens over the list",
         "Reading an idea does not lose your place in the list you were working through."],
        ["Colour is never the only signal",
         "Feasibility is red, amber and green, but always with the word as well."],
        ["Everything works in seven languages",
         "Chosen per person, not per organisation, because a shop floor and an office rarely "
         "share one language."],
    ], widths=[1.9, 4.3], font_size=8.5)
