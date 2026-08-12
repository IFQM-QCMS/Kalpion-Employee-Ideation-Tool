# -*- coding: utf-8 -*-
"""Part B: architecture views. Sections 3 to 6, plus the architecture diagrams."""
import arch_figures as F


def build(doc, H, para, bullets, table, figure, fig):
    doc.add_page_break()
    H(doc, "PART B - ARCHITECTURE DIAGRAMS", 1)
    para(doc, "This part answers one question: what is the system made of, and where does each "
              "piece run. It does not describe behaviour - that is Part C. The two are kept apart "
              "on purpose, because mixing them is the usual reason architecture documents stop "
              "being readable.")

    # -- 3 ------------------------------------------------------------------
    H(doc, "3. Overall System Architecture", 1)

    H(doc, "3.1 The system in its surroundings", 2)
    para(doc, "The first diagram shows the system as a single box, with the people who use it and "
              "the outside services it talks to. It is the right place to start because it makes "
              "the boundary obvious: everything inside the box is ours to build and run, "
              "everything outside it is somebody else's.")
    figure(doc, "Figure A-1", "System context", F.A1_CONTEXT, legend=F.A1_LEGEND,
           note="Note the four outside services at the bottom. Every one of them is optional and "
                "is configured per customer. A customer can run the whole product with none of "
                "them connected, and many will.")

    H(doc, "3.2 The system opened up", 2)
    para(doc, "The second diagram opens the box. There are three places where code or data lives: "
              "the visitor's browser, the application server, and the database.")
    figure(doc, "Figure A-2", "Containers - what runs where", F.A2_CONTAINERS, legend=F.A2_LEGEND,
           note="The single most important thing on this diagram is on the right: one database for "
                "the registry, and then a completely separate database for every customer "
                "organisation. That is what makes it impossible for one customer to see another's "
                "information.")

    H(doc, "3.3 Why it is built this way", 2)
    table(doc, ["Principle", "What it means in practice", "Why"], [
        ["One database per customer",
         "Each organisation's people, ideas and files live in their own database. The registry "
         "only records which organisations exist and where each one lives.",
         "Separation you can point at. A mistake in a query cannot leak across customers, "
         "because the wrong data is not in the connection at all."],
        ["Rules in one layer",
         "All the business rules sit in the service layer. The web layer above only handles "
         "requests; the database layer below only fetches rows.",
         "The rules can be tested directly, and a new way of reaching the system cannot "
         "accidentally bypass them."],
        ["Never trust the session alone",
         "The signed-in user is read back from the database on every single request.",
         "Removing someone, changing their role or resetting their password takes effect "
         "immediately rather than up to eight hours later."],
        ["Decide on the server",
         "What a person may see is decided by the server. The screen is never the thing "
         "enforcing a rule.",
         "A restriction that only exists in the screen is not a restriction. Anyone can read "
         "what was sent to their own browser."],
        ["Fail closed on setup, fail open on measurement",
         "An unsafe configuration stops the server. A fault in logging or usage counting is "
         "written down and ignored.",
         "Running insecurely is worse than not running. But a fault in counting should never "
         "become an outage for the customer."],
        ["Schema changes are deliberate",
         "Deploying new code does not change the database. That is a separate, human step.",
         "Automatic schema changes on deploy are how data gets lost."],
    ], widths=[1.5, 2.6, 2.3], font_size=8.5)

    # -- 4 ------------------------------------------------------------------
    H(doc, "4. Architecture Description", 1, page_break=True)
    para(doc, "What each part is responsible for, and just as usefully, what it is not.")

    H(doc, "4.1 The screens", 2)
    table(doc, ["Component", "Responsible for", "Not responsible for"], [
        ["Single-page application",
         "Drawing 28 screens, collecting input, showing results, holding the signed-in session "
         "in the browser, and switching language.",
         "Deciding what anybody is allowed to see or do. It draws what it is given."],
        ["One API client file",
         "Every call to the server goes through a single file, which attaches the session token "
         "and the organisation to each request.",
         "Business rules. It is plumbing."],
    ], widths=[1.5, 2.9, 2.0], font_size=8.5)

    H(doc, "4.2 The server", 2)
    table(doc, ["Component", "Responsible for", "Not responsible for"], [
        ["Middleware chain",
         "Security headers, allowed origins, rate limiting, identifying the user, choosing the "
         "organisation's database, and counting usage. Runs before everything else.",
         "Anything specific to ideas, users or approvals."],
        ["Routes",
         "Mapping a web address to a piece of code, and naming which roles may reach it.",
         "Any rule beyond the role check."],
        ["Controllers",
         "Reading the request, calling one service, sending the reply.",
         "Business rules. A controller with an 'if' in it about ideas is a mistake."],
        ["Services",
         "All the actual rules: what a valid idea is, who reviews it next, who may read the "
         "text, what a score means, when to award points.",
         "Anything to do with HTTP. A service never sees the web request, which is why it can "
         "be tested on its own."],
        ["Database layer",
         "Holding one connection pool for the registry and one per organisation, and handing "
         "back the right one.",
         "Deciding who is allowed to use it."],
    ], widths=[1.3, 3.1, 2.0], font_size=8.5)

    H(doc, "4.3 The data", 2)
    table(doc, ["Component", "Responsible for", "Not responsible for"], [
        ["The registry",
         "Which organisations exist, which database each uses, IFQM staff accounts, the sign-in "
         "directory, one-time codes, support tickets, sign-in history and usage counters.",
         "Anything about an individual employee, or any idea. It is deliberately thin."],
        ["One database per organisation",
         "That organisation's people, ideas, votes, comments, approval history, files and "
         "settings. 17 tables, repeated per customer.",
         "Knowing that any other organisation exists."],
        ["Uploaded files",
         "Attachments on disk, one folder per organisation, served only through a checked "
         "download.",
         "Being reachable by a web address. There is no public link to a file."],
    ], widths=[1.5, 3.1, 1.8], font_size=8.5)

    # -- 5 ------------------------------------------------------------------
    H(doc, "5. Technology Stack", 1, page_break=True)
    para(doc, "What the system is built from, and why each choice was made. Versions are the ones "
              "in the project files today.")
    figure(doc, "Figure A-3", "Technology stack", F.A3_TECH_STACK, legend=F.A3_LEGEND)

    table(doc, ["Choice", "Why this one"], [
        ["React with Vite",
         "The screens are highly interactive - wizards, live filtering, overlays - which is what "
         "React is good at. Vite builds plain static files, so hosting the screens costs nothing "
         "and needs no server."],
        ["No UI framework",
         "The design is a small set of CSS tokens and 18 shared components. A framework would "
         "have added a large dependency and a house style that would then need overriding "
         "everywhere."],
        ["Node.js with Express",
         "The work is mostly waiting - on the database, on mail, on QCMS - which is exactly what "
         "Node is efficient at. Express is small enough that the whole request path can be read "
         "in one sitting."],
        ["MySQL",
         "The data is strongly relational: people report to people, ideas belong to people, "
         "approvals reference both. It is also the database Indian hosting providers support best "
         "and the one most local administrators already know."],
        ["Raw SQL, no ORM",
         "Multi-tenancy means picking a connection per request. An ORM would have added a layer "
         "between us and exactly the thing that matters most here, and hidden the queries that "
         "most need reviewing."],
        ["Signed tokens for sessions",
         "The API holds no session state, so it can be restarted or run on two machines without "
         "logging anybody out. The security cost - a token that stays valid after a change - is "
         "removed by re-reading the user on every request."],
        ["Scoring built in by default",
         "It works with no account, no API key and no cost, and no idea text leaves the system. "
         "An external provider is available but is off unless chosen."],
    ], widths=[1.7, 4.5], font_size=8.5)

    # -- 6 ------------------------------------------------------------------
    H(doc, "6. Module and Component Structure", 1, page_break=True)
    para(doc, "The server is organised in four layers plus a set of cross-cutting concerns. A "
              "request travels down the layers and the answer comes back up. No layer reaches "
              "past the one below it.")
    para(doc, "This section is the outside view - which layers exist and what belongs in each. "
              "Section 13 is the inside view of one of those layers: what a single module "
              "actually exports, what it keeps private, and which other modules it may call. "
              "The two are deliberately in different parts, because the first is a structural "
              "question and the second is a design one.", italic=True)
    figure(doc, "Figure A-4", "Modules and their dependencies", F.A4_MODULES, legend=F.A4_LEGEND,
           note="There are 35 services. They are grouped here by what they are about rather than "
                "alphabetically, because that is how somebody looking for one would think about "
                "it. Section 13.2 names all 35.")

    H(doc, "6.1 The rule that keeps this honest", 2)
    para(doc, "Every service takes a database connection as its first argument and never touches "
              "the web request. That one rule is what makes the services testable directly, and it "
              "is why a service cannot accidentally depend on who is calling it.")
    para(doc, "The clearest example is idea visibility. The rule about who may read a full "
              "proposal lives in one service function. The browse list, the detail screen and the "
              "idea board all call it. When the board was found to be bypassing it, the fix was to "
              "route it through the same function rather than to write the rule a second time.")

    H(doc, "6.2 Screens", 2)
    table(doc, ["Group", "No.", "Screens"], [
        ["Public", "3", "Landing page, sign in, apply for a workspace"],
        ["Employee", "11", "Dashboard, my ideas, submit, challenges, all ideas, rejected ideas, "
                           "idea board, leaderboard, profile, support, help"],
        ["Reviewer", "1", "Review queue"],
        ["Organisation admin", "4",
         "Admin panel (eight tabs: overview, ideas, users, hierarchy, categories, system, "
         "approved ideas, integration), analytics, audit trail, super admin"],
        ["IFQM platform", "7", "Organisations, one organisation in detail, registrations, plans "
                               "and billing, support tickets, sign-in activity, platform settings"],
        ["Everywhere else", "2", "The forced password change screen, and the page shown for an "
                                 "address that does not exist"],
    ], widths=[1.4, 0.4, 4.4], font_size=8.5,
        caption="Table 6.1  All 28 screens, grouped by who reaches them")
    para(doc, "Alongside those sit 18 shared components that are not screens in their own right: "
              "the idea detail overlay, assign reviewers, review action, bulk import, bulk "
              "archive, the reporting-line lookup, the charts, the billing banner, breadcrumbs "
              "and the rest.", italic=True)
