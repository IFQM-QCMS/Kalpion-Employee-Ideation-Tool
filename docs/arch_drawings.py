# -*- coding: utf-8 -*-
"""
Every figure in the architecture document, drawn.

One function per figure, each returning the path of a PNG. The names match the
figure numbers used in the document (A-1 … A-7 for architecture, D-1 … D-15 for
detailed design) so a reader can move between the two without translating.

    python docs/arch_drawings.py        # rebuild them all

Monochrome: black lines, white and grey fills. The document's brief was to keep
everything black, and that has not changed — what has changed is that a box is
now drawn as a box rather than spelled out in dashes.
"""
from matplotlib.patches import Rectangle

from diagram_kit import (
    canvas, save, box, store, cylinder, diamond, actor, oval, band, group,
    arrow, note, entity, stack, elbow, crow, sequence,
    FILL_PLAIN, FILL_SOFT, FILL_MED, FILL_DARK, LINE, GREY,
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
        box(ax, x, 4, 11, 7, label, fill=FILL_PLAIN, size=6.2)
        arrow(ax, (x + 5.5, 11), (x + 5.5, 22), dashed=True)

    return save(fig, 'A1_context')


def a2_containers():
    """What runs where — and one database per customer."""
    fig, ax = canvas(9.0, 5.4)

    box(ax, 18, 45, 54, 6.8, 'Browser  —  React single-page application (24 screens)',
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
                 '(18 tables, once per customer)')

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
        ('Rules', '33 services — every business rule, none of them aware of HTTP', FILL_MED),
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
            ('auth · one-time\ncodes', 46), ('settings · approval\nstages', 59),
            ('platform · billing\nplans', 72)]
    for label, x in grid:
        box(ax, x - 5.8, 15.6, 11.6, 5, label, fill=FILL_PLAIN, size=5.8)
    grid2 = [('mail · SMS', 20), ('scoring', 33), ('QCMS push', 46),
             ('exports · PDF', 59), ('registrations', 72)]
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
    """Which way data travels with the outside world."""
    fig, ax = canvas(8.4, 3.2)
    box(ax, 32, 11, 22, 10, 'IFQM Employee\nIdeation Tool', fill=FILL_MED, size=8, bold=True)
    for label, x, y in [('QCMS\nquality system', 66, 19), ('Email server\n(SMTP)', 66, 5),
                        ('SMS provider', 3, 19), ('AI scoring\n(optional)', 3, 5)]:
        box(ax, x, y, 16, 8, label, fill=FILL_PLAIN, size=6.3)
        if x > 32:
            arrow(ax, (54, y + 4), (x, y + 4), label='out')
        else:
            arrow(ax, (32, y + 4), (x + 16, y + 4), label='out')
    note(ax, 43, 3, 'Every arrow points outward. Nothing outside can push data in —\n'
                    'there are no inbound integrations at all.', ha='center')
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

    box(ax, 62, 20, 17, 6, 'Rejected\nreason recorded', fill=FILL_SOFT, size=6.3)
    arrow(ax, (76, 32.5), (72, 26), label='reject')

    box(ax, 38, 20, 17, 6, 'Approved\n+25 points', fill=FILL_MED, size=6.3)
    arrow(ax, (69, 34.5), (55, 24), label='approve, final', rad=0.12)

    box(ax, 38, 9, 17, 6, 'Escalated\nup the chain', fill=FILL_SOFT, size=6.3)
    arrow(ax, (68, 33), (55, 13), label='approve, not final', rad=0.18)
    arrow(ax, (46, 15), (46, 20))

    box(ax, 13, 20, 17, 6, 'Implemented\n+65 points · ROI', fill=FILL_DARK, size=6.3)
    arrow(ax, (38, 23), (30, 23), label='carried out')

    box(ax, 13, 9, 17, 6, 'Pushed to QCMS\nif configured', fill=FILL_PLAIN, size=6.3)
    arrow(ax, (21, 20), (21, 15))

    note(ax, 46, 6, 'Points are awarded once, at each step. An idea can be archived from any state —\n'
                    'archiving hides it, it does not delete anything.', ha='center')
    return save(fig, 'D1_workflow')


