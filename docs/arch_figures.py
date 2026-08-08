# -*- coding: utf-8 -*-
"""
Every diagram in the architecture document, as monospace art.

Kept in its own file so the diagrams can be reviewed on their own, and so a
correction to a diagram is a small, readable diff rather than a change buried
inside document-building code.

All of these were drawn from the repository as it stands. If the code changes,
these change with it.
"""

# ===========================================================================
#  PART B - ARCHITECTURE DIAGRAMS
#  "What the system is made of, and where each piece runs."
# ===========================================================================

A1_CONTEXT = r"""
                              PEOPLE WHO USE THE SYSTEM

   Employee            Reviewer /           Organisation        IFQM Platform
  (submits an          Manager              Administrator       Administrator
     idea)          (approves ideas)     (runs it for one org)  (runs the product)
       │                   │                     │                    │
       └─────────┬─────────┴──────────┬──────────┘                    │
                 │                    │                               │
                 ▼                    ▼                               ▼
   ┌──────────────────────────────────────────────┐   ┌────────────────────────┐
   │        IFQM EMPLOYEE IDEATION TOOL           │   │   PLATFORM CONSOLE     │
   │  Capture, score, route, approve, track and   │◄──┤  Create organisations, │
   │  reward workplace improvement ideas          │   │  approve applications, │
   └──────────────────────────────────────────────┘   │  see totals only       │
          │              │              │             └────────────────────────┘
          │              │              │
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ QCMS tool  │ │ Mail server│ │ SMS gateway│      Optional, per organisation.
   │ (approved  │ │ (notices,  │ │ (sign-in   │      The product works with none
   │  ideas go  │ │  password  │ │  codes)    │      of them connected.
   │  here)     │ │  resets)   │ │            │
   └────────────┘ └────────────┘ └────────────┘

   ┌────────────┐
   │ AI scoring │   Off by default. With no provider set, scoring runs inside
   │ provider   │   the application and no idea text leaves the system.
   └────────────┘
"""

A1_LEGEND = ("Boxes are systems. Arrows show who talks to whom. "
             "Dashed edges elsewhere in this document mean optional or not yet built.")

A2_CONTAINERS = r"""
  BROWSER                        │  APPLICATION SERVER            │  DATA
  ─────────────────────────────  │  ────────────────────────────  │  ────────────────────
                                 │                                │
  ┌───────────────────────────┐  │  ┌──────────────────────────┐  │  ┌─────────────────┐
  │  Single-page application  │  │  │  Express HTTP API        │  │  │  ifqm_master    │
  │  React 18 + Vite build    │──┼─►│  Node.js 18+             │──┼─►│  THE REGISTRY   │
  │                           │  │  │                          │  │  │                 │
  │  24 screens               │  │  │  Middleware chain        │  │  │ Which orgs      │
  │  7 languages              │  │  │   security headers       │  │  │ exist, IFQM     │
  │  All server calls go      │  │  │   CORS allow-list        │  │  │ staff, sign-in  │
  │  through one file         │  │  │   rate limit (per IP)    │  │  │ directory,      │
  │  (services/api.js)        │  │  │   authenticate + re-read │  │  │ tickets, quotas │
  │                           │  │  │   resolve organisation   │  │  └─────────────────┘
  │  Static files only -      │  │  │   meter quota (per org)  │  │
  │  no server-side rendering │  │  ├──────────────────────────┤  │  ┌─────────────────┐
  └───────────────────────────┘  │  │  Routes  (19 groups)     │  │  │  ifqm_<org 1>   │
              │                  │  │  Controllers (HTTP only) │──┼─►│  ONE PER        │
              │ HTTPS            │  │  Services (all the rules)│  │  │  ORGANISATION   │
              │ Bearer token     │  │  Database layer          │  │  ├─────────────────┤
              └──────────────────┼─►└──────────────────────────┘  │  │  ifqm_<org 2>   │
                                 │              │                 │  ├─────────────────┤
                                 │              ▼                 │  │  ifqm_<org 3>   │
                                 │  ┌──────────────────────────┐  │  └─────────────────┘
                                 │  │  Uploaded files on disk  │  │   People, ideas,
                                 │  │  one folder per org      │  │   votes, files.
                                 │  │  never web-accessible    │  │   Nothing shared.
                                 │  └──────────────────────────┘  │
"""

A2_LEGEND = ("Vertical lines separate the three places code and data live. "
             "Every arrow is HTTPS or a database connection over TLS.")

A3_TECH_STACK = r"""
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  PRESENTATION                                                              │
  │  React 18.3   Vite 5.4 (build)   React Router 6.27   Axios 1.7             │
  │  Plain CSS with design tokens - no UI framework, no CSS framework          │
  │  Seven languages: English, Hindi, Marathi, Kannada, Telugu, Tamil,         │
  │  Malayalam                                                                 │
  ├────────────────────────────────────────────────────────────────────────────┤
  │  APPLICATION                                                               │
  │  Node.js 18+ (tested on 22)      Express 4.19                              │
  │  Helmet (security headers)       express-rate-limit                        │
  │  jsonwebtoken 9 (sessions)       bcryptjs 2.4 (password hashing)           │
  │  Multer (uploads)                ExcelJS (spreadsheets)                     │
  │  PDFKit (documents)              Nodemailer (email)                        │
  ├────────────────────────────────────────────────────────────────────────────┤
  │  DATA                                                                      │
  │  MySQL 8 (or MariaDB in development)   mysql2 driver, prepared statements  │
  │  One schema for the registry + one schema per customer organisation        │
  │  Files on local disk, one folder per organisation                          │
  ├────────────────────────────────────────────────────────────────────────────┤
  │  OPTIONAL AND EXTERNAL                                                     │
  │  Scoring:  built in (default, nothing leaves) | OpenAI | Google Gemini     │
  │  Email:    any SMTP server, configured per organisation                    │
  │  SMS:      log (test only) | MSG91 | Twilio                                │
  │  Handover: QCMS integration API                                            │
  ├────────────────────────────────────────────────────────────────────────────┤
  │  RUNTIME AND TOOLING                                                       │
  │  Current hosting: Vercel (screens) + Render (API) + Aiven (MySQL)          │
  │  Recommended target: Microsoft Azure - see ADR-009                          │
  │  Source control: Git / GitHub.  Tests: Node built-in test runner            │
  └────────────────────────────────────────────────────────────────────────────┘
"""

