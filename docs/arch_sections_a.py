# -*- coding: utf-8 -*-
"""Part A of the architecture document: overview and requirements."""
from docx.enum.text import WD_ALIGN_PARAGRAPH


def build(doc, H, para, bullets, table, figure, fig):
    doc.add_page_break()
    H(doc, "PART A - OVERVIEW AND REQUIREMENTS", 1)

    # -- 1 ------------------------------------------------------------------
    H(doc, "1. System Overview and Objectives", 1)

    H(doc, "1.1 What the system is", 2)
    para(doc, "The IFQM Employee Ideation Tool is a web application that lets the staff of a "
              "business put forward ideas for improving how that business works, and then makes "
              "sure those ideas are actually looked at, decided on and followed through.")
    para(doc, "Most businesses already have some version of this. It is usually a suggestion box "
              "on a wall, a messaging group, or a form somebody filled in once. They almost always "
              "stop working, and they stop for the same three reasons. Nobody hears back, so people "
              "give up after the second try. Everything lands on one person's desk unsorted, so "
              "nothing gets read properly. And when an improvement does happen, nothing connects it "
              "back to whoever suggested it, so the whole scheme feels like goodwill rather than a "
              "result.")
    para(doc, "This system is built to fix those three things specifically. Every idea has a status "
              "the person who submitted it can see. Every idea is scored and sent to whoever should "
              "actually decide. When an idea is implemented, the saving is recorded against it and "
              "the person who raised it is credited.")

    H(doc, "1.2 Objectives", 2)
    table(doc, ["#", "Objective", "How we would know it worked"], [
        ["O1", "Make it easy enough that shop-floor staff actually use it",
         "Ideas arriving from people who are not office-based"],
        ["O2", "Make sure no idea sits without an answer",
         "Very few ideas past their review date"],
        ["O3", "Send each idea to the right person automatically",
         "Reviewers see only what is theirs to decide"],
        ["O4", "Make the value visible",
         "Savings recorded against implemented ideas, and reportable"],
        ["O5", "Keep each customer's data completely separate",
         "No path exists by which one customer can read another's data"],
        ["O6", "Protect the idea itself until it has been reviewed",
         "Full proposal text not readable by uninvolved colleagues"],
        ["O7", "Be runnable by a business with no IT department",
         "Setup is a working day, with no software to install"],
        ["O8", "Work in the languages people actually speak",
         "Seven languages, chosen per person"],
    ], widths=[0.4, 3.0, 2.9], font_size=9)

    H(doc, "1.3 Scope", 2)
    para(doc, "In scope: capturing ideas, scoring them, routing them for approval, tracking "
              "implementation and savings, rewarding contributors, reporting, running many "
              "customer organisations from one platform, and handing approved ideas to the QCMS "
              "tool.")
    para(doc, "Out of scope for this version: billing and invoicing; single sign-on with other "
              "IFQM tools; a native mobile application, since the screens already work in a phone "
              "browser; and any automatic feed of ideas from another system.")

    H(doc, "1.4 Who uses it", 2)
    table(doc, ["Who", "What they need from it", "Roughly how many"], [
        ["Employee", "Put forward an idea and see what happened to it", "Most of the headcount"],
        ["Reviewer or manager", "See what is waiting on them, decide, give a reason",
         "Perhaps one in eight"],
        ["Organisation administrator", "Run the scheme: people, rules, reports",
         "One or two per business"],
        ["IFQM platform administrator", "Run the product across all customers",
         "A handful, capped at five"],
        ["MSME applicant", "Apply for a workspace. Has no account yet", "Occasional"],
    ], widths=[1.6, 3.4, 1.3], font_size=9)

    # -- 2 ------------------------------------------------------------------
    H(doc, "2. Functional and Non-Functional Requirements", 1, page_break=True)
    para(doc, "Each requirement has an identifier so it can be traced through to the module that "
              "implements it and the test that covers it. Section 25 does that mapping.")

    H(doc, "2.1 Functional requirements - what it has to do", 2)
    table(doc, ["ID", "Requirement", "Priority"], [
        ["FR-01", "A person signs in with an email address or phone number and a password. Five "
                  "wrong attempts locks the account for fifteen minutes.", "Must"],
        ["FR-02", "A person can sign in instead with a one-time code sent to their phone.", "Should"],
        ["FR-03", "Somebody who forgets their password can reset it by email.", "Must"],
        ["FR-04", "Staff imported in bulk get a temporary password and must change it on first use.",
         "Must"],
        ["FR-05", "An employee submits an idea through a guided form covering the situation, the "
                  "proposed fix, the business case, attachments and colleagues who helped.", "Must"],
        ["FR-06", "The form warns about similar ideas that already exist.", "Should"],
        ["FR-07", "An idea can be saved as a draft, visible only to its author.", "Must"],
        ["FR-08", "Every submitted idea is scored out of 100 automatically.", "Must"],
        ["FR-09", "Ideas are sent to a reviewer, either up the reporting line or to a committee.",
         "Must"],
        ["FR-10", "An idea with no answer inside the agreed time moves up to the next approver.",
         "Must"],
        ["FR-11", "A reviewer approves, rejects or passes an idea onward, with a reason.", "Must"],
        ["FR-12", "Anyone looking at an idea can see whose desk it is on.", "Should"],
        ["FR-13", "Approved ideas get an owner and a target date, and their saving is recorded.",
         "Must"],
        ["FR-14", "Contributors earn points; a leaderboard shows the top contributors.", "Must"],
        ["FR-15", "Employees can vote and comment on each other's ideas.", "Should"],
        ["FR-16", "Time-limited challenges can be run to ask for ideas on one problem.", "Could"],
        ["FR-17", "Browse screens show a one-line summary of a solution, never the full text.",
         "Must"],
        ["FR-18", "Each organisation decides who may read the full text.", "Must"],
        ["FR-19", "An administrator can archive old ideas without deleting them.", "Should"],
        ["FR-20", "An idea can be marked for patentability, separately from its approval.", "Should"],
        ["FR-21", "Ideas export to spreadsheet and PDF, honouring the filters on screen.", "Must"],
        ["FR-22", "Rejected ideas have their own screen so they can be read as a set.", "Should"],
        ["FR-23", "Staff can be added in bulk from a spreadsheet.", "Must"],
        ["FR-24", "The reporting structure can be corrected from a downloadable spreadsheet.",
         "Should"],
        ["FR-25", "The user list can be filtered by role, department, status or manager.", "Should"],
        ["FR-26", "A business can apply for a workspace itself, from a work email address.", "Must"],
        ["FR-27", "Free and disposable email domains are refused at application.", "Must"],
        ["FR-28", "No workspace is created until IFQM approves the application.", "Must"],
        ["FR-29", "IFQM can create, pause and remove organisations.", "Must"],
        ["FR-30", "IFQM sees counts and totals only, never idea content.", "Must"],
        ["FR-31", "Sign-in activity is recorded and viewable by IFQM.", "Should"],
        ["FR-32", "Approved ideas can be handed to the QCMS tool.", "Should"],
        ["FR-33", "Each organisation sets its own branding, categories and approval chain.", "Must"],
        ["FR-34", "The interface is available in seven languages.", "Must"],
        ["FR-35", "Support tickets can be raised by a customer and answered by IFQM.", "Should"],
    ], widths=[0.55, 5.0, 0.65], font_size=8.5)

    H(doc, "2.2 Non-functional requirements - how well it has to do it", 2, page_break=True)
    table(doc, ["ID", "Area", "Requirement", "How it is met"], [
        ["NFR-01", "Separation", "One customer must never reach another's data",
         "A separate database per organisation. The connection is chosen from the signed-in "
         "session, so reaching another would mean opening the wrong database on purpose"],
        ["NFR-02", "Confidentiality", "Idea text must not be readable by uninvolved colleagues",
         "Browse lists never carry the full text. The detail screen filters by role and "
         "relationship. The rule is enforced by the server, not the screen"],
        ["NFR-03", "Access control", "Access ends at once when somebody is removed or demoted",
         "The user is read back from the database on every request rather than trusted from the "
         "session token"],
        ["NFR-04", "Passwords", "Passwords must not be recoverable",
         "Stored as bcrypt hashes. Resetting is the only route, by design"],
        ["NFR-05", "Transport", "Nothing sensitive travels in the clear",
         "HTTPS enforced, plain HTTP redirected, HSTS sent, database connections use TLS"],
        ["NFR-06", "Abuse", "One machine or one customer cannot exhaust the platform",
         "Rate limits per address, plus a request quota per organisation"],
        ["NFR-07", "Performance", "Screens should feel immediate at normal size",
         "Indexed queries, pagination, and lists capped at 100 rows"],
        ["NFR-08", "Scale", "Must cope with several thousand staff in one organisation",
         "Search, filtering and paging happen in the database. No screen loads a whole table"],
        ["NFR-09", "Availability", "A fault in a minor feature must not take the system down",
         "Logging, notifications and usage counting fail quietly and the request continues"],
        ["NFR-10", "Recoverability", "Data must survive a mistake or a failure",
         "Managed database with automatic backups and point-in-time recovery, plus a backup "
         "script for self-hosting"],
        ["NFR-11", "Auditability", "It must be possible to reconstruct what happened to an idea",
         "An append-only history on every idea, and a separate sign-in record"],
        ["NFR-12", "Usability", "Runnable by a business with no IT staff",
         "Everything is a screen in the app. 60 plain-English explanations sit beside the "
         "technical settings"],
        ["NFR-13", "Accessibility", "Usable by keyboard and readable on a phone",
         "Visible focus outlines, keyboard-reachable controls, layouts that reflow"],
        ["NFR-14", "Language", "Seven Indian languages",
         "All interface text is looked up by key. A missing translation falls back to English "
         "rather than breaking the screen"],
        ["NFR-15", "Portability", "Not tied to one hosting company",
         "Standard Node and MySQL. Which host is used is configuration, not code"],
        ["NFR-16", "Maintainability", "A new team must be able to take it over",
         "Rules live in one layer. A technical manual records the non-obvious decisions and why "
         "they were made"],
        ["NFR-17", "Privacy", "Collect only what is needed",
         "Aadhaar, bank details and full dates of birth are deliberately not collected"],
        ["NFR-18", "Safe defaults", "An insecure configuration must not start",
         "The server refuses to boot with a weak signing key, a blank database password, or "
         "developer settings left in production"],
    ], widths=[0.6, 0.85, 2.2, 2.65], font_size=8)