def d2_dfd0():
    """Context data-flow diagram."""
    fig, ax = canvas(8.4, 3.2)
    box(ax, 3, 19, 16, 7, 'Employee', fill=FILL_PLAIN, size=7.0, rounded=False)
    box(ax, 3, 5, 16, 7, 'Reviewer', fill=FILL_PLAIN, size=7.0, rounded=False)
    box(ax, 65, 19, 16, 7, 'Administrator', fill=FILL_PLAIN, size=7.0, rounded=False)
    box(ax, 65, 5, 16, 7, 'QCMS', fill=FILL_PLAIN, size=7.0, rounded=False)

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
    box(ax, 2, 34, 14, 6, 'Employee', fill=FILL_PLAIN, size=6.8, rounded=False)
    box(ax, 2, 12, 14, 6, 'Reviewer', fill=FILL_PLAIN, size=6.8, rounded=False)
    box(ax, 76, 22, 14, 6, 'QCMS', fill=FILL_PLAIN, size=6.8, rounded=False)

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
    fig, ax = canvas(10.0, 6.6)
    ax.text(50, 64, 'ifqm_master  —  the registry',
            ha='center', fontsize=9.0, fontweight='bold', family='DejaVu Sans')

    # Positions come from the heights the entities turn out to be. An entity's
    # height depends on how many columns it has, so anything hard-coded starts
    # colliding the moment a table gains a field.
    left = stack(ax, 2, 60, 24, [
        ('plans', [('PK', 'id'), ('', 'code  (unique)'), ('', 'name'),
                   ('', 'amount_paise'), ('', 'billing_cycle'),
                   ('', 'gst_percent  ·  gst_mode'), ('', 'max_users'),
                   ('', 'api_quota_monthly')]),
        ('platform_admins', [('PK', 'id'), ('', 'name  ·  email'), ('', 'password_hash')]),
    ])
    middle = stack(ax, 34, 60, 26, [
        ('tenants', [('PK', 'id'), ('', 'name'), ('', 'slug  (unique)'),
                     ('', 'db_name'), ('', 'status'), ('FK', 'plan_id → plans'),
                     ('', 'billing_status'), ('', 'trial_ends_at'), ('', 'period_end')]),
        ('login_directory', [('PK', 'id'), ('', 'identifier  (unique)'),
                             ('FK', 'tenant_id → tenants'), ('', 'user_id')]),
    ])
    right = stack(ax, 69, 60, 27, [
        ('tenant_registrations', [('PK', 'id'), ('', 'company_name'),
                                  ('', 'udyam_number  ·  gstin'), ('', 'pan  ·  cin'),
                                  ('', 'status'), ('FK', 'tenant_id → tenants'),
                                  ('FK', 'assigned_plan_id')]),
        ('tenant_billing_events', [('PK', 'id'), ('FK', 'tenant_id → tenants'),
                                   ('', 'event'), ('', 'created_at')]),
        ('support_tickets', [('PK', 'id'), ('', 'ticket_code  (unique)'),
                             ('FK', 'tenant_id → tenants'), ('', 'status  ·  priority'),
                             ('', 'archived_at')]),
    ])

    # Only real foreign keys are drawn. A line between two tables that do not
    # reference each other is worse than no line: it invents a relationship.
    elbow(ax, left['plans'], middle['tenants'], label='is on', b_many=True)
    elbow(ax, middle['tenants'], right['tenant_registrations'],
          label='came from', b_many=False, mid=66)
    elbow(ax, middle['tenants'], right['tenant_billing_events'], label='has', mid=64)
    elbow(ax, middle['tenants'], right['support_tickets'], label='raises', mid=62)
    elbow(ax, middle['tenants'], middle['login_directory'], label='indexes', mid=32)

    note(ax, 50, 5,
         'PK identifies a row.  FK points at another table.  Three prongs mean “many”, a single bar means “one”.\n'
         'The registry holds no employee and no idea — it is deliberately thin.', ha='center')
    return save(fig, 'D4_er_master')