A3_LEGEND = "Each band is a layer. A layer only talks to the one directly below it."

A4_MODULES = r"""
                        ┌───────────────────────────────┐
                        │        ROUTES  (19 groups)    │   Which web address maps
                        │  auth  ideas  users  votes    │   to which piece of code.
                        │  platform  registrations ...  │   No rules live here.
                        └───────────────┬───────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │       CONTROLLERS             │   Read the request, call
                        │  Nothing but request handling │   a service, send the reply.
                        └───────────────┬───────────────┘
                                        │
   ┌────────────────────────────────────▼─────────────────────────────────────┐
   │                      SERVICES  -  all the business rules                  │
   │                                                                           │
   │  IDENTITY              IDEAS                    ORGANISATION              │
   │  ├ authService         ├ ideaService            ├ platformService         │
   │  ├ otpService          ├ approvalStages         ├ platformSettings        │
   │  ├ smsService          ├ aiService (scoring)    ├ registrationService     │
   │  ├ directoryService    ├ votingService          ├ settingsService         │
   │  └ activityService     ├ commentService         ├ brandingService         │
   │                        ├ challengeService       └ supportService          │
   │  PEOPLE                ├ categoryService                                  │
   │  ├ userService         └ leaderboardService     OUTPUT AND HANDOVER       │
   │  ├ userImportService                            ├ exportService           │
   │  └ hierarchyTemplate   SHARED                   ├ ideaPdfService          │
   │                        ├ coreHelpers            ├ reportService           │
   │                        ├ mailerService          ├ integrationService      │
   │                        ├ notificationService    ├ qcmsService             │
   │                        └ hashPool               └ uploadService           │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │        DATABASE LAYER         │
                        │  master.js  - the registry    │
                        │  tenant.js  - one pool per    │
                        │               organisation    │
                        └───────────────────────────────┘

   CROSS-CUTTING (runs on every request, before the routes above)
   auth  -  who are you, are you still allowed in, which organisation
   rateLimiter  -  slow down one machine    tenantQuota  -  cap one organisation
   errorHandler -  turn any failure into a safe, plain reply
"""

A4_LEGEND = ("Top to bottom is the path of a request. A layer never reaches past "
             "the one below it; services never touch the web request directly.")

A5_DEPLOYMENT = r"""
  DEVELOPER MACHINE                     GITHUB                    HOSTS
  ────────────────────                  ──────                    ─────

  ┌──────────────────┐                                    ┌───────────────────────┐
  │ Screens on :5173 │                                    │ VERCEL                │
  │ API on :4000     │   git push    ┌──────────────┐     │ Serves the screens    │
  │ MySQL via XAMPP  │──────────────►│  main branch │────►│ Rebuilds on push      │
  └──────────────────┘               └──────────────┘     │ Free tier             │
                                            │             └───────────┬───────────┘
                                            │                         │ HTTPS
                                            │                         ▼
                                            │             ┌───────────────────────┐
                                            └────────────►│ RENDER                │
                                                          │ Runs the Node API     │
                                                          │ Rebuilds on push      │
                                                          │ Sleeps when idle      │
                                                          │ Disk is temporary (!) │
                                                          └───────────┬───────────┘
                                                                      │ TLS
                                                                      ▼
                                                          ┌───────────────────────┐
                                                          │ AIVEN                 │
                                                          │ MySQL 8, managed      │
                                                          │ Registry + one schema │
                                                          │ per organisation      │
                                                          └───────────────────────┘

  Database changes are NOT applied by a push. They are run deliberately, by a
  person, using "npm run migrate" against the target database. This is on
  purpose: an automatic schema change on deploy is how data gets lost.

  (!) The temporary disk is a known limitation. Uploaded files disappear when the
      API restarts while their database records survive, so an attachment can
      appear in a list and then fail to open. Moving files to object storage is
      the first task in the production plan - see section 21 and ADR-010.
"""

A5_LEGEND = "Arrows are automatic unless labelled otherwise."

A6_SECURITY = r"""
  LAYER 1  TRANSPORT
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HTTPS everywhere. Plain HTTP is redirected. HSTS header tells the browser│
  │ never to try plain HTTP again. Database connections use TLS.             │
  └──────────────────────────────────────────────────────────────────────────┘
  LAYER 2  WHO IS ASKING
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Password (bcrypt) or one-time code by SMS. Five wrong tries locks the    │
  │ account for 15 minutes. A signed token is issued for 8 hours - but the   │
  │ user is READ BACK FROM THE DATABASE ON EVERY REQUEST, so deactivating    │
  │ someone, changing their role or resetting their password takes effect at │
  │ once instead of whenever the token happens to expire.                    │
  └──────────────────────────────────────────────────────────────────────────┘
  LAYER 3  WHICH ORGANISATION
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ The organisation is resolved from the token, then a connection to THAT   │
  │ organisation's database is attached to the request. Reaching another     │
  │ organisation's data would require opening the wrong database on purpose. │
  └──────────────────────────────────────────────────────────────────────────┘
  LAYER 4  WHAT THEY MAY DO
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Eleven roles. Every sensitive route names the roles allowed, and the     │
  │ service checks again - so a new route that forgets the guard still fails │
  │ safely rather than opening a hole.                                       │
  └──────────────────────────────────────────────────────────────────────────┘
  LAYER 5  WHAT THEY MAY SEE
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Browse lists never carry the full text of an idea, for anybody. The      │
  │ detail screen shows it only to the author, their co-suggesters, the      │
  │ reviewers handling it, and managers. Each organisation chooses the rule. │
  │ The platform console can see counts, never content.                      │
  └──────────────────────────────────────────────────────────────────────────┘
  LAYER 6  WHAT IS STORED
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Passwords and one-time codes are hashed and cannot be read back. The     │
  │ QCMS key can be written and never read. Files are not web-addressable -  │
  │ every download is checked. Aadhaar, bank details and full dates of birth │
  │ are deliberately not collected.                                          │
  └──────────────────────────────────────────────────────────────────────────┘
"""

