# -*- coding: utf-8 -*-
"""
The four flows in PROJECT_FLOWCHART.md, drawn.

    python docs/flow_drawings.py

Same palette as the architecture document: indigo for the path through the
system, amber for a decision, green for an outcome somebody wanted, red for a
refusal, slate for anything outside our control.

Each of these mirrors the Mermaid source kept beside it in the Markdown — change
one and change the other, or the picture starts lying.
"""
from diagram_kit import (
    canvas, save, box, diamond, arrow, note, group, band,
    FILL_PLAIN, FILL_SOFT, FILL_MED, FILL_DARK, LINE, GREY,
    PRIMARY, PRIMARY_FILL, PRIMARY_MID, DATA, DATA_FILL, DECISION,
    GOOD, GOOD_FILL, GOOD_MID, STOP, STOP_FILL, EXTERNAL, EXTERNAL_FILL,
)


def f1_idea_lifecycle():
    """Submission through to implementation — the core loop."""
    fig, ax = canvas(9.6, 7.4)

    ax.text(48, 72, 'The idea lifecycle', ha='center', fontsize=9.4,
            fontweight='bold', family='DejaVu Sans')

    # ── the form ────────────────────────────────────────────────────────────
    band(ax, 3, 61, 90, 8, '', fill=FILL_SOFT)
    ax.text(5.5, 65, 'Submit', fontsize=7.2, fontweight='bold', family='DejaVu Sans')
    steps = [('1  title +\nthe problem', 18), ('2  the\nproposal', 33),
             ('3  business\ncase', 48), ('4  attachments', 63), ('5  co-suggesters', 79)]
    for label, x in steps:
        box(ax, x - 6.5, 61.6, 13, 6.7, label, fill=FILL_PLAIN, size=5.9)
    for i in range(len(steps) - 1):
        arrow(ax, (steps[i][1] + 6.5, 65), (steps[i + 1][1] - 6.5, 65), lw=0.9)

    # ── checks while filling it in ──────────────────────────────────────────
    diamond(ax, 18, 52, 22, 7.5, 'Duplicate\nfound?')
    arrow(ax, (18, 61), (18, 56))
    box(ax, 38, 49, 26, 6, 'Similar ideas shown —\nthe submitter decides', fill=FILL_PLAIN, size=6.0)
    arrow(ax, (29, 52), (38, 52), label='yes')

    diamond(ax, 18, 40, 22, 7.5, 'Submit or\nsave draft?')
    arrow(ax, (18, 48.2), (18, 44), label='no', label_offset=(3.8, 0))

    box(ax, 3, 29, 26, 6, 'Draft — private,\nnot yet in the process', fill=FILL_SOFT, size=6.0)
    arrow(ax, (14, 36.2), (14, 35), label='save', label_offset=(-5.5, 1.5))
    # Back to the form, routed round the outside so it crosses nothing.
    ax.plot([3, 1.2, 1.2, 11.5], [32, 32, 65, 65], color=LINE, lw=0.9, zorder=3)
    arrow(ax, (10.5, 65), (11.5, 65), lw=0.9)
    note(ax, 1.6, 48, 'resume\nlater', size=5.8)

    # ── scoring and the clock ───────────────────────────────────────────────
    box(ax, 38, 37, 26, 6, 'Scored 0–100\nacross six areas', fill=FILL_MED, size=6.2)
    arrow(ax, (29, 40), (38, 40), label='submit')
    box(ax, 70, 37, 24, 6, 'Submitted\n+10 points · SLA starts', fill=FILL_MED, size=6.2)
    arrow(ax, (64, 40), (70, 40))

    # ── routing ─────────────────────────────────────────────────────────────
    diamond(ax, 82, 28, 22, 7.5, 'Which\nworkflow?')
    arrow(ax, (82, 37), (82, 32))

    box(ax, 46, 28, 26, 5.6, 'Routed to the line manager', fill=FILL_PLAIN, size=6.0)
    box(ax, 48, 18, 26, 5.6, 'Committee — a set share must agree', fill=FILL_PLAIN, size=6.0)
    arrow(ax, (71, 28), (72, 30.8), label='hierarchical', label_offset=(0, 2.6))
    arrow(ax, (76, 25), (74, 21), label='committee', label_offset=(6.5, -1))

    # ── the decision ────────────────────────────────────────────────────────
    diamond(ax, 28, 23, 24, 8, 'Reviewer\ndecides')
    arrow(ax, (46, 30.8), (38, 25.5))
    arrow(ax, (48, 20.8), (39, 22))

    box(ax, 2, 12, 22, 6, 'Rejected —\nthe reason is recorded',
        fill=STOP_FILL, edge=STOP, size=6.0)
    arrow(ax, (22, 19.5), (14, 18), label='reject', colour=STOP)

    # The loop back to a reviewer is stated on the box rather than drawn. Routed
    # as a line it had to cross three other shapes, and a loop drawn through the
    # middle of the diagram is not clearer than a sentence saying the same thing.
    box(ax, 28, 11, 30, 6, 'Escalates to the next role —\nback to a reviewer, one level up',
        fill=FILL_PLAIN, size=6.0)
    arrow(ax, (30, 19), (40, 17.2), label='approve, not final', label_offset=(-4, -2.2))

    box(ax, 64, 11, 28, 6, 'Approved\n+25 points', fill=GOOD_FILL, edge=GOOD, size=6.0)
    # Label placed near the tail of the arrow: at the midpoint it landed on the
    # committee box, which is where every earlier attempt put it.
    arrow(ax, (38, 21.5), (64, 15.5), label='approve, final', colour=GOOD,
          label_pos=0.16, label_offset=(0, -2.2), rad=-0.08)

    box(ax, 64, 1.5, 28, 6, 'Implemented\n+65 points · ROI recorded',
        fill=GOOD_MID, edge=GOOD, size=6.0)
    arrow(ax, (78, 11), (78, 7.6), colour=GOOD)

    box(ax, 28, 1.5, 30, 6, 'Pushed to QCMS\nwhere it is configured',
        fill=EXTERNAL_FILL, edge=EXTERNAL, size=6.0)
    arrow(ax, (64, 4.5), (58, 4.5), colour=EXTERNAL)

    note(ax, 3, 7.5, 'Points are awarded once, at each step.\nAn idea can be archived from any state — that hides it, it does not delete it.')
    return save(fig, 'F1_idea_lifecycle')


