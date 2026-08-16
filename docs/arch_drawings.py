# -*- coding: utf-8 -*-
"""
Every figure in the architecture document, drawn.

One function per figure, each returning the path of a PNG. The names match the
figure numbers used in the document (A-1 … A-7 for architecture, D-1 … D-15 for
detailed design) so a reader can move between the two without translating.

    python docs/arch_drawings.py        # rebuild them all

Colour is meaningful, not decorative: indigo for the system and the path
through it, teal for anywhere data rests, amber for a decision, green for an
outcome somebody wanted, red for a refusal, slate for anything outside our
control. See the palette at the top of diagram_kit.py.
"""
from matplotlib.patches import Rectangle

from diagram_kit import (
    canvas, save, box, store, cylinder, diamond, actor, oval, band, group,
    arrow, note, entity, stack, elbow, crow, sequence,
    FILL_PLAIN, FILL_SOFT, FILL_MED, FILL_DARK, LINE, GREY,
    PRIMARY, PRIMARY_FILL, PRIMARY_MID, DATA, DATA_FILL, DECISION,
    GOOD, GOOD_FILL, GOOD_MID, STOP, STOP_FILL, EXTERNAL, EXTERNAL_FILL,
)


# ══════════════════════════════════════════════════════════════════════════
# PART A — architecture
# ══════════════════════════════════════════════════════════════════════════

def a1_context():
    """The system as one box, with the people and services around it."""
    fig, ax = canvas(9.0, 5.0)

    actor(ax, 10, 40, 'Employee')
    actor(ax, 10, 20, 'Reviewer /\nManager')
    actor(ax, 78, 40, 'Organisation\nadministrator')
    actor(ax, 78, 20, 'IFQM platform\nadministrator')

    box(ax, 26, 22, 36, 20, 'IFQM Employee\nIdeation Tool', fill=FILL_MED, size=10, bold=True)

    arrow(ax, (15, 39), (26, 36), label='submits ideas')
    arrow(ax, (15, 21), (26, 27), label='reviews, decides')
    arrow(ax, (73, 39), (62, 36), label='runs the org')
    arrow(ax, (73, 21), (62, 27), label='runs the platform')

    group(ax, 18, 2, 52, 14, 'Outside services — every one optional, configured per customer')
    for label, x in [('Email\n(SMTP)', 21), ('SMS\n(one-time codes)', 33),
                     ('QCMS\n(quality system)', 45), ('AI scoring\n(optional)', 57)]:
        box(ax, x, 4, 11, 7, label, fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.2)
        arrow(ax, (x + 5.5, 11), (x + 5.5, 22), dashed=True, colour=EXTERNAL)

    return save(fig, 'A1_context')


def a2_containers():
    """What runs where — and one database per customer."""
    fig, ax = canvas(9.0, 5.4)

    box(ax, 18, 45, 54, 6.8, 'Browser  —  React single-page application (28 screens)',
        fill=FILL_MED, size=7.6, bold=True)
    note(ax, 2, 50, 'Runs on the\nvisitor’s machine')

    arrow(ax, (45, 45), (45, 39), label='HTTPS  ·  signed session token')

    band(ax, 4, 23, 82, 16, '', fill=FILL_SOFT)
    note(ax, 5, 38, 'Application server (Node.js)')
    box(ax, 8, 31, 22, 6, 'Middleware\nsecurity · auth · metering', fill=FILL_PLAIN, size=6.4)
    box(ax, 34, 31, 18, 6, 'Routes +\ncontrollers', fill=FILL_PLAIN, size=6.4)
    box(ax, 56, 31, 24, 6, 'Services\nall the business rules', fill=FILL_PLAIN, size=6.4)
    box(ax, 20, 24, 48, 5, 'Database layer  —  one pool for the registry, one per organisation',
        fill=FILL_DARK, size=6.8)
    arrow(ax, (30, 34), (34, 34))
    arrow(ax, (52, 34), (56, 34))
    arrow(ax, (44, 31), (44, 29))

    arrow(ax, (30, 24), (22, 19), label='registry')
    arrow(ax, (58, 24), (66, 19), label='per customer')

    cylinder(ax, 8, 5, 26, 13,
             'ifqm_master\n\nwhich organisations exist,\nIFQM staff, sign-in directory,\n'
             'support tickets, billing')
    for off in (0, 2.2, 4.4):
        cylinder(ax, 52 + off, 5 + off, 26, 12,
                 '' if off < 4.4 else
                 'ifqm_<organisation>\n\nthat customer’s people,\nideas, votes, files\n'
                 '(17 tables, once per customer)')

    note(ax, 45, 3.5,
         'One database per customer. Another customer’s rows are not reachable from this\n'
         'connection at all — separation you can point at.', ha='center')
    return save(fig, 'A2_containers')