A6_LEGEND = "Each layer assumes the ones above it were passed. A request must clear all six."

A7_INTEGRATION = r"""
                        ┌──────────────────────────────┐
                        │   IFQM EMPLOYEE IDEATION     │
                        │           TOOL               │
                        └──┬────────┬────────┬─────┬───┘
             approved ideas│        │email   │SMS  │idea text
                           ▼        ▼        ▼     ▼
        ┌────────────────────┐ ┌─────────┐ ┌──────┐ ┌──────────────────┐
        │ QCMS               │ │ SMTP    │ │ SMS  │ │ AI provider      │
        │                    │ │ server  │ │gate- │ │                  │
        │ Push, one idea at  │ │         │ │way   │ │ OpenAI or Gemini │
        │ a time, on approval│ │Notices, │ │      │ │                  │
        │ Key per org, write-│ │password │ │Sign- │ │ OFF BY DEFAULT.  │
        │ only               │ │resets   │ │in    │ │ With no provider │
        │ Duplicate push is  │ │         │ │codes │ │ set, scoring runs│
        │ treated as success │ │Per org  │ │      │ │ locally and NO   │
        │                    │ │         │ │MSG91 │ │ IDEA TEXT LEAVES │
        │ Outbound only -    │ │Optional │ │or    │ │ THE SYSTEM.      │
        │ QCMS never calls us│ │         │ │Twilio│ │                  │
        └────────────────────┘ └─────────┘ └──────┘ └──────────────────┘

  Every one of these is optional and configured per organisation. The product is
  fully usable with none of them connected; each simply switches off the feature
  it powers. Nothing external can call into the system - all four are outbound.
"""

A7_LEGEND = "Arrows point the way data travels. There are no inbound integrations."


# ===========================================================================
#  PART C - DETAILED DESIGN DIAGRAMS
#  "How the system behaves, step by step."
# ===========================================================================

D1_WORKFLOW = r"""
   ┌──────────┐   writes    ┌─────────────────────────────────────────────┐
   │ Employee │────────────►│ SUBMISSION WIZARD                           │
   └──────────┘             │ 1 title + situation   2 solution + tags     │
                            │ 3 business case       4 files               │
                            │ 5 colleagues          6 review and send     │
                            └───────────────┬─────────────────────────────┘
                                            │ warns about similar ideas
                                            ▼
                                     ┌─────────────┐   saved but not sent.
                                     │  DRAFT      │   Only the author sees it.
                                     └──────┬──────┘
                                            │ submit
                                            ▼
                            ┌───────────────────────────────┐
                            │ SCORED 0-100 automatically    │  +10 points
                            │ Clock starts for the reviewer │
                            └───────────────┬───────────────┘
                                            ▼
                                     ┌─────────────┐
                                     │  SUBMITTED  │
                                     └──────┬──────┘
                     ┌─────────────────────┴──────────────────────┐
                     ▼                                            ▼
        ┌────────────────────────┐                  ┌────────────────────────┐
        │ ONE REVIEWER AT A TIME │                  │ A COMMITTEE TOGETHER   │
        │ goes up the reporting  │                  │ a set share must agree │
        │ line                   │                  │                        │
        └───────────┬────────────┘                  └───────────┬────────────┘
                    └──────────────────┬─────────────────────────┘
                                       ▼
                              ┌─────────────────┐
                              │  UNDER REVIEW   │◄──── no answer in time?
                              └────────┬────────┘      moves up a level
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
              ┌─────────────┐                     ┌─────────────┐
              │  REJECTED   │                     │  APPROVED   │ +25 points
              │ reason kept │                     └──────┬──────┘
              └─────────────┘                            ▼
                                            ┌────────────────────────┐
                                            │ Owner and target date  │
                                            └───────────┬────────────┘
                                                        ▼
                                            ┌────────────────────────┐
                                            │  IMPLEMENTED  +65 pts  │
                                            │  Savings recorded      │
                                            └───────────┬────────────┘
                                                        ▼
                                            ┌────────────────────────┐
                                            │ Handed to QCMS, if the │
                                            │ organisation uses it   │
                                            └────────────────────────┘
"""

D1_LEGEND = "Rounded outcomes are the six states an idea can be in. Points are awarded once, at each step."

D2_DFD0 = r"""
   LEVEL 0  -  the whole system as one process

    ┌──────────┐                                              ┌──────────┐
    │ Employee │──── idea, votes, comments ─────┐    ┌───────►│ Reviewer │
    └──────────┘                                │    │        └──────────┘
                                                ▼    │ list of ideas to judge
    ┌──────────┐                        ┌───────────────────┐
    │   Org    │── people, settings ───►│                   │──── reports, exports ──►
    │  Admin   │◄─ reports, exports ────│   IFQM EMPLOYEE   │
    └──────────┘                        │   IDEATION TOOL   │
                                        │                   │
    ┌──────────┐                        │                   │──── approved ideas ───►┌──────┐
    │  IFQM    │── new organisations ──►│                   │                        │ QCMS │
    │ Platform │◄─ counts only ─────────│                   │                        └──────┘
    │  Admin   │                        └─────────┬─────────┘
    └──────────┘                                  │
                                                  │ notices, codes
                                                  ▼
                                        ┌───────────────────┐
                                        │ Email / SMS       │
                                        └───────────────────┘
"""