def f2_registration():
    """An MSME applying, and what happens to the application."""
    fig, ax = canvas(9.2, 5.4)
    ax.text(46, 52, 'MSME registration and approval', ha='center', fontsize=9.2,
            fontweight='bold', family='DejaVu Sans')

    box(ax, 3, 43, 24, 5.6, 'Visits the landing page', fill=FILL_PLAIN, size=6.4)
    box(ax, 3, 35, 24, 5.6, 'Apply for a workspace', fill=FILL_SOFT, size=6.4)
    arrow(ax, (15, 43), (15, 40.6))

    box(ax, 3, 27, 24, 5.6, 'Step 1  company + applicant', fill=FILL_PLAIN, size=6.2)
    arrow(ax, (15, 35), (15, 32.6))

    d = diamond(ax, 15, 19, 22, 8, 'Work email\ndomain?')
    arrow(ax, (15, 27), (15, 23))

    box(ax, 3, 8, 24, 6, 'Refused there and then,\nbefore the long form',
        fill=STOP_FILL, edge=STOP, size=6.2)
    arrow(ax, (15, 15), (15, 14), label='gmail / outlook /\ndisposable', label_offset=(0, -3.5))

    box(ax, 36, 27, 26, 5.6, 'Step 2  statutory identity\nUdyam · GSTIN · PAN · CIN', fill=FILL_PLAIN, size=6.2)
    arrow(ax, (26, 19), (49, 30), label='corporate', rad=-0.2)

    box(ax, 36, 19, 26, 5.6, 'Step 3  address + review', fill=FILL_PLAIN, size=6.2)
    arrow(ax, (49, 27), (49, 24.6))

    box(ax, 36, 11, 26, 5.6, 'Stored as pending\nnothing is provisioned', fill=FILL_MED, size=6.2)
    arrow(ax, (49, 19), (49, 16.6))

    box(ax, 70, 27, 24, 5.6, 'Platform admin reviews it', fill=FILL_SOFT, size=6.4)
    arrow(ax, (62, 14), (82, 27), rad=-0.25)

    d2 = diamond(ax, 82, 19, 22, 8, 'Approve or\nreject?')
    arrow(ax, (82, 27), (82, 23))

    box(ax, 70, 8, 24, 6, 'Rejected — with a reason,\nthey can apply again',
        fill=STOP_FILL, edge=STOP, size=6.2)
    arrow(ax, (73, 17), (78, 14), label='reject', colour=STOP)

    box(ax, 36, 2, 58, 5, 'Approved  —  database provisioned  ·  first admin created  ·  plan and trial set  ·  '
                          'temporary password shown once', fill=GOOD_FILL, edge=GOOD, size=6.2)
    arrow(ax, (86, 15), (86, 7), colour=GOOD)

    note(ax, 3, 5.5, 'Nothing an anonymous caller does provisions anything.\n'
                     'The worst a flood of junk applications achieves is a full review queue.')
    return save(fig, 'F2_registration')