def a3_stack():
    """The technology, as layers."""
    fig, ax = canvas(8.6, 4.4)
    rows = [
        ('Screens', 'React 18  ·  Vite  ·  React Router  ·  plain CSS (no UI framework)', FILL_MED),
        ('Transport', 'HTTPS  ·  JSON  ·  signed session tokens', FILL_SOFT),
        ('Server', 'Node.js  ·  Express  ·  Helmet  ·  rate limiting', FILL_SOFT),
        ('Rules', '40 services — every business rule, none of them aware of HTTP', FILL_MED),
        ('Data', 'MySQL 8  ·  raw SQL, no ORM  ·  one schema per customer', FILL_SOFT),
        ('Files', 'Local disk, one folder per customer, served through a checked download', FILL_SOFT),
    ]
    y = 37
    for title, detail, fill in rows:
        band(ax, 4, y, 78, 5.6, '', fill=fill)
        ax.text(7, y + 2.8, title, ha='left', va='center', fontsize=7.6,
                fontweight='bold', family='DejaVu Sans')
        ax.text(23, y + 2.8, detail, ha='left', va='center', fontsize=6.9, family='DejaVu Sans')
        y -= 6.4
    note(ax, 43, 1.6, 'A layer only ever talks to the one directly below it.', ha='center')
    return save(fig, 'A3_stack')


def a4_modules():
    """The four layers on the server, and what sits in each."""
    fig, ax = canvas(9.0, 5.2)

    box(ax, 32, 44, 26, 5.4, 'HTTP request', fill=FILL_MED, size=8, bold=True)
    arrow(ax, (45, 44), (45, 41.5))

    band(ax, 4, 34, 82, 7, '', fill=FILL_SOFT)
    ax.text(6, 37.5, 'Middleware', fontsize=7.2, fontweight='bold', family='DejaVu Sans')
    for label, x in [('security\nheaders', 21), ('CORS', 32), ('rate\nlimit', 41),
                     ('authenticate', 50), ('choose the\ndatabase', 62), ('meter', 74)]:
        box(ax, x, 34.6, 10, 5.8, label, fill=FILL_PLAIN, size=5.9)
    arrow(ax, (45, 34), (45, 31.5))

    band(ax, 4, 24, 82, 7, '', fill=FILL_SOFT)
    ax.text(6, 27.5, 'Routes and\ncontrollers', fontsize=7.2, fontweight='bold', family='DejaVu Sans')
    ax.text(50, 27.5, 'map an address to one service call, and nothing else',
            ha='center', va='center', fontsize=6.8, family='DejaVu Sans')
    arrow(ax, (45, 24), (45, 21.5))

    band(ax, 4, 9, 82, 12.5, '', fill=FILL_MED)
    ax.text(6, 15.5, 'Services', fontsize=7.2, fontweight='bold', family='DejaVu Sans')
    grid = [('ideas · voting\ncomments', 20), ('users · hierarchy\nimport', 33),
            ('auth · otp ·\nverification', 46), ('settings · approval\nstages', 59),
            ('platform · billing\nplans', 72)]
    for label, x in grid:
        box(ax, x - 5.8, 15.6, 11.6, 5, label, fill=FILL_PLAIN, size=5.8)
    grid2 = [('mail · sms\ndelivery log', 20), ('scoring', 33), ('QCMS push', 46),
             ('exports · PDF', 59), ('registrations ·\nmaintenance', 72)]
    for label, x in grid2:
        box(ax, x - 5.8, 9.8, 11.6, 5, label, fill=FILL_PLAIN, size=5.8)
    arrow(ax, (45, 9), (45, 6.8))

    band(ax, 4, 1.8, 82, 5, '', fill=FILL_DARK)
    ax.text(45, 4.3, 'Database layer  —  hands back the right connection, and decides nothing',
            ha='center', va='center', fontsize=7.0, family='DejaVu Sans')
    return save(fig, 'A4_modules')


def a5_deployment():
    """Where each piece is hosted."""
    fig, ax = canvas(8.6, 3.6)
    group(ax, 3, 6, 24, 26, 'Static hosting')
    box(ax, 6, 14, 18, 10, 'Built React files\n\nno server,\nnothing to patch', fill=FILL_SOFT, size=6.6)

    group(ax, 31, 6, 24, 26, 'Application host')
    box(ax, 34, 14, 18, 10, 'Node.js process\n\nstateless — restart\nor run two', fill=FILL_MED, size=6.6)

    group(ax, 59, 6, 24, 26, 'Managed MySQL')
    cylinder(ax, 62, 13, 18, 12, 'Registry +\none schema\nper customer')

    arrow(ax, (24, 19), (34, 19), label='HTTPS / JSON')
    arrow(ax, (52, 19), (62, 19), label='TLS')
    note(ax, 43, 5, 'Nothing is kept in the server process, so it can be replaced at any moment\n'
                    'without signing anybody out.', ha='center')
    return save(fig, 'A5_deployment')


def a6_security():
    """The layers a request has to clear."""
    fig, ax = canvas(8.4, 4.6)
    layers = [
        'Transport  —  HTTPS, HSTS, security headers',
        'Origin  —  only allowlisted sites may call the API',
        'Rate  —  per address, far tighter on sign-in',
        'Identity  —  token decoded, then the user re-read from the database',
        'Tenancy  —  that organisation’s own connection is attached',
        'Permission  —  the route’s roles, then the service re-checks',
        'Visibility  —  what this reader may see is decided before anything is sent',
    ]
    y = 38
    for i, text in enumerate(layers):
        inset = i * 2.2
        box(ax, 5 + inset, y, 74 - inset * 2, 4.6, text,
            fill=FILL_SOFT if i % 2 else FILL_MED, size=6.5)
        if i < len(layers) - 1:
            arrow(ax, (42, y), (42, y - 1.2))
        y -= 5.8
    note(ax, 42, 2.6, 'A request must clear every layer. Failing any one of them ends it.', ha='center')
    return save(fig, 'A6_security')