D2_LEGEND = "Squares are people or outside systems. The rounded box is the system. Arrows are data."

D3_DFD1 = r"""
   LEVEL 1  -  inside the system

   ┌──────────┐
   │ Employee │
   └────┬─────┘
        │ sign in
        ▼
   ┌──────────────┐   who are you,      ┌────────────────────────┐
   │ 1. IDENTIFY  │◄─ which org ───────►│ D1  REGISTRY           │
   │    THE USER  │                     │ orgs, staff, sign-in   │
   └────┬─────────┘                     │ directory, codes       │
        │ session                       └────────────────────────┘
        ▼
   ┌──────────────┐   idea text          ┌────────────────────────┐
   │ 2. CAPTURE   │─────────────────────►│ D2  THIS ORG'S DATA    │
   │    THE IDEA  │◄── similar ideas ────│ people, ideas, votes,  │
   └────┬─────────┘                      │ files, settings        │
        │ new idea                       └───────┬────────────────┘
        ▼                                        │      ▲
   ┌──────────────┐  score + reason               │      │
   │ 3. SCORE IT  │──────────────────────────────►│      │
   └────┬─────────┘                               │      │
        │                                         │      │
        ▼                                         ▼      │
   ┌──────────────┐  who decides next   ┌────────────────┴───────┐
   │ 4. ROUTE FOR │◄───────────────────►│ D3  APPROVAL SETTINGS  │
   │    APPROVAL  │                     │ chain, thresholds, SLA │
   └────┬─────────┘                     └────────────────────────┘
        │ decision needed
        ▼
   ┌──────────────┐   decision           ┌──────────┐
   │ 5. RECORD    │◄─────────────────────│ Reviewer │
   │    DECISION  │                      └──────────┘
   └────┬─────────┘
        │ approved / rejected / implemented
        ├──────────────► D2 (status, history, points)
        │
        ▼
   ┌──────────────┐
   │ 6. REWARD    │──── points, ranking ───► D2
   │    AND REPORT│──── exports, PDFs ─────► Org Admin
   └────┬─────────┘
        │ approved ideas
        ▼
   ┌──────────────┐
   │ 7. HAND OVER │──────────────────────► QCMS
   └──────────────┘
"""

D3_LEGEND = "Numbered boxes are processes. D1, D2, D3 are stores of data. Arrows are named with what flows."

D4_ER_MASTER = r"""
   THE REGISTRY  (ifqm_master)  -  shared by everybody, holds as little as possible

   ┌────────────────────────────┐          ┌─────────────────────────────┐
   │ tenants                    │          │ tenant_registrations        │
   ├────────────────────────────┤          ├─────────────────────────────┤
   │ PK id                      │◄────────┤ PK id                        │
   │    name, slug, domain      │  becomes │    company_name, email_domain│
   │    db_name  (which schema) │          │    udyam_number, gstin, pan  │
   │    status  active|on hold  │          │    entity_type, category     │
   │    last_login_at           │          │    nic_code, employees       │
   │    api_quota_total/monthly │          │    address, contact person   │
   │    storage_quota_mb        │          │    status pending|approved|  │
   └───────┬────────────────────┘          │           rejected           │
           │                               │ FK tenant_id (once approved) │
           │ 1 : many                      └─────────────────────────────┘
           ▼
   ┌────────────────────────────┐   ┌──────────────────────────┐
   │ tenant_api_usage           │   │ platform_admins          │
   ├────────────────────────────┤   ├──────────────────────────┤
   │ PK tenant_id + period      │   │ PK id                    │
   │    request_count           │   │    name, email           │
   └────────────────────────────┘   │    password_hash         │
                                    └──────────┬───────────────┘
   ┌────────────────────────────┐              │ assigned to
   │ login_directory            │              ▼
   ├────────────────────────────┤   ┌──────────────────────────┐
   │ PK identifier (email/phone)│   │ support_tickets          │
   │    tenant_slug, user_id    │   ├──────────────────────────┤
   └────────────────────────────┘   │ PK id, ticket_code       │
   Lets somebody sign in without    │ FK tenant_id, assignee_id│
   typing an organisation code.     │    status, priority      │
                                    │    archived_at           │
   ┌────────────────────────────┐   └──────────┬───────────────┘
   │ login_otps                 │              │ 1 : many
   ├────────────────────────────┤              ▼
   │ PK id                      │   ┌──────────────────────────┐
   │    identifier, code_hash   │   │ support_ticket_messages  │
   │    attempts, expires_at    │   └──────────────────────────┘
   │    consumed_at             │
   └────────────────────────────┘   ┌──────────────────────────┐
   Codes are hashed, single use.    │ platform_login_activity  │
                                    │ who signed in, when,     │
   ┌────────────────────────────┐   │ from where, success or   │
   │ login_attempts             │   │ failure. Kept 180 days.  │
   │ lockout counter only,      │   └──────────────────────────┘
   │ cleared on success         │
   └────────────────────────────┘   ┌──────────────────────────┐
                                    │ platform_settings        │
                                    │ platform-wide defaults   │
                                    └──────────────────────────┘
"""

D4_LEGEND = "PK = the column that identifies a row. FK = a pointer to another table."

