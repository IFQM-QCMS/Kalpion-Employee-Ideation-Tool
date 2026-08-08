# -*- coding: utf-8 -*-
"""Part E: architecture decisions and traceability. Sections 24 and 25."""


def build(doc, H, para, bullets, table, figure, fig):
    doc.add_page_break()
    H(doc, "PART E - DECISIONS AND TRACEABILITY", 1)

    # -- 24 -----------------------------------------------------------------
    H(doc, "24. Architecture Decision Records", 1)
    para(doc, "The decisions that shaped the system, each with the reason and what it cost. The "
              "point of writing these down is that in a year somebody will look at one of these "
              "choices, think it is odd, and change it. This is so they can see what it was for "
              "before they do.")

    adrs = [
        ("ADR-001", "A separate database for every customer", "Accepted",
         "Customers are businesses who expect their staff list and their ideas to be nobody "
         "else's business. Sharing tables and filtering by a customer column is the common "
         "approach, but it means one missing WHERE clause leaks between customers.",
         "One database per organisation, plus a small shared registry recording which "
         "organisations exist.",
         "Separation you can point at in a sales conversation. A restore affects one customer. "
         "The cost is more databases to migrate, and a connection pool per customer, which is "
         "the first thing that will strain as the number of customers grows."),

        ("ADR-002", "Sessions as signed tokens, but the user re-read every time", "Accepted",
         "Server-held sessions would tie a user to one server and complicate restarts. Tokens "
         "solve that, but a token stays valid until it expires - so removing an employee did not "
         "end their access.",
         "Use a signed token for identity, but read the user back from the database on every "
         "request and check the role and password timestamp.",
         "Removals, demotions and password resets take effect immediately. The cost is one small "
         "indexed query per request, which is a fair price for correct access control."),

        ("ADR-003", "Raw SQL rather than an object-relational mapper", "Accepted",
         "An ORM saves work on simple applications. Here the central concern is choosing which "
         "database a request talks to, which is exactly what an ORM abstracts away.",
         "Use the MySQL driver directly with prepared statements.",
         "The queries that matter most are visible and reviewable. The cost is more code, and "
         "discipline about parameter binding - helped by prepared statements being the default."),

        ("ADR-004", "Scoring built in, external providers optional", "Accepted",
         "Sending idea text to an outside company is a real concern for customers, and an API key "
         "is a barrier for a small business.",
         "A scorer inside the application is the default. OpenAI or Gemini can be configured but "
         "are off unless chosen.",
         "The product works with no account and no cost, and by default no idea text leaves the "
         "system. The built-in scorer is less nuanced, which is an acceptable trade for a "
         "sorting aid."),

        ("ADR-005", "Full idea text is never sent to a browse list", "Accepted",
         "The list query originally selected every column, so the full text of every idea was "
         "delivered to every employee's browser. The screen showed a snippet, which hid it from "
         "the reader but not from the page.",
         "Browse endpoints send a one-line summary and nothing more. The full text comes only "
         "from the single-idea endpoint, and only to people entitled to it.",
         "The protection is real rather than cosmetic. The cost is a second request to read an "
         "idea in full, which is what a person does anyway."),

        ("ADR-006", "Archiving instead of deleting", "Accepted",
         "Administrators need old ideas out of the way. Deleting them would destroy the points "
         "awarded, the approval history and the recorded savings - the very evidence the scheme "
         "is judged on.",
         "Archiving sets a date. Everything is retained and it can be reversed.",
         "Nothing is lost and reports stay correct. The cost is that every list has to filter on "
         "it, which is why the column is indexed."),

        ("ADR-007", "One-time codes stored hashed, with a provider interface", "Accepted",
         "A six-digit code in plain text would let anyone reading the table sign in as that user. "
         "And no SMS provider had been chosen when the feature was asked for.",
         "Hash the code exactly as a password. Send it through a provider interface with three "
         "implementations, one of which writes to the log for testing and refuses to run in "
         "production.",
         "The feature could be built and tested before a supplier existed, and changing supplier "
         "is a setting. The cost is a hash comparison per attempt, which is negligible."),

        ("ADR-008", "Approval chain expressed as ordered stages", "Accepted",
         "Organisations describe approval as an order - originator, then manager, then department "
         "head - not as two unordered lists of roles.",
         "Store the ordered list. Derive the reviewer and final-approver sets from it, so the "
         "engine underneath never learns that stages exist.",
         "The admin screen can add, remove and reorder steps, and the preview is honest. The cost "
         "is two ways of expressing the same chain, which is why both are derived from one "
         "definition."),

        ("ADR-009", "Target Microsoft Azure for production", "Proposed",
         "The system runs on a free-tier arrangement that is fine for demonstrations and wrong "
         "for customers. Azure, AWS and a plain virtual server were compared.",
         "Recommend Azure App Service with Azure Database for MySQL and Blob Storage.",
         "Not chosen on price - the three are close at this size. Chosen because single sign-on "
         "is already committed to Microsoft Entra ID, and federating a different cloud's identity "
         "system to it is the expensive part. A plain virtual server is cheapest and was rejected "
         "because patching, upgrades, backups and certificates all become a named person's "
         "recurring job, which is the opposite of what a handover needs."),

        ("ADR-010", "Move uploaded files to object storage", "Proposed",
         "Files sit on the application server's disk. That is fine on one permanent machine and "
         "wrong the moment there are two, or the platform replaces the machine - which is exactly "
         "what the current hosting does.",
         "Move attachments to object storage before production.",
         "Fixes disappearing attachments and the backup gap in one change. Contained: three "
         "modules write files. Must happen before any customer stores anything they would miss."),

        ("ADR-011", "Defer single sign-on", "Deferred",
         "Requested in the minutes, across QCMS, DWM and Skills.",
         "Not built. The sign-in path was structured so that a new method returns the same "
         "session as any other, which one-time codes have now demonstrated.",
         "Adding single sign-on later is an addition rather than a rewrite. Blocked on an Azure "
         "tenant and agreement from two other tools."),

        ("ADR-012", "Free email domains blocked at registration", "Accepted, with a conflict",
         "An ideation platform is sold to a business. An address anyone can create in a minute is "
         "no evidence the applicant speaks for a company.",
         "Refuse consumer and disposable email domains, and require a human to approve every "
         "application anyway.",
         "Keeps the review queue readable. But the same minutes also ask to accept a personal "
         "address for businesses with no domain of their own. Both cannot be true. Free mail is "
         "blocked today, so a sole trader cannot register. This needs a decision - it is the one "
         "genuinely open question in this document."),
    ]

    for ref, title, status, context, decision, consequence in adrs:
        H(doc, "%s  %s" % (ref, title), 3)
        table(doc, ["", ""], [
            ["Status", status],
            ["Context", context],
            ["Decision", decision],
            ["Consequences", consequence],
        ], widths=[1.0, 5.2], font_size=8.5)

    # -- 25 -----------------------------------------------------------------
    H(doc, "25. Requirements Traceability Matrix", 1, page_break=True)
    para(doc, "Every requirement mapped to the part of the system that implements it, the "
              "diagrams that describe it, and how it is verified. This is the table to use when "
              "asking whether something was actually built.")

    rows = [
        ["FR-01", "authService, auth middleware", "D-7, A-6", "Integration tests", "Done"],
        ["FR-02", "otpService, smsService", "A-6", "Six scripted security checks", "Done"],
        ["FR-03", "authService", "A-6", "Integration tests", "Done"],
        ["FR-04", "userImportService", "A-4", "Integration tests", "Done"],
        ["FR-05", "ideaService, submit screen", "D-1, D-8, D-14", "Integration tests, manual", "Done"],
        ["FR-06", "ideaService.checkDuplicate", "D-8", "Manual", "Done"],
        ["FR-07", "ideaService.submitOrDraft", "D-1", "Integration tests", "Done"],
        ["FR-08", "aiService", "D-8", "Integration tests", "Done"],
        ["FR-09", "approvalStages, ideaService", "D-1, D-9", "Integration tests", "Done"],
        ["FR-10", "ideaService escalation", "D-9", "Integration tests", "Done"],
        ["FR-11", "ideaService.reviewAction", "D-9", "Integration tests", "Done"],
        ["FR-12", "ideaService review stage", "D-1", "Scripted check", "Done"],
        ["FR-13", "ideaService ROI and implementation", "D-1", "Integration tests", "Done"],
        ["FR-14", "leaderboardService, coreHelpers", "D-1", "Integration tests", "Done"],
        ["FR-15", "votingService, commentService", "D-1", "Integration tests", "Done"],
        ["FR-16", "challengeService", "A-4", "Manual", "Done"],
        ["FR-17", "ideaService.redactSolution", "A-6, D-3", "Scripted, three modes", "Done"],
        ["FR-18", "settingsService, org settings", "A-6", "Scripted, three modes", "Done"],
        ["FR-19", "ideaService.setArchived", "D-5", "Scripted check", "Done"],
        ["FR-20", "ideaService.setPatentability", "D-5", "Scripted check", "Done"],
        ["FR-21", "exportService, screen export", "D-14", "Manual", "Done"],
        ["FR-22", "Rejected ideas screen", "D-13", "Manual", "Done"],
        ["FR-23", "userImportService", "A-4", "Integration tests, 500-row sample", "Done"],
        ["FR-24", "hierarchyTemplateService", "A-4", "Round-trip script incl. refusals", "Done"],
        ["FR-25", "userService.adminUsers", "A-4", "Scripted check", "Done"],
        ["FR-26", "registrationService", "D-10", "End-to-end script", "Done"],
        ["FR-27", "registrationService domain check", "D-10", "End-to-end script", "Done"],
        ["FR-28", "registrationService.approve", "D-10", "End-to-end script", "Done"],
        ["FR-29", "platformService", "A-1, D-6", "Integration tests", "Done"],
        ["FR-30", "platformService privacy contract", "A-1, D-6", "Integration tests", "Done"],
        ["FR-31", "activityService", "A-6", "Scripted check", "Done"],
        ["FR-32", "qcmsService, integrationService", "A-7, D-11", "Integration tests", "Done"],
        ["FR-33", "settingsService, brandingService", "A-4", "Manual", "Done"],
        ["FR-34", "Language files", "A-3", "Automated key check", "Done, English only for new text"],
        ["FR-35", "supportService", "A-4", "Manual", "Done"],
    ]
    table(doc, ["Req", "Implemented in", "Diagrams", "Verified by", "State"], rows,
          widths=[0.55, 1.9, 0.9, 1.85, 1.0], font_size=8,
          caption="25.1  Functional requirements")

    nrows = [
        ["NFR-01", "tenant.js, auth middleware", "A-2, D-4, D-5", "Integration tests", "Done"],
        ["NFR-02", "ideaService redaction", "A-6", "Scripted, all modes and roles", "Done"],
        ["NFR-03", "auth middleware re-read", "A-6, D-7", "Integration tests", "Done"],
        ["NFR-04", "bcrypt in authService", "A-6", "Integration tests", "Done"],
        ["NFR-05", "app.js, config", "A-6", "Live check", "Done"],
        ["NFR-06", "rateLimiter, tenantQuota", "A-6", "Scripted quota test", "Done"],
        ["NFR-07", "Indexes, paging", "-", "Load testing", "Done"],
        ["NFR-08", "Server-side search and paging", "-", "Manual with 500 users", "Done"],
        ["NFR-09", "Best-effort writes", "D-15", "Code review", "Done"],
        ["NFR-10", "Managed backups, backup script", "-", "Not yet rehearsed", "Partial"],
        ["NFR-11", "idea_workflow, login activity", "D-5", "Integration tests", "Done"],
        ["NFR-12", "Information buttons, glossary", "D-14", "Browser check", "Done"],
        ["NFR-13", "Focus outlines, responsive layout", "D-14", "Manual", "Partial"],
        ["NFR-14", "Seven language files", "A-3", "Automated key check", "Partial"],
        ["NFR-15", "Standard Node and MySQL", "A-3, A-5", "Runs on three hosts", "Done"],
        ["NFR-16", "Layered services, technical manual", "A-4", "Review", "Done"],
        ["NFR-17", "Registration and import field sets", "D-4", "Review", "Done"],
        ["NFR-18", "config.assertConfigOrExit", "D-15", "Integration tests", "Done"],
    ]
    table(doc, ["Req", "Implemented in", "Diagrams", "Verified by", "State"], nrows,
          widths=[0.6, 2.0, 0.95, 1.75, 0.9], font_size=8,
          caption="25.2  Non-functional requirements")

    H(doc, "25.3 Open items", 2)
    table(doc, ["Item", "Status", "Blocked on"], [
        ["Single sign-on across IFQM tools", "Not started",
         "An Azure tenant, and agreement from QCMS, DWM and Skills"],
        ["Microsoft Entra ID sign-in", "Not started", "The same Azure tenant"],
        ["Billing and GST invoicing", "Not started", "Recorded as future scope in the minutes"],
        ["Registration for businesses with no domain", "Blocked",
         "A decision - it contradicts the rule to block free email. See ADR-012"],
        ["Penetration test", "Not started", "Commissioning"],
        ["User acceptance testing", "Not started", "Scheduling"],
        ["Translation of new screens", "Partial",
         "Six language files hold unrelated in-progress work. New text falls back to English"],
        ["Object storage for attachments", "Proposed", "Nothing. It is the first production task"],
    ], widths=[2.0, 1.0, 3.2], font_size=8.5)

    doc.add_page_break()
    H(doc, "Closing note", 1)
    para(doc, "This document describes the system as it actually stands, not as it was planned. "
              "Where something is incomplete it says so, and where a limitation exists - the "
              "disappearing attachments, the untested restore, the contradiction in the "
              "registration rules - it is written down rather than left for somebody to find.")
    para(doc, "The diagrams were drawn from the code. If the code changes and a diagram is not "
              "updated with it, the diagram is wrong and should be treated as such.")
    para(doc, "Comments on this version are welcome. The next version will fold in review "
              "feedback and record the decisions still outstanding.")