def a7_integration():
    """Which way data travels with the outside world, and over which port."""
    fig, ax = canvas(9.4, 4.6)
    box(ax, 34, 16, 24, 11, 'IFQM Employee\nIdeation Tool', fill=FILL_MED, size=8.4, bold=True)

    for label, x, y, cap in [
        ('QCMS\nquality system', 74, 31, 'approved ideas'),
        ('Mail — SMTP\nport 465 / 587', 74, 19, 'codes, resets · tried first'),
        ('Mail — HTTPS API\nport 443', 74, 7, 'the same messages, where SMTP is blocked'),
    ]:
        box(ax, x, y, 20, 8.6, label, fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.2)
        arrow(ax, (58, y + 4.3), (x, y + 4.3), label=cap, size=5.5)

    for label, x, y, cap in [
        ('SMS gateway\n(DLT-registered)', 2, 31, 'one-time codes'),
        ('Razorpay\n(optional)', 2, 19, 'subscription payment'),
        ('AI scoring\n(optional)', 2, 7, 'off by default'),
    ]:
        box(ax, x, y, 20, 8.6, label, fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.2)
        arrow(ax, (34, y + 4.3), (x + 20, y + 4.3), label=cap, size=5.5)

    note(ax, 47, 2.0,
         'Every arrow points outward: nothing outside can push data in, and there are no inbound integrations.\n'
         'The two mail entries are one integration with two transports — SMTP is tried first, and the HTTPS API\n'
         'carries the same message where a host blocks outbound SMTP. Every one of these is optional: the system\n'
         'keeps working, with less function, when any of them is absent.', ha='center')
    return save(fig, 'A7_integration')

# ══════════════════════════════════════════════════════════════════════════
# PART D — detailed design
# ══════════════════════════════════════════════════════════════════════════

def d1_workflow():
    """The states an idea moves through."""
    fig, ax = canvas(9.2, 4.6)
    box(ax, 3, 34, 15, 6, 'Draft\nprivate to the author', fill=FILL_SOFT, size=6.3)
    box(ax, 25, 34, 15, 6, 'Submitted\n+10 points', fill=FILL_MED, size=6.3)
    arrow(ax, (18, 37), (25, 37), label='submit')

    box(ax, 47, 34, 15, 6, 'Under review\nSLA clock runs', fill=FILL_MED, size=6.3)
    arrow(ax, (40, 37), (47, 37), label='assigned')

    diamond(ax, 76, 37, 18, 9, 'Reviewer\ndecides')
    arrow(ax, (62, 37), (67, 37))

    box(ax, 62, 20, 17, 6, 'Rejected\nreason recorded', fill=STOP_FILL, edge=STOP, size=6.3)
    arrow(ax, (76, 32.5), (72, 26), label='reject', colour=STOP)

    box(ax, 38, 20, 17, 6, 'Approved\n+25 points', fill=GOOD_FILL, edge=GOOD, size=6.3)
    arrow(ax, (69, 34.5), (55, 24), label='approve, final', rad=0.12)

    box(ax, 38, 9, 17, 6, 'Escalated\nup the chain', fill=FILL_SOFT, size=6.3)
    arrow(ax, (68, 33), (55, 13), label='approve, not final', rad=0.18)
    arrow(ax, (46, 15), (46, 20))

    box(ax, 13, 20, 17, 6, 'Implemented\n+65 points · ROI', fill=GOOD_MID, edge=GOOD, size=6.3)
    arrow(ax, (38, 23), (30, 23), label='carried out')

    box(ax, 13, 9, 17, 6, 'Pushed to QCMS\nif configured', fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.3)
    arrow(ax, (21, 20), (21, 15))

    note(ax, 46, 6, 'Points are awarded once, at each step. An idea can be archived from any state —\n'
                    'archiving hides it, it does not delete anything.', ha='center')
    return save(fig, 'D1_workflow')


def d2_dfd0():
    """Context data-flow diagram."""
    fig, ax = canvas(8.4, 3.2)
    box(ax, 3, 19, 16, 7, 'Employee', fill=EXTERNAL_FILL, edge=EXTERNAL, size=7.0, rounded=False)
    box(ax, 3, 5, 16, 7, 'Reviewer', fill=EXTERNAL_FILL, edge=EXTERNAL, size=7.0, rounded=False)
    box(ax, 65, 19, 16, 7, 'Administrator', fill=EXTERNAL_FILL, edge=EXTERNAL, size=7.0, rounded=False)
    box(ax, 65, 5, 16, 7, 'QCMS', fill=EXTERNAL_FILL, edge=EXTERNAL, size=7.0, rounded=False)

    box(ax, 30, 11, 24, 10, '0\nIdeation\nsystem', fill=FILL_MED, size=8.2, bold=True)

    arrow(ax, (19, 22), (30, 19), label='an idea')
    arrow(ax, (30, 14), (19, 9), label='queue, decisions')
    arrow(ax, (54, 19), (65, 22), label='reports')
    arrow(ax, (54, 14), (65, 9), label='approved ideas')
    note(ax, 42, 3.5, 'Squares are people or outside systems. The rounded box is the whole system.', ha='center')
    return save(fig, 'D2_dfd0')