D5_ER_TENANT = r"""
   ONE ORGANISATION  (ifqm_<code>)  -  repeated once per customer, never shared

   ┌──────────────────────────┐
   │ users                    │
   ├──────────────────────────┤
   │ PK id                    │
   │    employee_id  (unique) │
   │    salutation, first_name│
   │    last_name, name       │
   │    email (unique), phone │
   │    password_hash         │
   │    role  (11 values)     │
   │ FK manager_id ──────────┐│  reports to another row
   │    department, location  ││  in this same table
   │    year_of_birth         ││
   │    points, status        ││
   └───┬──────────────────────┘│
       │◄─────────────────────┘
       │ 1 : many  (submits)
       ▼
   ┌───────────────────────────────────────┐        ┌──────────────────────────┐
   │ ideas                                 │        │ idea_categories          │
   ├───────────────────────────────────────┤        │ per-organisation list    │
   │ PK id, idea_code (unique)             │        └──────────────────────────┘
   │    title                              │
   │    present_situation, proposed_solution│       ┌──────────────────────────┐
   │    impact_areas, impact_level          │       │ challenges               │
   │    tangible / intangible_benefit       │◄──FK──│ time-limited campaigns   │
   │    investment_required, feasibility    │       └──────────────────────────┘
   │    time_required  <3m | 3-6m | 6-12m   │
   │    solution_tags  process|quality|     │       ┌──────────────────────────┐
   │                   cost|delivery        │       │ org_settings             │
   │    ai_score, ai_reason                 │       │ key/value. Approval chain│
   │    status  Draft|Submitted|Under Review│       │ SLA, visibility rules,   │
   │            Approved|Rejected|Implemented│      │ SMTP, feature switches   │
   │    patentability, patentability_note   │       └──────────────────────────┘
   │    archived_at, archived_by            │
   │    roi_value, roi_type                 │       ┌──────────────────────────┐
   │    qcms_pushed_at, qcms_push_status    │       │ notifications            │
   │ FK submitter_id, current_reviewer_id   │       │ email_queue              │
   │ FK co_suggester_1_id, co_suggester_2_id│       │ password_reset_tokens    │
   └──┬───────┬───────┬────────┬────────┬───┘       │ user_import_jobs         │
      │       │       │        │        │           │ user_import_errors       │
      ▼       ▼       ▼        ▼        ▼           └──────────────────────────┘
   ┌──────┐┌──────┐┌───────┐┌────────┐┌──────────────┐
   │attach││votes ││comment││workflow││ reviewers    │
   │ments ││ +    ││s      ││ every  ││ who is on    │
   │file  ││commu-││thread-││ status ││ the committee│
   │names ││nity  ││ed     ││ change ││ and their    │
   │      ││votes ││       ││ ever   ││ decision     │
   └──────┘└──────┘└───────┘└────────┘└──────────────┘
                              append-only:
                              the audit trail

   ┌──────────────────────────┐
   │ idea_co_suggesters       │  many-to-many: an idea can credit any number of
   │ idea_id + user_id        │  colleagues, beyond the two legacy columns above
   └──────────────────────────┘
"""

D5_LEGEND = "17 tables per organisation. Every one of them exists once per customer, in a separate database."

D6_USECASE = r"""
                    ┌──────────────────────────────────────────────┐
                    │        IFQM EMPLOYEE IDEATION TOOL           │
                    │                                              │
   ┌──────────┐     │   ( Sign in - password or one-time code )    │
   │ Employee │─────┼──►( Submit an idea )                         │
   │          │     │   ( Save a draft )                           │
   │          │─────┼──►( Browse ideas / the board )               │
   │          │     │   ( Vote and comment )                       │
   │          │─────┼──►( See the leaderboard )                    │
   │          │     │   ( Track my own ideas )                     │
   └──────────┘     │   ( Export an idea as PDF )                  │
                    │                                              │
   ┌──────────┐     │   ( Review the queue )                       │
   │ Reviewer │─────┼──►( Approve, reject or send onward )         │
   │ Manager  │     │   ( Assign a committee )                     │
   │          │─────┼──►( Read the full proposal )                 │
   └──────────┘     │                                              │
                    │   ( Add and import employees )               │
   ┌──────────┐     │   ( Set the approval chain )                 │
   │ Org      │─────┼──►( Set who can read solutions )             │
   │ Admin    │     │   ( Archive old ideas )                      │
   │          │─────┼──►( Record patentability )                   │
   │          │     │   ( Export CSV / PDF, run analytics )        │
   │          │─────┼──►( Configure email, branding, QCMS )        │
   └──────────┘     │   ( Fix the reporting structure )            │
                    │                                              │
   ┌──────────┐     │   ( Approve or reject an MSME application )  │
   │ IFQM     │─────┼──►( Create an organisation )                 │
   │ Platform │     │   ( Put an organisation on hold )            │
   │ Admin    │─────┼──►( See totals and sign-in activity )        │
   │          │     │   ( Handle support tickets )                 │
   └──────────┘     │   ( Set platform-wide limits )               │
                    │                                              │
   ┌──────────┐     │                                              │
   │ MSME     │─────┼──►( Apply for a workspace )                  │
   │ applicant│     │      (no account needed)                     │
   └──────────┘     └──────────────────────────────────────────────┘

   Each role also inherits everything the roles above it can do, except that the
   IFQM Platform Admin is deliberately OUTSIDE the organisation and can never see
   idea content.
"""

D6_LEGEND = "Stick-figure equivalents are on the left. Round brackets are things the system does."