def f3_authentication():
    """The ways somebody can sign in, and what happens on failure."""
    fig, ax = canvas(9.2, 4.6)
    ax.text(46, 44, 'Signing in', ha='center', fontsize=9.2,
            fontweight='bold', family='DejaVu Sans')

    box(ax, 32, 35, 28, 5.6, 'Enters email, phone or\nemployee number', fill=FILL_PLAIN, size=6.4)

    d = diamond(ax, 46, 27, 26, 8, 'Organisation code\ngiven?')
    arrow(ax, (46, 35), (46, 31))

    box(ax, 4, 24, 24, 6, 'Looked up in the\nsign-in directory', fill=FILL_SOFT, size=6.2)
    arrow(ax, (33, 27), (28, 27), label='no')
    box(ax, 66, 24, 26, 6, 'That organisation\nis used directly', fill=FILL_SOFT, size=6.2)
    arrow(ax, (59, 27), (66, 27), label='yes')

    box(ax, 30, 15, 32, 6, 'Password compared with bcrypt —\nalways, even for an unknown account',
        fill=FILL_MED, size=6.2)
    arrow(ax, (16, 24), (38, 21), rad=0.15)
    arrow(ax, (79, 24), (56, 21), rad=-0.15)

    d2 = diamond(ax, 46, 8, 24, 7, 'Correct?')
    arrow(ax, (46, 15), (46, 11.5))

    box(ax, 66, 5, 26, 6, 'Signed in — token carries\nthe password stamp',
        fill=GOOD_FILL, edge=GOOD, size=6.2)
    arrow(ax, (58, 8), (66, 8), label='yes', colour=GOOD)

    box(ax, 4, 5, 26, 6, 'Counted. Five wrong\n= locked for 15 minutes',
        fill=STOP_FILL, edge=STOP, size=6.2)
    arrow(ax, (34, 8), (30, 8), label='no', colour=STOP)

    note(ax, 4, 3, 'Every failure answers the same way and takes the same time, so the response cannot be used to\n'
                   'test which addresses are registered. The user is re-read from the database on every later request,\n'
                   'so deactivation, a role change and a password reset all take effect immediately.')
    return save(fig, 'F3_authentication')


def f4_visibility():
    """Who can see what."""
    fig, ax = canvas(9.2, 4.4)
    ax.text(46, 42, 'Who sees what', ha='center', fontsize=9.2,
            fontweight='bold', family='DejaVu Sans')

    group(ax, 3, 20, 40, 18, 'IFQM platform administrator')
    for label, x, y in [('Organisations +\naggregate counts', 6, 30),
                        ('Registration queue', 25, 30),
                        ('Support tickets', 6, 22.5),
                        ('Sign-in activity', 25, 22.5)]:
        box(ax, x, y, 16, 6, label, fill=FILL_SOFT, size=5.9)

    box(ax, 3, 12, 40, 6, 'NEVER: employee rows · idea content · files',
        fill=STOP_FILL, edge=STOP, size=6.4, dashed=True)

    group(ax, 50, 8, 44, 30, 'Inside one organisation')
    for label, x, y, fill in [
        ('Org admin — everything in their organisation', 53, 31, FILL_DARK),
        ('Plant head / executive — all ideas', 53, 24.5, FILL_MED),
        ('Manager — the ideas of the people who report to them', 53, 18, FILL_SOFT),
        ('Employee — their own ideas, plus titles and a gist of the rest', 53, 11.5, FILL_PLAIN),
    ]:
        box(ax, x, y, 38, 5.6, label, fill=fill, size=6.1)

    arrow(ax, (43, 27), (50, 27), label='provisions,\nnever reads', dashed=True, label_offset=(0, 3.5))

    note(ax, 3, 9, 'How much of a proposal a colleague can read is set per organisation, on top of the role scoping above:\n'
                   'the one-line gist by default, more if the organisation opens it. Authors and reviewers are never restricted.')
    return save(fig, 'F4_visibility')