def d3_dfd1():
    """Level-1 data-flow diagram."""
    fig, ax = canvas(9.2, 4.6)
    box(ax, 2, 34, 14, 6, 'Employee', fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.8, rounded=False)
    box(ax, 2, 12, 14, 6, 'Reviewer', fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.8, rounded=False)
    box(ax, 76, 22, 14, 6, 'QCMS', fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.8, rounded=False)

    box(ax, 23, 33, 16, 7, '1\nCapture\nan idea', fill=FILL_MED, size=6.5)
    box(ax, 47, 33, 16, 7, '2\nScore it', fill=FILL_MED, size=6.5)
    box(ax, 47, 20, 16, 7, '3\nRoute for\napproval', fill=FILL_MED, size=6.5)
    box(ax, 23, 20, 16, 7, '4\nRecord the\ndecision', fill=FILL_MED, size=6.5)
    box(ax, 47, 7, 16, 7, '5\nHand over\nto QCMS', fill=FILL_MED, size=6.5)

    store(ax, 21, 1.5, 20, 4.4, 'D1   ideas')
    store(ax, 47, 1.5, 16, 4.4, 'D2   users')
    store(ax, 70, 11, 20, 4.4, 'D3   workflow history')

    arrow(ax, (16, 37), (23, 37), label='new idea')
    arrow(ax, (39, 36.5), (47, 36.5), label='text')
    arrow(ax, (55, 33), (55, 27), label='score')
    arrow(ax, (47, 23.5), (39, 23.5), label='assignment')
    arrow(ax, (23, 22), (16, 17), label='queue')
    arrow(ax, (16, 14), (23, 20), label='decision')
    arrow(ax, (31, 20), (31, 6), dashed=True)
    arrow(ax, (55, 20), (55, 14), label='approved')
    arrow(ax, (55, 7), (55, 6), dashed=True)
    arrow(ax, (63, 10.5), (76, 23), label='push', rad=-0.18)
    arrow(ax, (63, 23), (70, 15.5), dashed=True)

    note(ax, 46, 0.8, 'Numbered boxes are processes. D1, D2 and D3 are where data rests.', ha='center')
    return save(fig, 'D3_dfd1')


def d4_er_master():
    """The registry, as a real ER diagram."""
    # Tall enough for the three-entity right-hand column. The canvas used to be
    # 6.6 high, which put support_tickets off the bottom edge and left the
    # closing note printing straight through it.
    # Taller: migrations 019 and 022 put the one-time-code and delivery
    # tables in the registry, and they are what sign-in by code is built on.
    # A reader looking for where a code lives would not have found it here.
    fig, ax = canvas(10.6, 8.8)
    ax.text(50, 84.5, 'ifqm_master  —  the registry  (15 tables; the 10 principal ones are shown)',
            ha='center', fontsize=9.0, fontweight='bold', family='DejaVu Sans')

    # Positions come from the heights the entities turn out to be. An entity's
    # height depends on how many columns it has, so anything hard-coded starts
    # colliding the moment a table gains a field.
    left = stack(ax, 2, 80, 24, accent=GOOD, specs=[
        ('plans', [('PK', 'id'), ('', 'code  (unique)'), ('', 'name'),
                   ('', 'amount_paise'), ('', 'billing_cycle'),
                   ('', 'gst_percent  ·  gst_mode'), ('', 'max_users'),
                   ('', 'api_quota_monthly')]),
        ('platform_admins', [('PK', 'id'), ('', 'name  ·  email'), ('', 'password_hash')]),
        # Codes live in the REGISTRY, not in a tenant schema: one is issued
        # before the organisation is known (registration), and sign-in has to
        # find it without opening a tenant database first.
        ('login_otps', [('PK', 'id'), ('', 'identifier'), ('', 'id_type  ·  channel'),
                       ('', 'code_hash  (bcrypt)'), ('', 'purpose'),
                       ('FK', 'tenant_id → tenants'), ('', 'attempts'),
                       ('', 'expires_at  ·  consumed_at')]),
    ])
    middle = stack(ax, 34, 80, 26, accent=PRIMARY, specs=[
        ('tenants', [('PK', 'id'), ('', 'name'), ('', 'slug  (unique)'),
                     ('', 'db_name'), ('', 'status'), ('FK', 'plan_id → plans'),
                     ('', 'billing_status'), ('', 'trial_ends_at'), ('', 'period_end')]),
        ('login_directory', [('PK', 'id'), ('', 'identifier  (unique)'),
                             ('FK', 'tenant_id → tenants'), ('', 'user_id')]),
        ('payment_attempts', [('PK', 'id'), ('FK', 'tenant_id → tenants'),
                              ('FK', 'plan_id → plans'), ('', 'order_ref  (unique)'),
                              ('', 'amount_paise  ·  gst_paise'), ('', 'status')]),
    ])
    right = stack(ax, 69, 80, 27, accent=DATA, specs=[
        ('tenant_registrations', [('PK', 'id'), ('', 'company_name'),
                                  ('', 'udyam_number  ·  gstin'), ('', 'pan  ·  cin'),
                                  ('', 'status'), ('FK', 'tenant_id → tenants'),
                                  ('FK', 'assigned_plan_id')]),
        ('tenant_billing_events', [('PK', 'id'), ('FK', 'tenant_id → tenants'),
                                   ('', 'event'), ('', 'created_at')]),
        ('support_tickets', [('PK', 'id'), ('', 'ticket_code  (unique)'),
                             ('FK', 'tenant_id → tenants'), ('', 'status  ·  priority'),
                             ('', 'archived_at')]),
        # Never the message body — it carries the code — and the recipient is
        # masked to its last four digits before the row is written.
        ('sms_delivery_log', [('PK', 'id'), ('', 'provider  ·  purpose'),
                              ('', 'recipient  (masked)'), ('', 'template_id'),
                              ('', 'ok  ·  http_status'), ('', 'gateway_ref')]),
    ])

    # Only real foreign keys are drawn. A line between two tables that do not
    # reference each other is worse than no line: it invents a relationship.
    elbow(ax, left['plans'], middle['tenants'], label='is on', b_many=True)
    elbow(ax, middle['tenants'], right['tenant_registrations'],
          label='came from', b_many=False, mid=66)
    elbow(ax, middle['tenants'], right['tenant_billing_events'], label='has', mid=64)
    elbow(ax, middle['tenants'], right['support_tickets'], label='raises', mid=62)
    elbow(ax, middle['tenants'], middle['login_directory'], label='indexes', mid=32)
    elbow(ax, left['login_otps'], middle['tenants'], label='issued for', b_many=False, mid=30)
    elbow(ax, middle['tenants'], middle['payment_attempts'], label='pays by', mid=31)

    # Below the longest column, computed rather than guessed — see d5_er_tenant.
    floor = min(e['bottom'] for col in (left, middle, right) for e in col.values())
    note(ax, 50, floor - 3.5,
         'PK identifies a row.  FK points at another table.  Three prongs mean “many”, a single bar means “one”.\n'
         'Five standalone tables are left off: platform_settings, login_attempts, platform_login_activity,\n'
         'tenant_api_usage and support_ticket_messages.\n'
         'The registry holds no employee and no idea — those live only in each organisation’s own schema.',
         ha='center')
    return save(fig, 'D4_er_master')