D7_SEQ_LOGIN = r"""
   USE CASE: sign in with a password

   Browser        API           Registry        Organisation DB
      │            │                │                  │
      │ email +    │                │                  │
      │ password   │                │                  │
      ├───────────►│                │                  │
      │            │ locked out?    │                  │
      │            ├───────────────►│                  │
      │            │◄───────────────┤ no               │
      │            │                │                  │
      │            │ IFQM staff?    │                  │
      │            ├───────────────►│                  │
      │            │◄───────────────┤ no               │
      │            │                │                  │
      │            │ which org owns │                  │
      │            │ this email?    │                  │
      │            ├───────────────►│                  │
      │            │◄───────────────┤ org "acme"       │
      │            │                │                  │
      │            │ fetch the user ──────────────────►│
      │            │◄──────────────────────────────────┤
      │            │                │                  │
      │            │ compare password with the stored  │
      │            │ hash  (always runs, even when the │
      │            │ user does not exist, so timing    │
      │            │ cannot reveal who works here)     │
      │            │                │                  │
      │            │ record the sign-in                │
      │            ├───────────────►│                  │
      │            │ stamp org's last_login_at         │
      │            ├───────────────►│                  │
      │◄───────────┤ session token + profile           │
      │            │                │                  │

   If the password is wrong: the failure is counted, the message says how many
   tries remain, and five failures lock the account for fifteen minutes.
"""

D8_SEQ_SUBMIT = r"""
   USE CASE: submit an idea

   Employee     Screens        API          Scoring       Organisation DB
      │            │            │              │                │
      │ types title│            │              │                │
      ├───────────►│ check for  │              │                │
      │            │ similar    │              │                │
      │            ├───────────►│──────────────────────────────►│
      │            │◄───────────┤◄──────────────────────────────┤
      │◄───────────┤ "3 similar ideas exist"    │                │
      │            │            │              │                │
      │ finishes   │            │              │                │
      │ all 6 steps│            │              │                │
      ├───────────►│  submit    │              │                │
      │            ├───────────►│              │                │
      │            │            │ score it     │                │
      │            │            ├─────────────►│                │
      │            │            │◄─────────────┤ 78 / 100 and   │
      │            │            │              │ the reasoning  │
      │            │            │                               │
      │            │            │ save the idea ───────────────►│
      │            │            │ work out who reviews it ─────►│
      │            │            │ set the clock ───────────────►│
      │            │            │ award 10 points ─────────────►│
      │            │            │ write the history entry ─────►│
      │            │            │ notify the reviewer ─────────►│
      │            │◄───────────┤ idea code EIT-0142            │
      │◄───────────┤ confirmed  │              │                │

   Everything after "save the idea" happens in one pass. If any of it fails the
   employee is told the submission failed, rather than being left with an idea
   that exists but has nobody to review it.
"""

D9_SEQ_APPROVAL = r"""
   USE CASE: a reviewer makes a decision, and escalation

   Reviewer       API         Approval rules      Organisation DB
      │            │               │                    │
      │ opens the  │               │                    │
      │ queue      │               │                    │
      ├───────────►│ ideas waiting on me ──────────────►│
      │◄───────────┤◄───────────────────────────────────┤
      │            │               │                    │
      │ APPROVE    │               │                    │
      ├───────────►│ am I the final approver?           │
      │            ├──────────────►│                    │
      │            │◄──────────────┤ no - one more level│
      │            │               │                    │
      │            │ find the next person up ──────────►│
      │            │ move the idea to them ────────────►│
      │            │ write the history entry ──────────►│
      │            │ notify them ──────────────────────►│
      │◄───────────┤ "sent to the Plant Head"           │
      │            │               │                    │
      ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
      │            │               │                    │
      │ Plant Head APPROVE          │                    │
      ├───────────►│ am I the final approver?           │
      │            ├──────────────►│                    │
      │            │◄──────────────┤ YES                │
      │            │ mark Approved ───────────────────►│
      │            │ award 25 points ─────────────────►│
      │            │ notify the author ───────────────►│
      │◄───────────┤ closed                             │

   NOBODY ANSWERS IN TIME
      A daily check finds ideas past their escalation date and moves them up one
      level on their own, so an idea cannot sit forever because one person is on
      leave.
"""

D10_SEQ_REGISTER = r"""
   USE CASE: an MSME applies, and IFQM approves

   Applicant     Public form      API         Registry      New database
      │              │             │             │               │
      │ types work   │             │             │               │
      │ email        ├────────────►│ is this a company domain?   │
      │              │◄────────────┤ yes                         │
      │              │             │             │               │
      │ fills in the │             │             │               │
      │ business     │             │             │               │
      │ details      ├────────────►│ check and store ───────────►│
      │              │             │             │ status:       │
      │              │             │             │ PENDING       │
      │◄─────────────┤ "REG-14. We will email you"               │
      │              │             │             │               │
      ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   IFQM Platform Admin
      │              │             │             │               │
      │ opens Registrations, reads every field   │               │
      ├────────────────────────────►│◄───────────┤               │
      │ APPROVE, confirms the org code           │               │
      ├────────────────────────────►│            │               │
      │              │             │ create the database ───────►│
      │              │             │ build all 17 tables ───────►│
      │              │             │ create the first admin ────►│
      │              │             │ register the org ──────────►│
      │◄────────────────────────────┤ temporary password,        │
      │              │             │ SHOWN ONCE ONLY             │
      │ passes it to the applicant out of band   │               │
      │              │             │             │               │
   Applicant signs in, is forced to change the password, imports staff.

   Nothing is created until the APPROVE step. A thousand junk applications would
   produce a long list to read and nothing else.
"""

D11_SEQ_QCMS = r"""
   USE CASE: hand an approved idea to QCMS

   Org Admin      API        Organisation DB      QCMS
      │            │                │              │
      │ Approved   │                │              │
      │ Ideas tab  │                │              │
      ├───────────►│ approved, not yet sent ──────►│
      │◄───────────┤◄───────────────┤              │
      │            │                │              │
      │ PUSH       │                │              │
      ├───────────►│ read this org's key ─────────►│
      │            │◄───────────────┤              │
      │            │                │              │
      │            │ send the idea ──────────────►│
      │            │◄─────────────────────────────┤ 201 created
      │            │                │              │
      │            │ record when and the result ──►│
      │◄───────────┤ "Sent"         │              │

   IF QCMS SAYS THE IDEA IS ALREADY THERE
      Some versions report a duplicate as a server error. That is treated as
      SUCCESS, not failure - the idea has arrived, which is the thing that
      matters, and retrying would create a second copy.
"""