def f0_overview():
    """How the five flows fit together — the map before the detail."""
    fig, ax = canvas(10.0, 3.4)

    ax.text(50, 32, 'How these flows fit together', ha='center', fontsize=9.4,
            fontweight='bold', family='DejaVu Sans')

    stages = [
        ('1', 'An MSME applies\nand is approved', EXTERNAL_FILL, EXTERNAL, 'once'),
        ('2', 'Their people\nsign in', PRIMARY_FILL, PRIMARY, 'every day'),
        ('3', 'Ideas are raised,\nreviewed, implemented', PRIMARY_MID, PRIMARY, 'the core loop'),
        ('4', 'Who may read\nwhat, throughout', DATA_FILL, DATA, 'always'),
    ]
    x = 3
    for num, label, fill, edge, cadence in stages:
        box(ax, x, 12, 20, 11, label, fill=fill, edge=edge, size=7.0)
        # The number sits on the block, so the section it points at is obvious.
        box(ax, x + 0.8, 21.4, 4, 4, num, fill=edge, edge=edge, size=7.2, bold=True)
        ax.text(x + 10, 9.6, cadence, ha='center', va='top', fontsize=6.2,
                family='DejaVu Sans', color=GREY)
        if x > 3:
            arrow(ax, (x - 3.6, 17.5), (x, 17.5))
        x += 23.6

    note(ax, 50, 6,
         'Sections 1 to 4 below take each of these in turn. Section 5 is when each part was built.',
         ha='center')
    return save(fig, 'F0_overview')


def f5_timeline():
    """When each part of the product was built."""
    fig, ax = canvas(10.2, 4.2)

    ax.text(51, 40, 'How the product was built', ha='center', fontsize=9.4,
            fontweight='bold', family='DejaVu Sans')

    # The spine. Phases before the review meeting are deliberately unanchored —
    # the repository has the commit dates, and inventing precise milestones for
    # a handover document would be worse than saying so.
    ax.plot([6, 96], [24, 24], color=PRIMARY, lw=2.4, zorder=2)

    phases = [
        ('Early 2026', ['PHP prototype', 'capture + basic review'], EXTERNAL_FILL, EXTERNAL, 12),
        ('Foundations', ['multi-tenancy', 'React + Node rewrite', 'JWT sessions'], PRIMARY_FILL, PRIMARY, 30),
        ('The product', ['approval chains · SLA', 'points · leaderboard',
                         'ROI · analytics · audit'], PRIMARY_MID, PRIMARY, 50),
        ('Hardening', ['lockout · per-request auth', '7 languages · bulk import',
                       'QCMS integration'], DATA_FILL, DATA, 70),
        ('Now', ['self-registration · billing', 'privacy controls', 'live deployment'],
         GOOD_FILL, GOOD, 90),
    ]
    for i, (title, items, fill, edge, x) in enumerate(phases):
        above = i % 2 == 0
        y = 27 if above else 8
        h = 9.5
        box(ax, x - 9, y, 18, h, title + '\n\n' + '\n'.join(items),
            fill=fill, edge=edge, size=5.8)
        # A marker on the spine, and a stem to the card.
        ax.plot([x, x], [24, y + (0 if above else h)], color=edge, lw=1.2, zorder=3)
        ax.add_patch(__import__('matplotlib').patches.Circle(
            (x, 24), 1.5, linewidth=1.6, edgecolor=edge, facecolor='white', zorder=4))

    # The one date that is anchored.
    ax.plot([62, 62], [24, 21], color=STOP, lw=1.4, zorder=3)
    ax.text(62, 19.6, '29 Jul 2026\nreview meeting', ha='center', va='top', fontsize=6.2,
            family='DejaVu Sans', color=STOP, fontweight='bold')

    note(ax, 51, 4,
         'Phases before the review meeting are deliberately unanchored: the repository history carries the\n'
         'commit dates, and inventing precise milestones for a handover document would be worse than saying so.',
         ha='center')
    return save(fig, 'F5_timeline')


# Declared after every function, and the entry point after that, so a drawing
# appended to the bottom of this file cannot silently fail to be rendered.
ALL = {
    'F0_overview': f0_overview,
    'F1_idea_lifecycle': f1_idea_lifecycle,
    'F2_registration': f2_registration,
    'F3_authentication': f3_authentication,
    'F4_visibility': f4_visibility,
    'F5_timeline': f5_timeline,
}


if __name__ == '__main__':
    for name, fn in ALL.items():
        print('drew %-20s -> %s' % (name, fn()))
    print(chr(10) + '%d diagram(s) written.' % len(ALL))