def d5_er_tenant():
    """One customer's schema, as a real ER diagram."""
    # The left column starts at x=6 rather than x=2, so the users self-reference
    # has room to loop back without running off the page, while still leaving
    # the 30-36 band clear for the relationship lines to route through.
    fig, ax = canvas(10.2, 7.6)
    ax.text(51, 74, 'ifqm_<organisation>  —  repeated once per customer  (17 tables)',
            ha='center', fontsize=9.0, fontweight='bold', family='DejaVu Sans')

    left = stack(ax, 6, 70, 24, accent=GOOD, specs=[
        ('users', [('PK', 'id'), ('', 'employee_id  (unique)'), ('', 'name  ·  email'),
                   ('', 'role'), ('FK', 'manager_id → users.id'), ('', 'status'),
                   ('', 'points')]),
        ('idea_votes', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                        ('FK', 'user_id → users'), ('', 'rating')]),
        ('idea_comments', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                           ('FK', 'user_id → users'), ('', 'parent_id → self'),
                           ('', 'is_deleted')]),
    ])
    middle = stack(ax, 36, 70, 27, accent=PRIMARY, specs=[
        ('ideas', [('PK', 'id'), ('', 'idea_code  (unique)'),
                   ('FK', 'submitter_id → users'), ('', 'title'),
                   ('', 'present_situation'), ('', 'proposed_solution'),
                   ('', 'status'), ('', 'ai_score'), ('', 'patentable_flag'),
                   ('', 'archived_at')]),
        ('idea_reviewers', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                            ('FK', 'reviewer_id → users'), ('', 'decision')]),
        ('idea_attachments', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                              ('', 'section'), ('', 'filename  ·  filepath')]),
    ])
    right = stack(ax, 73, 70, 26, accent=DATA, specs=[
        ('idea_categories', [('PK', 'id'), ('', 'name'), ('', 'sort_order')]),
        ('idea_workflow', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                           ('FK', 'actor_id → users'), ('', 'action'),
                           ('', 'comment'), ('', 'created_at')]),
        ('org_settings', [('PK', 'id'), ('', 'key_name  (unique)'), ('', 'value')]),
    ])

    # Every line routes through the clear band between the left column (which
    # ends at x=30) and the middle one (which begins at x=36). Values inside a
    # column would draw the relationship straight across a table's own rows.
    elbow(ax, left['users'], middle['ideas'], label='submits')
    elbow(ax, middle['ideas'], middle['idea_reviewers'], label='assigned to', mid=34.6)
    elbow(ax, middle['ideas'], middle['idea_attachments'], label='carries', mid=33.2)
    elbow(ax, middle['ideas'], left['idea_votes'], label='voted on', mid=31.8)
    elbow(ax, middle['ideas'], left['idea_comments'], label='discussed in', mid=30.4)
    elbow(ax, middle['ideas'], right['idea_workflow'], label='history', mid=70)

    # The self-reference is drawn rather than left as a footnote: it is the
    # reporting line an idea escalates along, which is the whole point of it.
    u = left['users']
    lx = u['left'] - 3.4
    ax.plot([lx, lx], [u['cy'] + 5, u['cy'] - 5], color=LINE, lw=1.0, zorder=3)
    ax.plot([lx, u['left']], [u['cy'] + 5, u['cy'] + 5], color=LINE, lw=1.0, zorder=3)
    ax.plot([lx, u['left']], [u['cy'] - 5, u['cy'] - 5], color=LINE, lw=1.0, zorder=3)
    crow(ax, (u['left'], u['cy'] - 5), (-1, 0), many=True)
    ax.text(lx - 1.4, u['cy'], 'reports to', ha='center', va='center',
            fontsize=6.2, family='DejaVu Sans', rotation=90)

    # Placed under whichever column turns out to be the longest, rather than at
    # a fixed height. Hard-coding it is what printed this note through
    # idea_attachments when the ideas table gained a couple of rows.
    floor = min(e['bottom'] for col in (left, middle, right) for e in col.values())
    note(ax, 51, floor - 3.5,
         'users.manager_id points back at users. That self-reference IS the reporting line — the route an idea\n'
         'travels for approval. Every table here exists once per customer, in a database of its own.', ha='center')
    return save(fig, 'D5_er_tenant')


