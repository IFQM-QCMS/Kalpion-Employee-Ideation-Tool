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
              "lives under /api. There are 19 groups and roughly 120 endpoints.")

    H(doc, "10.1 Conventions", 2)
    table(doc, ["Aspect", "Convention"], [
        ["Format", "JSON in, JSON out. Uploads are multipart form data."],
        ["Success", 'Always an object with success set to true, plus the data.'],
        ["Failure", 'Always an object with success false and a plain-English error message.'],
        ["Authentication", "A signed token in the Authorization header, as a Bearer token."],
        ["Organisation", "Taken from the token, never from anything the caller can set freely."],
        ["Status codes", "400 bad input, 401 not signed in, 403 not allowed, 404 not found, "
                         "409 conflicts with something, 413 too large, 429 too many or over "
                         "quota, 503 temporarily unavailable."],
        ["Paging", "Page and limit as query parameters. Lists are capped at 100 rows."],
    ], widths=[1.3, 4.9], font_size=8.5)

    H(doc, "10.2 The groups", 2)
    table(doc, ["Group", "Endpoints", "What it covers", "Who may call it"], [
        ["/auth", "10", "Sign in, sign out, one-time codes, password reset and change",
         "Anyone (sign-in), then the signed-in user"],
        ["/registrations", "2", "A business applying for a workspace, and the live email check",
         "Anyone - the only unauthenticated write in the system"],
        ["/ideas", "16", "Submit, list, read, review, archive, patentability, savings",
         "Signed-in, scoped by role"],
        ["/users", "18", "People, bulk import, reporting line, hierarchy template",
         "Mostly organisation admin"],
        ["/votes", "8", "Ratings, up and down votes, the idea board", "Signed-in"],
        ["/comments", "3", "Threaded comments on an idea", "Signed-in"],
        ["/platform", "24", "Organisations, registrations, tickets, settings, sign-in activity",
         "IFQM platform admin only"],
        ["/settings", "3", "One organisation's own settings", "Organisation admin"],
        ["/export", "4", "Spreadsheets and PDFs", "Depends on the export"],
        ["/upload", "3", "Attachments, and checked downloads", "Signed-in"],
        ["/integrations", "4", "QCMS key and pushing approved ideas", "Organisation admin"],
        ["/support", "5", "Tickets raised by a customer", "Signed-in"],
        ["Others", "20", "Leaderboard, notifications, challenges, categories, branding, "
                         "reports, scoring", "Signed-in, scoped by role"],
    ], widths=[1.05, 0.6, 2.7, 1.85], font_size=8)

    H(doc, "10.3 Worked examples", 2)
    para(doc, "Three endpoints in full, chosen because they show the three shapes the API takes.")

    table(doc, ["POST /api/auth/login", ""], [
        ["Purpose", "Exchange an email or phone number and a password for a session."],
        ["Send", '{ "email": "priya@acme.co.in", "password": "..." , "org_slug": "acme" }'],
        ["org_slug", "Optional. If left out, the organisation is worked out from the email or "
                     "phone number."],
        ["Success 200", '{ "success": true, "user": { ... }, "token": "..." }'],
        ["Failure 401", '{ "success": false, "error": "Invalid email/phone or password. '
                        '3 attempt(s) remaining." }'],
        ["Failure 429", '{ "success": false, "error": "Too many failed attempts. Please try '
                        'again in 15 minute(s)." }'],
        ["Notes", "A wrong password and an unknown account take the same amount of time to "
                  "answer, so response timing cannot be used to work out who works here."],
    ], widths=[1.3, 4.9], font_size=8.5)

    table(doc, ["GET /api/ideas", ""], [
        ["Purpose", "The list of ideas this person is allowed to see."],
        ["Query", "search, status, impact, archived, tag, time_required - all optional"],
        ["Success 200", '{ "success": true, "ideas": [ { "id": 142, "idea_code": "EIT-0142", '
                        '"title": "...", "solution_summary": "First sentence only.", '
                        '"solution_redacted": true, "ai_score": 78, "status": "Under Review", ... } ] }'],
        ["Important", "proposed_solution is never present in this response, for anybody. Only "
                      "solution_summary is. The full text is available from the single-idea "
                      "endpoint, and only to people entitled to it."],
        ["Scope", "An employee sees their own ideas plus the titles of others. A manager sees "
                  "their reports'. An administrator sees all of them."],
    ], widths=[1.3, 4.9], font_size=8.5)

    table(doc, ["POST /api/platform/registrations/:id/approve", ""], [
        ["Purpose", "Approve an MSME application, which creates their workspace."],
        ["Who", "IFQM platform administrator only."],
        ["Send", '{ "slug": "acme" }'],
        ["What it does", "Creates the database, builds all 17 tables, creates the first "
                         "administrator, registers the organisation, and returns a temporary "
                         "password."],
        ["Success 200", '{ "success": true, "tenant_id": 12, "slug": "acme", '
                        '"admin_email": "...", "temp_password": "..." }'],
        ["Failure 409", '{ "success": false, "error": "This application has already been approved." }'],
        ["Notes", "The temporary password is returned exactly once and is never retrievable "
                  "again. The new administrator is forced to change it on first sign-in."],
    ], widths=[1.3, 4.9], font_size=8.5)

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
    figure(doc, "Figure D-7", "Sign in with a password", F.D7_SEQ_LOGIN)

    H(doc, "12.2 Submitting an idea", 2)
    figure(doc, "Figure D-8", "Submit an idea", F.D8_SEQ_SUBMIT)

    H(doc, "12.3 Reviewing and escalating", 2)
    figure(doc, "Figure D-9", "A decision, and what happens when nobody decides", F.D9_SEQ_APPROVAL)

    H(doc, "12.4 A business applying for a workspace", 2)
    figure(doc, "Figure D-10", "MSME registration and approval", F.D10_SEQ_REGISTER)

    H(doc, "12.5 Handing an idea to QCMS", 2)
    figure(doc, "Figure D-11", "Push an approved idea to QCMS", F.D11_SEQ_QCMS)

    # -- 13 -----------------------------------------------------------------
    H(doc, "13. Class and Module Structure", 1, page_break=True)
    para(doc, "The server is written in modules rather than classes, so this shows each module, "
              "what it offers to the rest of the system, and what it keeps to itself. The "
              "convention is the usual one: a plus sign means other modules may call it, a minus "
              "sign means it is internal.")
    figure(doc, "Figure D-12", "Service modules and their operations", F.D12_CLASS, legend=F.D12_LEGEND,
           note="Only the most significant modules are shown. There are 32 in total.")

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