D12_CLASS = r"""
   The code is organised in modules rather than classes, so this shows the shape
   of each service and what it is responsible for. Every service takes a database
   connection as its first argument and never touches the web request - which is
   why they can be tested directly.

   ┌────────────────────────────────┐        ┌────────────────────────────────┐
   │ authService                    │        │ ideaService                    │
   ├────────────────────────────────┤        ├────────────────────────────────┤
   │ + login(email, password, org)  │        │ + list(db, user, filters)      │
   │ + forgotPassword(email)        │        │ + get(db, user, id)            │
   │ + resetPassword(token, new)    │        │ + submitOrDraft(db, user, ...) │
   │ + changePassword(user, old,new)│        │ + reviewAction(db, user, ...)  │
   │ + assertPasswordStrength(pw)   │        │ + setArchived(db, user, ...)   │
   │ - recordFailedAttempt(id)      │        │ + setPatentability(db, ...)    │
   │ - clearFailedAttempts(id)      │        │ - canReadSolution(user, idea)  │
   └────────────────────────────────┘        │ - redactSolution(user, idea)   │
                                             │ - summariseSolution(text)      │
   ┌────────────────────────────────┐        └────────────────────────────────┘
   │ otpService                     │
   ├────────────────────────────────┤        ┌────────────────────────────────┐
   │ + requestOtp(identifier)       │        │ approvalStages                 │
   │ + verifyOtp(identifier, code)  │        ├────────────────────────────────┤
   │ + otpStatus()                  │        │ + parseStages(csv)             │
   │ - generateCode(length)         │        │ + stagesToChain(stages)        │
   │ - policy()                     │        │ + approverStages(stages)       │
   └────────────────────────────────┘        │   STAGE_CATALOG                │
             │ uses                          │   DEFAULT_FINAL_ROLES          │
             ▼                               └────────────────────────────────┘
   ┌────────────────────────────────┐
   │ smsService                     │        ┌────────────────────────────────┐
   ├────────────────────────────────┤        │ platformService                │
   │ + sendSms(phone, message)      │        ├────────────────────────────────┤
   │ - sendViaMsg91(...)            │        │ + tenants()                    │
   │ - sendViaTwilio(...)           │        │ + createTenant(body)           │
   │ - maskPhone(v)                 │        │ + updateTenant(id, body)       │
   └────────────────────────────────┘        │ + deleteTenant(id, body)       │
   One interface, three providers, so         │ - safeTenant(row)  strips      │
   changing supplier is a setting.            │   database credentials         │
                                             │ - activityOf(tenant)           │
   ┌────────────────────────────────┐        └────────────────────────────────┘
   │ registrationService            │
   ├────────────────────────────────┤        ┌────────────────────────────────┐
   │ + submitRegistration(body)     │        │ userImportService              │
   │ + listRegistrations(status)    │        ├────────────────────────────────┤
   │ + approveRegistration(id)      │───────►│ + buildTemplate(role)          │
   │ + rejectRegistration(id, note) │ creates│ + preview(db, actor, file)     │
   │ - checkCorporateEmail(email)   │  a new │ + startImport(db, actor, file) │
   │ - validateApplication(body)    │  tenant│ - parseBirth(raw)              │
   └────────────────────────────────┘        │ - tempPasswordFor(name, year)  │
                                             └────────────────────────────────┘
   Convention:  +  called from outside the module
                -  internal to the module
"""

D12_LEGEND = "Boxes are modules. Lines show which module calls which."

D13_SCREENFLOW = r"""
                        ┌──────────────────────────┐
                        │  /  LANDING PAGE         │  Public. Explains the
                        │  What it does, pricing,  │  product to a business
                        │  FAQ, savings estimator  │  that has never seen it.
                        └───┬──────────────────┬───┘
                  Sign in   │                  │  Register
                            ▼                  ▼
           ┌────────────────────────┐   ┌────────────────────────┐
           │ /login                 │   │ /signup                │
           │ Email or phone +       │   │ 3 steps. Work email    │
           │ password, OR a one-    │   │ checked as you type.   │
           │ time code by SMS       │   │ Waits for approval.    │
           └───────────┬────────────┘   └────────────────────────┘
                       │ signed in - the screen you land on depends on your role
      ┌────────────────┼─────────────────────────┬──────────────────────┐
      ▼                ▼                         ▼                      ▼
 ┌──────────┐  ┌──────────────┐        ┌─────────────────┐   ┌──────────────────┐
 │EMPLOYEE  │  │REVIEWER      │        │ ORG ADMIN       │   │ IFQM PLATFORM    │
 │/dashboard│  │/review       │        │ /admin          │   │ /platform        │
 ├──────────┤  ├──────────────┤        ├─────────────────┤   ├──────────────────┤
 │My ideas  │  │Queue with the│        │Overview         │   │Organisations     │
 │Submit    │  │clock showing │        │Idea management  │   │Registrations     │
 │Challenges│  │what is late  │        │User list        │   │Support tickets   │
 │All ideas │  │              │        │Hierarchy        │   │Settings          │
 │Rejected  │  │Approve /     │        │Categories       │   │                  │
 │Board     │  │Reject /      │        │System settings  │   │Counts only -     │
 │Leader-   │  │Send onward   │        │Approved ideas   │   │never idea        │
 │board     │  │              │        │API and QCMS     │   │content           │
 └────┬─────┘  └──────┬───────┘        └────────┬────────┘   └──────────────────┘
      │               │                         │
      └───────────────┴─────────────────────────┘
                      │
                      ▼
           ┌──────────────────────────┐
           │  IDEA DETAIL (overlay)   │  Opens over whatever screen you were on,
           │  Details | History |     │  so you keep your place in the list.
           │  Attachments             │
           └──────────────────────────┘
"""