def d6_usecase():
    """Who can do what."""
    fig, ax = canvas(8.8, 4.8)
    actor(ax, 7, 38, 'Employee')
    actor(ax, 7, 18, 'Reviewer')
    actor(ax, 81, 38, 'Org admin')
    actor(ax, 81, 18, 'Platform admin')

    group(ax, 20, 3, 48, 44, 'IFQM Employee Ideation Tool')
    cases = [
        ('Submit an idea', 32, 43), ('Track my ideas', 56, 43),
        ('Vote and comment', 32, 36), ('See the leaderboard', 56, 36),
        ('Review and decide', 32, 29), ('Route to a committee', 56, 29),
        ('Manage people', 32, 22), ('Set the approval chain', 56, 22),
        ('Export and report', 32, 15), ('Approve registrations', 56, 15),
        ('Manage plans and billing', 44, 8),
    ]
    for label, x, y in cases:
        oval(ax, x, y, 21, 5.4, label)

    for y in (43, 36):
        arrow(ax, (11, 38), (22, y), style='-', lw=0.9)
    for y in (29, 36):
        arrow(ax, (11, 18), (22, y), style='-', lw=0.9)
    for y in (22, 15):
        arrow(ax, (77, 38), (66, y), style='-', lw=0.9)
    for y in (15, 8):
        arrow(ax, (77, 18), (66, y), style='-', lw=0.9)

    note(ax, 44, 2, 'A line means “this person may do this”. Roles inherit downward: a reviewer\n'
                    'can do everything an employee can.', ha='center')
    return save(fig, 'D6_usecase')


def d12_class():
    """
    The module structure, in place of a class diagram.

    There is no class diagram in this document because there are no classes to
    draw: the server is written as ES modules that export functions. Drawing
    empty boxes labelled "IdeaService" with a stereotype on them would describe
    a design nobody wrote. This shows the real unit of structure instead — the
    module, its exported surface, and who it is allowed to call.
    """
    fig, ax = canvas(9.0, 5.2)

    box(ax, 30, 45, 30, 5.2, 'ideaController.js  —  HTTP only', fill=FILL_MED, size=7.0, bold=True)
    arrow(ax, (45, 45), (45, 41.6), label='calls once')

    # The exported surface, written out. This is what a class diagram would have
    # shown as a compartment of public methods.
    box(ax, 22, 27, 46, 14.2,
        'ideaService.js\n\n'
        '+ list(db, user, filters)          + get(db, user, id)\n'
        '+ submitOrDraft(db, user, action, b)   + reviewAction(db, user, b)\n'
        '+ setArchived(db, user, b)         + setPatentability(db, user, b)\n'
        '+ canReadSolution(user, idea, mode)\n'
        '−  redactSolution(user, idea, mode, previewChars)',
        fill=FILL_DARK, size=6.4)

    for label, x in [('settingsService', 2), ('aiService', 24), ('coreHelpers', 46),
                     ('notificationService', 68)]:
        box(ax, x, 15, 20, 5.4, label, fill=FILL_SOFT, size=6.4)
        arrow(ax, (45, 27), (x + 10, 20.4), rad=0.1, lw=0.9)

    # ideaSections.js is the shared vocabulary of section names. It is imported
    # by ideaService, settingsService, commentService and votingService, and it
    # imports nothing itself — which is precisely why it exists: without it,
    # settingsService and ideaService would have to import each other.
    box(ax, 8, 6.5, 26, 5.0, 'ideaSections.js  —  shared vocabulary', fill=FILL_PLAIN, size=6.2)
    arrow(ax, (12, 15), (18, 11.9), rad=0.1, lw=0.9)
    arrow(ax, (34, 27), (26, 11.9), rad=-0.15, lw=0.9)

    box(ax, 46, 6.5, 34, 5.0, 'database layer  (database/tenant.js)', fill=FILL_PLAIN, size=6.2)
    for x0 in (56, 78):
        arrow(ax, (x0, 15), (63, 11.9), rad=0.05, lw=0.9)
    arrow(ax, (58, 27), (63, 11.9), rad=0.1, lw=0.9)

    note(ax, 45, 2.4,
         'A plus sign is exported and may be called by another module; a minus sign is private to the file.\n'
         'Arrows point from caller to called, and only ever downward — no service calls a controller.\n'
         'Every exported function takes the database connection as its first argument and never sees the request.',
         ha='center')
    return save(fig, 'D12_class')


