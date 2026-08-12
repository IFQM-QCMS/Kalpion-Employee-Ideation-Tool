# -*- coding: utf-8 -*-
"""Part D: running the system. Sections 15 to 23."""
import arch_figures as F


def build(doc, H, para, bullets, table, figure, fig):
    doc.add_page_break()
    H(doc, "PART D - RUNNING THE SYSTEM", 1)

    # -- 15 -----------------------------------------------------------------
    H(doc, "15. Deployment Architecture", 1)
    para(doc, "Where the system runs today, and how a change gets from a developer's machine to "
              "the live site.")
    figure(doc, "Figure A-5", "Deployment", F.A5_DEPLOYMENT, legend=F.A5_LEGEND)

    H(doc, "15.1 Environments", 2)
    table(doc, ["Environment", "Screens", "API", "Database", "Purpose"], [
        ["Development", "Local, port 5173", "Local, port 4000", "Local MySQL or XAMPP",
         "Day-to-day work"],
        ["Live (current)", "Vercel", "Render", "Aiven managed MySQL",
         "Demonstrations and user acceptance testing"],
        ["Production (planned)", "Azure Static Web Apps", "Azure App Service",
         "Azure Database for MySQL", "Paying customers - see ADR-009"],
    ], widths=[1.2, 1.3, 1.3, 1.5, 1.0], font_size=8.5)

    H(doc, "15.2 Known limitations of the current hosting", 2)
    table(doc, ["Limitation", "Effect", "What fixes it"], [
        ["The API sleeps after 15 minutes idle",
         "The first request after a quiet period takes about a minute",
         "A paid tier, or the move to Azure"],
        ["The disk is temporary",
         "Uploaded files vanish when the API restarts, while their database records survive. An "
         "attachment appears in a list and then fails to open.",
         "Move files to object storage. This is the first task in the production plan"],
        ["The database is capped at 1 GB",
         "Fine for demonstrations, not for several real customers",
         "A paid database tier"],
        ["Email is not configured",
         "Password resets and notifications are silently not delivered",
         "Configure an SMTP server per organisation"],
    ], widths=[1.6, 2.6, 2.0], font_size=8.5)

    # -- 16 -----------------------------------------------------------------
    H(doc, "16. Security Architecture", 1, page_break=True)
    para(doc, "Security is arranged as six layers. A request has to clear all six, and each layer "
              "assumes the ones above it were passed.")
    figure(doc, "Figure A-6", "Security layers", F.A6_SECURITY, legend=F.A6_LEGEND)

    H(doc, "16.1 Roles and what they can reach", 2)
    table(doc, ["Role", "Can see", "Can do"], [
        ["Trainee, Employee", "Their own ideas in full; titles and summaries of others",
         "Submit, vote, comment"],
        ["Team lead, Project lead", "Their team's ideas", "The above, plus review"],
        ["Manager, Department manager, Senior manager",
         "Their reports' ideas, in full", "Review and pass onward"],
        ["Plant head", "Every idea in the organisation", "Final approval"],
        ["Executive", "Every idea in the organisation", "Review"],
        ["Organisation admin", "Everything in their own organisation",
         "All of the above, plus people, settings, archiving, exports"],
        ["Super admin", "Everything in their own organisation",
         "As organisation admin. Deliberately removed from the approval chain"],
        ["IFQM platform admin", "Counts and totals for every organisation. No idea content, ever",
         "Create and pause organisations, approve applications, handle tickets"],
    ], widths=[1.7, 2.4, 2.1], font_size=8.5)

    H(doc, "16.2 Decisions worth explaining", 2)
    table(doc, ["Decision", "Why"], [
        ["The user is re-read from the database on every request",
         "A session token stays valid for eight hours. Trusting it meant that removing an "
         "employee did not end their access, demoting someone left their old powers in place, "
         "and resetting a password did not close sessions opened with the old one."],
        ["A password check runs even when the account does not exist",
         "Skipping it answered 'no such account' in about five milliseconds and 'wrong password' "
         "in about 250. That difference alone let anyone work out who works at a company."],
        ["Lockout counters are stored in the database",
         "They used to be held in memory, which meant they reset on every restart, did not exist "
         "across two servers, and grew without limit."],
        ["Browse lists never carry full idea text",
         "The screen only showed a snippet, but the whole text was in the response and readable "
         "by anyone who opened the browser's network tab. Truncating on screen is not privacy."],
        ["Super admin is not in the approval chain",
         "Whoever holds that password is usually somebody in IT, not the person qualified to "
         "judge a shop-floor improvement."],
        ["Content protection is offered but described honestly",
         "It blocks right-click, selection and copying, and stamps the reader's name across the "
         "text. It cannot stop a screenshot or a phone camera and the help text says so. Its "
         "real value is that a leaked screenshot carries a name."],
    ], widths=[1.9, 4.3], font_size=8.5)

    # -- 17 -----------------------------------------------------------------
    H(doc, "17. Integration Architecture", 1, page_break=True)
    para(doc, "Four outside services, all optional, all configured per customer, and all outbound. "
              "Nothing external can call into the system.")
    figure(doc, "Figure A-7", "Integrations", F.A7_INTEGRATION, legend=F.A7_LEGEND)

    table(doc, ["Integration", "Direction", "Trigger", "If it fails"], [
        ["QCMS", "Out", "An administrator pushes an approved idea",
         "The failure is recorded against the idea and it can be retried. A duplicate is "
         "treated as success, because the idea has arrived and retrying would create a second"],
        ["Email (SMTP)", "Out", "Password reset, notifications",
         "Queued and retried. Nothing else is affected"],
        ["SMS", "Out", "A one-time sign-in code",
         "The user is told the code could not be sent. Password sign-in still works"],
        ["AI scoring", "Out", "An idea is submitted, only if a provider is configured",
         "Falls back to the built-in scorer. The submission still succeeds"],
    ], widths=[1.0, 0.7, 2.0, 2.5], font_size=8.5)

    para(doc, "Worth stating plainly for customer conversations: with no AI provider configured, "
              "which is the default, no idea text leaves the system at all. Scoring runs inside "
              "the application.")

    # -- 18 -----------------------------------------------------------------
    H(doc, "18. Error Handling and Exception Flow", 1, page_break=True)
    para(doc, "Two kinds of problem, handled differently on purpose.")
    figure(doc, "Figure D-15", "How a failure is handled", F.D15_ERRORS, legend=F.D15_LEGEND)

    H(doc, "18.1 The principle", 2)
    para(doc, "A problem we anticipated gets a specific, useful message: which field was wrong, "
              "how many sign-in attempts remain, which limit was reached. A problem we did not "
              "anticipate gets a generic message and a full entry in the log.")
    para(doc, "The reason for the difference is that raw database errors name tables, columns and "
              "file paths. Showing one to a user hands an attacker a map of the system. So the "
              "detail goes to the log, where the people who need it can find it, and the user "
              "gets a sentence.")

    H(doc, "18.2 Things that fail quietly, and why", 2)
    table(doc, ["Operation", "Why a failure is swallowed"], [
        ["Writing a sign-in record", "An audit trail that can stop a sign-in turns a logging "
                                     "outage into an outage"],
        ["Sending a notification", "A mail server being slow must not make submitting an idea fail"],
        ["Counting API usage", "A fault in measuring must never become an outage for the customer"],
        ["Updating the sign-in directory", "It repairs itself on the next sign-in"],
    ], widths=[1.9, 4.3], font_size=8.5)

    H(doc, "18.3 Things that fail loudly, and why", 2)
    table(doc, ["Situation", "What happens"], [
        ["Weak or missing session signing key", "The server refuses to start and says so"],
        ["Blank database password, or the root account in use", "The server refuses to start"],
        ["Settings still pointing at a developer machine", "The server refuses to start"],
        ["The registry cannot be reached, in production",
         "Sign-in is refused rather than falling back to a default organisation, which would "
         "authenticate somebody against the wrong customer's data"],
    ], widths=[2.4, 3.8], font_size=8.5)

    # -- 19 -----------------------------------------------------------------
    H(doc, "19. Logging and Monitoring", 1, page_break=True)

    H(doc, "19.1 What is written down", 2)
    table(doc, ["Kind", "Where", "Kept", "Contains"], [
        ["Application log", "Standard output, collected by the host", "Host's retention",
         "Start-up, requests, warnings, errors with stack traces"],
        ["Request log", "Same", "Same", "Method, path, status, time taken"],
        ["Sign-in activity", "Registry table", "180 days",
         "Who, when, from what address and browser, success or failure"],
        ["Idea history", "Per organisation, in the database", "Life of the idea",
         "Every status change, who made it, when, and the comment"],
        ["Import errors", "Per organisation", "Life of the job", "Row number and reason"],
        ["API usage", "Registry table", "Rolling", "Requests per organisation per month"],
    ], widths=[1.2, 1.4, 0.9, 2.7], font_size=8.5)

    H(doc, "19.2 What is never logged", 2)
    bullets(doc, [
        "Passwords, in any form.",
        "One-time codes, except in the deliberate test-only mode, which refuses to run in "
        "production for exactly this reason.",
        "The QCMS key.",
        "Full phone numbers - the last four digits only.",
        "Idea content.",
    ])

    H(doc, "19.3 Health checks", 2)
    table(doc, ["Check", "Answers", "Use"], [
        ["/api/health", "The process is running",
         "A load balancer's basic check. Deliberately does not touch the database"],
        ["/api/ready", "The process can reach the registry",
         "The check to point orchestration at. A server that is up but cannot reach its "
         "database is worse than one that is down, because it answers every request with an error"],
    ], widths=[1.2, 1.8, 3.2], font_size=8.5)

    H(doc, "19.4 Gaps to close before production", 2)
    bullets(doc, [
        "No alerting. Somebody has to look at the logs. An uptime check with an email alert is "
        "the cheapest first step, and both health endpoints already exist for it to call.",
        "No error aggregation. A tool that groups repeated errors would make patterns visible "
        "that a flat log hides.",
        "No dashboard for sign-in failures, which is the signal that matters most for abuse. "
        "The data is already recorded; nothing displays it as a trend.",
    ])
    para(doc, "These three are carried forward into section 26.2, which is the single "
              "consolidated list of everything not yet done.", italic=True)

    # -- 20 -----------------------------------------------------------------
    H(doc, "20. Performance and Scalability", 1, page_break=True)

    H(doc, "20.1 What has already been done", 2)
    table(doc, ["Measure", "Reason"], [
        ["Indexes on the columns lists are sorted and filtered by",
         "Under load testing, the ideas list was scanning the whole table and sorting it on "
         "every request. At a few thousand rows that is cheap; at hundreds of thousands it "
         "consumed the connection pool and requests started failing. With the index the database "
         "reads in order and stops at 100 rows"],
        ["Every list is capped and paged",
         "The user list used to return every employee in one response. Bulk import can put "
         "several thousand people in there, and sending all of them would hang the very screen "
         "an administrator lands on after importing"],
        ["Searching and filtering happen in the database",
         "So the browser never receives rows it is only going to hide"],
        ["Password checks do not block the server",
         "The synchronous version occupies the process for the full quarter-second of hashing, "
         "during which nobody else is served. A morning sign-in rush made login latency into "
         "everybody's latency"],
        ["One connection pool per organisation, reused",
         "Opening a connection per request is the most expensive thing a small application "
         "usually does"],
        ["Usage counting is buffered",
         "Writing a counter on every request would put a database round trip in front of every "
         "call, to protect against something that happens once a month"],
    ], widths=[1.9, 4.3], font_size=8.5)

    H(doc, "20.2 Where it would strain first", 2)
    table(doc, ["Growth", "First thing to give way", "Answer"], [
        ["More organisations", "Database connections. Each organisation holds its own pool",
         "Reduce the pool size per organisation, or close idle pools. Both are settings"],
        ["Many more staff in one organisation", "The org chart screen, which loads the whole tree",
         "Load one level at a time"],
        ["Many more ideas", "The idea board, which is an unfiltered wall of cards",
         "Add filters and paging to the board"],
        ["Sustained heavy traffic", "The API is a single process",
         "Run several. The design already allows it - sessions hold no server-side state"],
        ["Many attachments", "Local disk",
         "Object storage. Needed anyway for the current hosting"],
    ], widths=[1.3, 2.5, 2.4], font_size=8.5)

    para(doc, "For the size of customer this is sold to - 20 to 500 staff - the current design has "
              "considerable headroom. The strain points above are worth knowing, not worth "
              "pre-emptively engineering.")

    # -- 21 -----------------------------------------------------------------
    H(doc, "21. Backup and Disaster Recovery", 1, page_break=True)

    H(doc, "21.1 What is backed up", 2)
    table(doc, ["What", "How", "How often", "Kept"], [
        ["Registry database", "Managed provider snapshots", "Daily, plus point-in-time",
         "Per the provider's plan"],
        ["Each organisation's database", "Same", "Daily, plus point-in-time", "Same"],
        ["Uploaded files", "NOT BACKED UP on the current hosting",
         "-", "This is the biggest gap. See below"],
        ["Code and schema", "Git history", "Every change", "Indefinitely"],
        ["Configuration", "Host's settings store", "On change", "Current values only"],
    ], widths=[1.4, 1.7, 1.5, 1.6], font_size=8.5)

    H(doc, "21.2 The gap that needs closing first", 2)
    para(doc, "Uploaded files sit on the application server's own disk. On the current hosting "
              "that disk is wiped whenever the server restarts, and it is not backed up at all. "
              "The database records describing those files survive, so the result is an "
              "attachment that appears in a list and fails to open.")
    para(doc, "Moving files to object storage fixes the backup gap and the disappearing-files "
              "problem in one change, and it has to happen before any customer stores anything "
              "they would miss. It is the first item in the production plan.")

    H(doc, "21.3 Recovery targets", 2)
    table(doc, ["Scenario", "Target time to recover", "Expected data loss", "How"], [
        ["Application server fails", "Under 15 minutes", "None",
         "Redeploy. The API holds no state of its own"],
        ["Database corrupted or wrong data written", "1 to 4 hours", "Up to 5 minutes",
         "Point-in-time restore to just before the problem"],
        ["One organisation's data damaged", "1 to 2 hours", "Up to 5 minutes",
         "Restore that one database. Others are untouched, which is a direct benefit of the "
         "separate-database design"],
        ["Whole hosting region lost", "4 to 24 hours", "Up to 24 hours",
         "Restore into another region from the latest snapshot"],
        ["Files lost", "Not currently recoverable", "All files",
         "Until object storage is in place, this cannot be recovered. Stated plainly rather "
         "than glossed over"],
    ], widths=[1.4, 1.2, 1.1, 2.5], font_size=8.5)

    para(doc, "These targets have not been rehearsed. A restore that has never been tested is an "
              "assumption, not a plan, and a rehearsal should be scheduled before the first "
              "paying customer.")

    # -- 22 -----------------------------------------------------------------
    H(doc, "22. Testing Strategy", 1, page_break=True)

    H(doc, "22.1 What exists today", 2)
    table(doc, ["Level", "What it covers", "How many", "How it runs"], [
        ["Integration tests", "The API end to end against a real database - sign-in, roles, "
                              "tenant separation, lockout arithmetic, anonymity, approvals, "
                              "QCMS, billing",
         "37, all passing", "npm test"],
        ["Assurance suite", "One scripted case per requirement across 22 areas, from "
                            "authentication to fault tolerance and scalability. Writes a "
                            "results file and a printable test-case document",
         "229 cases, 228 passing", "node test/tc_runner.mjs"],
        ["Migration checks", "Every schema file applied twice under strict database settings",
         "All 20 migrations", "Script"],
        ["Targeted verification", "Written for each risky change - quotas, one-time codes, "
                                  "visibility rules, the hierarchy template",
         "As needed", "Scripts, run during development"],
    ], widths=[1.3, 2.6, 1.1, 1.2], font_size=8.5)
    para(doc, "The one failing case is deliberate and is left failing rather than skipped: it "
              "compares the interface strings across the seven languages and reports the 294 "
              "that exist in English and not in the other six. It will pass when the translation "
              "work in section 26.3 is done, and until then it is the thing that stops that gap "
              "being forgotten.", italic=True)

    H(doc, "22.2 What the integration tests deliberately cover", 2)
    para(doc, "They are not there for coverage figures. Each one exists because the thing it "
              "checks either broke once or would be severe if it broke.")
    bullets(doc, [
        "One organisation cannot read another's data.",
        "A role cannot reach an endpoint it should not.",
        "Lockout counts correctly - an off-by-one here locks people out a try early.",
        "An anonymous idea stays anonymous everywhere, including in the approval history.",
        "The approval chain routes and escalates correctly.",
        "A password change ends sessions opened with the old password.",
    ])

    H(doc, "22.3 Gaps", 2)
    table(doc, ["Gap", "Risk", "Suggested answer"], [
        ["No automated screen tests", "A screen can break without a test noticing",
         "A handful of browser tests over the critical paths: sign in, submit, approve"],
        ["No load testing since the indexing work", "Performance could regress unnoticed",
         "A scripted run before each release"],
        ["No penetration test", "Requested in the minutes, not yet done",
         "Commission one before the first paying customer"],
        ["No user acceptance testing", "Also requested, and not yet run",
         "Run it on the current live deployment, which exists for this purpose"],
        ["Tests need a real database", "Cannot run on a machine without MySQL",
         "Acceptable, and deliberate - the things being tested are database behaviour"],
    ], widths=[1.6, 2.1, 2.5], font_size=8.5)
    para(doc, "All of these except the last are carried forward into section 26.1, with what "
              "closing each one would actually take.", italic=True)

    # -- 23 -----------------------------------------------------------------
    H(doc, "23. Deployment and Release Plan", 1, page_break=True)

    H(doc, "23.1 How a change reaches the live site", 2)
    table(doc, ["Step", "What happens", "Who"], [
        ["1", "Write the change and run the tests locally", "Developer"],
        ["2", "If the database changes, write a numbered migration file and apply it locally",
         "Developer"],
        ["3", "Commit and push to the main branch", "Developer"],
        ["4", "The screens and the API rebuild automatically", "Automatic"],
        ["5", "Run the migration against the live database, deliberately", "Developer"],
        ["6", "Check the health endpoint and try the changed feature", "Developer"],
    ], widths=[0.5, 4.2, 1.5], font_size=8.5)

    H(doc, "23.2 The rule about database changes", 2)
    para(doc, "Migrations are forward-only. Fixing a bad migration means writing a new one, never "
              "editing a file that has already been applied - copies that already ran cannot be "
              "retro-edited. A ledger records which migration has been applied to which database, "
              "so re-running applies only what is missing.")
    para(doc, "Order matters when a change is not backwards-compatible. A migration that adds "
              "something goes before the code that needs it; one that removes something goes "
              "after. Getting this the wrong way round causes a short outage.")

    H(doc, "23.3 Rollback", 2)
    table(doc, ["Problem", "How to undo it"], [
        ["Code is faulty", "Both hosts keep previous deployments; roll back with one click"],
        ["A migration is faulty", "Write and apply a new migration that corrects it. Never edit "
                                  "the original"],
        ["Data is wrong", "Point-in-time restore of that organisation's database"],
    ], widths=[1.6, 4.6], font_size=8.5)

    H(doc, "23.4 Before the first paying customer", 2)
    table(doc, ["#", "Task", "Why it blocks"], [
        ["1", "Move uploaded files to object storage",
         "Files are currently lost on restart and are not backed up"],
        ["2", "Configure an SMTP server", "No password reset or notification email is delivered"],
        ["3", "Move to paid hosting", "Cold starts and a 1 GB database cap"],
        ["4", "Rehearse a restore", "The recovery plan is untested"],
        ["5", "Run user acceptance testing", "Requested in the minutes"],
        ["6", "Commission a penetration test", "Requested in the minutes"],
        ["7", "Set up uptime alerting", "Nobody is currently told when something breaks"],
    ], widths=[0.4, 2.9, 2.9], font_size=8.5)
    para(doc, "Section 26.4 puts these in the order they should actually be done, alongside the "
              "items that do not block a first customer but still need doing.", italic=True)