D13_LEGEND = "Boxes are screens. The path from the landing page to a signed-in screen is the same for everybody."

D14_WIREFRAMES = r"""
   SUBMIT AN IDEA  (/submit)                    ALL IDEAS  (/all-ideas)
   ┌────────────────────────────────┐  ┌──────────────────────────────────────────┐
   │ 1─2─3─4─5─6   step 3 of 6      │  │ [search    ] [status ▾] [impact ▾] [ ]arc│
   │                                │  │                        [Export CSV][PDF] │
   │ Investment required            │  ├──────────────────────────────────────────┤
   │ [__________________]  (i)      │  │ CODE  TITLE      SOLUTION   WHO   ...    │
   │                                │  ├──────────────────────────────────────────┤
   │ Feasibility (i)                │  │ E-141 Cut change  Pre-stage  Ravi  [View]│
   │ [ Low ][ Medium ][ High ]      │  │       -over time  trolley…            │
   │  red    amber    green         │  │ E-142 Reuse       Fold and   Sunita[View]│
   │                                │  │       cartons     reuse… [s]            │
   │ Time required (i)              │  └──────────────────────────────────────────┘
   │ [ Less than 3 months      ▾]   │  [s] marks a solution shown only as a summary.
   │                                │
   │ Solution category (i)          │  LEADERBOARD  (/leaderboard)
   │ (Process) (Quality) (Cost)     │  ┌──────────────────────────────────────────┐
   │ (Delivery)                     │  │        [trophy]                          │
   │                                │  │   [2nd]  ┌────┐  [3rd]      1st in the   │
   │ * marks a required field, in   │  │   ┌───┐  │1st │  ┌───┐      middle and   │
   │   red                          │  │   │   │  │    │  │   │      tallest      │
   │                                │  │   └───┘  └────┘  └───┘                   │
   │        [ Back ]  [ Continue ]  │  ├──────────────────────────────────────────┤
   └────────────────────────────────┘  │ 4. Meena Rao        Production   210 pts │
                                       │ 5. Arun Kumar       Quality      185 pts │
   (i) is the small information button  └──────────────────────────────────────────┘
   that explains the term in plain
   English. There are 60 of them.       PLATFORM CONSOLE  (/platform)
                                        ┌─────────────────────────────────────────┐
   IDEA DETAIL (overlay)                │ [Orgs 12][Active 10][On Hold 2][Ideas…] │
   ┌────────────────────────────────┐   ├─────────────────────────────────────────┤
   │ #EIT-0142  Cut die-change time │   │ COMPANY   ADMIN   USERS IDEAS QCMS  … ⋮ │
   │ Details | History | Files      │   │ Acme Ltd  P.Nair    85    42    12    ⋮ │
   ├────────────────────────────────┤   │ Vertex    R.Shah    40    18     4    ⋮ │
   │ Under review by A. Kumar       │   └─────────────────────────────────────────┘
   │                                │   Status and Activity are separate columns:
   │ Situation                      │   one is what IFQM did, the other is what
   │ [text]                         │   the organisation has been doing.
   │                                │
   │ Solution                       │
   │ [first sentence only]          │
   │ [s] Only a summary is shown     │
   │                                │
   │ Patentability [Not assessed ▾] │
   │ [ Archive ]                    │
   └────────────────────────────────┘
"""

D14_LEGEND = "Rough layouts, not final visuals. Square brackets are controls."

D15_ERRORS = r"""
   Something goes wrong
            │
            ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ Is this an EXPECTED problem, or an unexpected failure?           │
   └───────────────┬──────────────────────────────┬───────────────────┘
      EXPECTED     │                              │  UNEXPECTED
      (we wrote    ▼                              ▼  (a bug, or the
       this rule)  ┌──────────────────┐   ┌────────────────────┐  database
                   │ Known error with │   │ Anything else      │  is down)
                   │ a code and a     │   │                    │
                   │ human message    │   │ Written to the log │
                   ├──────────────────┤   │ in full, with the  │
                   │ 400 you sent     │   │ stack trace        │
                   │     something    │   │                    │
                   │     invalid      │   │ The user is told   │
                   │ 401 not signed in│   │ only "Something    │
                   │ 403 not allowed  │   │ went wrong"        │
                   │ 404 not found    │   │                    │
                   │ 409 clashes with │   │ WHY: the raw error │
                   │     something    │   │ names tables,      │
                   │ 413 too large    │   │ columns and file   │
                   │ 429 too many /   │   │ paths. Showing it  │
                   │     over quota   │   │ hands an attacker  │
                   │ 503 try again    │   │ a map.             │
                   └────────┬─────────┘   └─────────┬──────────┘
                            └────────────┬──────────┘
                                         ▼
                            ┌────────────────────────┐
                            │ Reply as JSON:         │
                            │ { success: false,      │
                            │   error: "message" }   │
                            └────────────┬───────────┘
                                         ▼
                            ┌────────────────────────┐
                            │ The screen shows the   │
                            │ message next to what   │
                            │ the person was doing   │
                            └────────────────────────┘

   THINGS THAT FAIL QUIETLY ON PURPOSE
   Writing an audit record, sending a notification, counting API usage. These
   must never break the thing the user asked for - a logging fault should not
   stop somebody signing in. They are written to the log and the request carries
   on.

   THINGS THAT FAIL LOUDLY ON PURPOSE
   Starting the server with a weak signing key, a blank database password, or
   settings still pointing at a developer machine. The server refuses to start
   and prints exactly what is wrong. Running insecurely is worse than not running.
"""

D15_LEGEND = "Numbers are the standard web status codes the API returns."