def d13_screenflow():
    """How somebody moves between screens."""
    fig, ax = canvas(9.2, 4.4)
    box(ax, 36, 36, 20, 5.4, 'Landing page', fill=FILL_MED, size=7.0, bold=True)
    box(ax, 12, 27, 18, 5.4, 'Sign in', fill=FILL_SOFT, size=6.8)
    box(ax, 62, 27, 24, 5.4, 'Apply for a workspace', fill=FILL_SOFT, size=6.8)
    arrow(ax, (40, 36), (23, 32.4))
    arrow(ax, (52, 36), (72, 32.4))

    box(ax, 34, 18, 24, 5.4, 'Dashboard', fill=FILL_DARK, size=7.2, bold=True)
    arrow(ax, (21, 27), (40, 23.4), label='signed in')
    arrow(ax, (74, 27), (56, 23.4), label='once approved')

    for label, x in [('My ideas', 2), ('Submit', 15), ('Idea board', 28), ('Leaderboard', 41),
                     ('Challenges', 54), ('Support', 67), ('Help', 79)]:
        box(ax, x, 8, 12, 5.0, label, fill=FILL_PLAIN, size=6.1)
        arrow(ax, (46, 18), (x + 6, 13), rad=0.05, lw=0.8)

    for label, x in [('Review queue', 15), ('Admin panel', 39), ('Org hierarchy', 63)]:
        box(ax, x, 1, 18, 5.0, label, fill=FILL_SOFT, size=6.1)
    note(ax, 2, 0.6, 'The bottom row appears only for the roles that hold it.')
    return save(fig, 'D13_screenflow')


def d14_wireframes():
    """The shape of the main screens."""
    fig, ax = canvas(9.2, 3.8)

    def screen(x, y, w, h, title, rows):
        box(ax, x, y, w, h, '', fill=FILL_PLAIN, rounded=False)
        ax.add_patch(Rectangle((x, y + h - 3.4), w, 3.4, linewidth=1.1,
                               edgecolor=LINE, facecolor=FILL_MED, zorder=3))
        ax.text(x + w / 2, y + h - 1.7, title, ha='center', va='center',
                fontsize=6.8, fontweight='bold', family='DejaVu Sans', zorder=4)
        for i, r in enumerate(rows):
            ry = y + h - 6.0 - i * 3.2
            ax.add_patch(Rectangle((x + 1.4, ry), w - 2.8, 2.4, linewidth=0.7,
                                   edgecolor='#999999', facecolor=FILL_SOFT, zorder=3))
            ax.text(x + 2.4, ry + 1.2, r, ha='left', va='center', fontsize=5.6,
                    family='DejaVu Sans', zorder=4)

    screen(2, 5, 27, 30, 'Dashboard',
           ['counts: submitted / approved / done', 'my recent ideas',
            'what needs my decision', 'monthly trend', 'leaderboard position'])
    screen(33, 5, 27, 30, 'Submit an idea',
           ['step 1  title and the problem', 'duplicate check as you type',
            'step 2  the proposal', 'step 3  business case',
            'step 4  attachments', 'step 5  co-suggesters'])
    screen(64, 5, 27, 30, 'Review queue',
           ['filter: waiting / overdue', 'the idea, its score, its history',
            'approve · reject · escalate', 'reason (required)',
            'route to a committee'])
    note(ax, 46, 3.4, 'Indicative layout only — spacing and wording come from the design tokens, not from this drawing.',
         ha='center')
    return save(fig, 'D14_wireframes')


def d15_errors():
    """What happens when something fails."""
    fig, ax = canvas(8.8, 4.0)
    box(ax, 32, 33, 24, 5.4, 'Something fails', fill=FILL_MED, size=7.4, bold=True)
    diamond(ax, 44, 25, 28, 8, 'Can the request\nstill be answered?')
    arrow(ax, (44, 33), (44, 29))

    box(ax, 3, 14, 31, 6, 'No — refuse it, with a message\nthat says what to change',
        fill=STOP_FILL, edge=STOP, size=6.4)
    arrow(ax, (32, 24), (19, 20.2), label='no', colour=STOP)

    box(ax, 54, 14, 32, 6, 'Yes — write it down and carry on\n(mail, metering, audit)',
        fill=GOOD_FILL, edge=GOOD, size=6.4)
    arrow(ax, (56, 24), (70, 20.2), label='yes', colour=GOOD)

    box(ax, 3, 4, 31, 6, 'The caller sees a sentence,\nnever a stack trace', fill=FILL_PLAIN, size=6.4)
    arrow(ax, (18, 14), (18, 10))
    box(ax, 54, 4, 32, 6, 'The person never notices;\nthe log records it', fill=FILL_PLAIN, size=6.4)
    arrow(ax, (70, 14), (70, 10))

    note(ax, 44, 2.4, 'Setup fails closed: an unsafe configuration stops the server.\n'
                      'Measurement fails open: a fault in counting is never an outage.', ha='center')
    return save(fig, 'D15_errors')


# ── sequences ────────────────────────────────────────────────────────────────