def d5_er_tenant():
    """One customer's schema, as a real ER diagram."""
    fig, ax = canvas(10.2, 8.2)
    ax.text(51, 80, 'ifqm_<organisation>  —  repeated once per customer  (18 tables)',
            ha='center', fontsize=9.0, fontweight='bold', family='DejaVu Sans')

    left = stack(ax, 2, 76, 25, [
        ('users', [('PK', 'id'), ('', 'employee_id  (unique)'), ('', 'name  ·  email'),
                   ('', 'role'), ('FK', 'manager_id → users.id'), ('', 'status'),
                   ('', 'points')]),
        ('idea_votes', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                        ('FK', 'user_id → users'), ('', 'rating')]),
        ('idea_comments', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                           ('FK', 'user_id → users'), ('', 'parent_id → self'),
                           ('', 'is_deleted')]),
    ])
    middle = stack(ax, 36, 76, 27, [
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
    right = stack(ax, 73, 76, 26, [
        ('categories', [('PK', 'id'), ('', 'name'), ('', 'sort_order')]),
        ('idea_workflow', [('PK', 'id'), ('FK', 'idea_id → ideas'),
                           ('FK', 'actor_id → users'), ('', 'action'),
                           ('', 'comment'), ('', 'created_at')]),
        ('org_settings', [('PK', 'id'), ('', 'key_name  (unique)'), ('', 'value')]),
    ])

    elbow(ax, left['users'], middle['ideas'], label='submits')
    elbow(ax, middle['ideas'], middle['idea_reviewers'], label='assigned to', mid=34)
    elbow(ax, middle['ideas'], middle['idea_attachments'], label='carries', mid=32)
    elbow(ax, middle['ideas'], left['idea_votes'], label='voted on', mid=30)
    elbow(ax, middle['ideas'], left['idea_comments'], label='discussed in', mid=28)
    elbow(ax, middle['ideas'], right['idea_workflow'], label='history', mid=70)

    # The self-reference is drawn rather than left as a footnote: it is the
    # reporting line an idea escalates along, which is the whole point of it.
    u = left['users']
    ax.plot([u['left'] - 5, u['left'] - 5], [u['cy'] + 5, u['cy'] - 5], color=LINE, lw=1.0, zorder=3)
    ax.plot([u['left'] - 5, u['left']], [u['cy'] + 5, u['cy'] + 5], color=LINE, lw=1.0, zorder=3)
    ax.plot([u['left'] - 5, u['left']], [u['cy'] - 5, u['cy'] - 5], color=LINE, lw=1.0, zorder=3)
    crow(ax, (u['left'], u['cy'] - 5), (-1, 0), many=True)
    ax.text(u['left'] - 6.2, u['cy'], 'reports to', ha='center', va='center',
            fontsize=6.2, family='DejaVu Sans', rotation=90)

    note(ax, 51, 6,
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
    """Which module calls which."""
    fig, ax = canvas(8.8, 4.0)
    box(ax, 33, 33, 22, 5.4, 'ideaController', fill=FILL_MED, size=7.0, bold=True)
    arrow(ax, (44, 33), (44, 29.4))
    box(ax, 30, 23, 28, 6, 'ideaService', fill=FILL_DARK, size=7.4, bold=True)

    for label, x in [('settingsService', 2), ('aiService', 24), ('coreHelpers', 46), ('mailerService', 68)]:
        box(ax, x, 13, 20, 5.6, label, fill=FILL_SOFT, size=6.5)
        arrow(ax, (44, 23), (x + 10, 18.6), rad=0.1, lw=0.9)

    box(ax, 22, 3, 22, 5.6, 'ideaSections', fill=FILL_PLAIN, size=6.5)
    box(ax, 50, 3, 22, 5.6, 'database layer', fill=FILL_PLAIN, size=6.5)
    arrow(ax, (33, 13), (33, 8.6))
    arrow(ax, (58, 13), (60, 8.6))

    note(ax, 44, 1.4, 'Arrows point from caller to called. No service ever reaches back up.', ha='center')
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
        fill=FILL_SOFT, size=6.4)
    arrow(ax, (32, 24), (19, 20.2), label='no')

    box(ax, 54, 14, 32, 6, 'Yes — write it down and carry on\n(mail, metering, audit)',
        fill=FILL_SOFT, size=6.4)
    arrow(ax, (56, 24), (70, 20.2), label='yes')

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