def d7_seq_login():
    return sequence('D7_seq_login',
        ['Browser', 'Auth route', 'authService', 'Registry', 'Org database'],
        [('Browser', 'Auth route', 'email + password', 'call'),
         ('Auth route', 'authService', 'login()', 'call'),
         ('authService', 'Registry', 'which organisation?', 'call'),
         ('authService', 'Org database', 'read the user row', 'call'),
         ('authService', 'authService', 'bcrypt compare — always, even if unknown', 'self'),
         ('authService', 'Registry', 'record the sign-in', 'call'),
         ('authService', 'Auth route', 'signed token + user', 'return'),
         ('Auth route', 'Browser', '200 + token', 'return')],
        note_lines=['A failure at any step answers the same way and takes the same time, so the',
                    'response cannot be used to test which addresses are registered.'])


def d8_seq_submit():
    return sequence('D8_seq_submit',
        ['Browser', 'Idea route', 'ideaService', 'aiService', 'Org database', 'mailer'],
        [('Browser', 'Idea route', 'POST /ideas/submit', 'call'),
         ('Idea route', 'ideaService', 'submitOrDraft()', 'call'),
         ('ideaService', 'ideaService', 'validate, look for duplicates', 'self'),
         ('ideaService', 'aiService', 'score across six areas', 'call'),
         ('ideaService', 'Org database', 'insert the idea, award points', 'call'),
         ('ideaService', 'Org database', 'assign the first reviewer', 'call'),
         ('ideaService', 'mailer', 'queue a notification', 'call'),
         ('ideaService', 'Browser', 'idea code + score', 'return')],
        note_lines=['Mail is queued, never awaited: a mail outage must not fail a submission.'])


def d9_seq_approval():
    return sequence('D9_seq_approval',
        ['Reviewer', 'Idea route', 'ideaService', 'approvalStages', 'Org database'],
        [('Reviewer', 'Idea route', 'approve / reject, with a reason', 'call'),
         ('Idea route', 'ideaService', 'reviewAction()', 'call'),
         ('ideaService', 'ideaService', 'refuse it if this is their own idea', 'self'),
         ('ideaService', 'approvalStages', 'who decides next?', 'call'),
         ('approvalStages', 'ideaService', 'the next stage, or final', 'return'),
         ('ideaService', 'Org database', 'write the status and a timeline entry', 'call'),
         ('ideaService', 'Reviewer', 'the new state', 'return')],
        note_lines=['The reason is required. A decision with no explanation is the fastest way',
                    'to stop people submitting.'])


def d10_seq_register():
    return sequence('D10_seq_register',
        ['Visitor', 'Registrations', 'registrationService', 'Registry', 'Platform admin'],
        [('Visitor', 'Registrations', 'company and statutory details', 'call'),
         ('Registrations', 'registrationService', 'submit()', 'call'),
         ('registrationService', 'registrationService', 'refuse free email domains', 'self'),
         ('registrationService', 'Registry', 'store it as pending', 'call'),
         ('registrationService', 'Visitor', 'a reference number', 'return'),
         ('Platform admin', 'registrationService', 'approve, with plan and trial days', 'call'),
         ('registrationService', 'Registry', 'provision the database', 'call'),
         ('registrationService', 'Platform admin', 'temporary password, shown once', 'return')],
        note_lines=['Nothing an anonymous caller does provisions anything. The worst a flood of',
                    'junk applications achieves is a full review queue.'])


def d11_seq_qcms():
    return sequence('D11_seq_qcms',
        ['Org admin', 'Integration route', 'qcmsService', 'QCMS', 'Org database'],
        [('Org admin', 'Integration route', 'push approved ideas', 'call'),
         ('Integration route', 'qcmsService', 'push()', 'call'),
         ('qcmsService', 'Org database', 'read approved, not yet pushed', 'call'),
         ('qcmsService', 'QCMS', 'POST each idea, with a timeout', 'call'),
         ('QCMS', 'qcmsService', 'accepted / duplicate / failed', 'return'),
         ('qcmsService', 'Org database', 'record the outcome per idea', 'call'),
         ('qcmsService', 'Org admin', 'counts: imported, duplicate, failed', 'return')],
        note_lines=['A QCMS that never answers is recorded as failed for that idea and retried',
                    'later. It never blocks the platform.'])


ALL = {
    'A1_context': a1_context, 'A2_containers': a2_containers, 'A3_stack': a3_stack,
    'A4_modules': a4_modules, 'A5_deployment': a5_deployment, 'A6_security': a6_security,
    'A7_integration': a7_integration,
    'D1_workflow': d1_workflow, 'D2_dfd0': d2_dfd0, 'D3_dfd1': d3_dfd1,
    'D4_er_master': d4_er_master, 'D5_er_tenant': d5_er_tenant, 'D6_usecase': d6_usecase,
    'D7_seq_login': d7_seq_login, 'D8_seq_submit': d8_seq_submit,
    'D9_seq_approval': d9_seq_approval, 'D10_seq_register': d10_seq_register,
    'D11_seq_qcms': d11_seq_qcms, 'D12_class': d12_class,
    'D13_screenflow': d13_screenflow, 'D14_wireframes': d14_wireframes,
    'D15_errors': d15_errors,
}


if __name__ == '__main__':
    for name, fn in ALL.items():
        print('drew %-16s -> %s' % (name, fn()))
    print('\n%d diagram(s) written.' % len(ALL))
