# -*- coding: utf-8 -*-
"""
Render the five artwork slots used by the Employee Ideation Tool deck.

    python "Customer Presentation/build_images.py"

Each image is drawn at the EXACT pixel size of the slot it replaces in
V2_DWM_Overview.pptx, so the picture frames in the copied deck keep their
positions and crops without a single number being touched:

    image9.png   1536 x 1024   system architecture
    image10.png  1732 x  908   employee dashboard
    image11.png  1912 x 1000   review and approval queue
    image12.png  1912 x 1006   organisation analytics
    image13.png  1567 x  904   platform console

The palette is the deck's own — purple headings, orange accent, navy text — so
the artwork sits inside the design rather than beside it.

These are rendered representations of the real screens, built from the actual
metric names, statuses, roles and approval chain in the codebase. They are not
photographs of a running instance.
"""
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Circle, Wedge, FancyArrow

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'art')
os.makedirs(OUT, exist_ok=True)

# ── The deck's palette ──────────────────────────────────────────────────────
PURPLE = '#4809BD'
ORANGE = '#E8792B'
NAVY   = '#16224E'
SLATE  = '#2A3550'
GREY   = '#667089'
BORDER = '#DCE2EC'
GREEN  = '#2C7A3F'
RED    = '#C0392B'
BLUE   = '#2B6CB0'
TEAL   = '#158B8C'
VIOLET = '#6B3FA0'
PAPER  = '#FFFFFF'
CANVAS = '#F5F6FA'
DPI    = 150


def figure(px_w, px_h, bg=CANVAS):
    fig = plt.figure(figsize=(px_w / DPI, px_h / DPI), dpi=DPI)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100 * px_h / px_w)
    ax.axis('off')
    ax.add_patch(Rectangle((0, 0), 100, 100 * px_h / px_w, fc=bg, ec='none', zorder=0))
    return fig, ax


def card(ax, x, y, w, h, fc=PAPER, ec=BORDER, lw=1.1, r=0.9, z=1):
    ax.add_patch(FancyBboxPatch(
        (x, y), w, h, boxstyle=f'round,pad=0,rounding_size={r}',
        fc=fc, ec=ec, lw=lw, zorder=z))


def txt(ax, x, y, s, size=9, color=SLATE, weight='normal', ha='left', va='center', z=3):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight,
            ha=ha, va=va, zorder=z, family='DejaVu Sans')


def chrome(ax, top, title, sub=None, width=100):
    """The app shell: a title bar with the product name and a page heading."""
    ax.add_patch(Rectangle((0, top - 4.6), width, 4.6, fc=NAVY, ec='none', zorder=2))
    txt(ax, 2.4, top - 2.3, 'IFQM', size=11, color='#FFFFFF', weight='bold')
    txt(ax, 8.4, top - 2.3, 'Employee Ideation Tool', size=8.6, color='#B9C0D6')
    for i, dot in enumerate(['Ideas', 'Board', 'Leaderboard', 'Analytics']):
        txt(ax, 34 + i * 11, top - 2.3, dot, size=8, color='#8E97B8')
    ax.add_patch(Circle((width - 3.2, top - 2.3), 1.25, fc=ORANGE, ec='none', zorder=3))
    txt(ax, width - 3.2, top - 2.35, 'RK', size=7.2, color='#FFFFFF', weight='bold', ha='center')
    if title:
        txt(ax, 2.4, top - 7.4, title, size=13, color=NAVY, weight='bold')
    if sub:
        txt(ax, 2.4, top - 10.2, sub, size=8.4, color=GREY)


def kpi(ax, x, y, w, h, label, value, unit='', accent=PURPLE, foot=None):
    card(ax, x, y, w, h)
    ax.add_patch(Rectangle((x, y), 0.55, h, fc=accent, ec='none', zorder=2))
    txt(ax, x + 2.0, y + h - 2.6, label.upper(), size=6.9, color=GREY, weight='bold')
    txt(ax, x + 2.0, y + h - 6.4, value, size=19, color=NAVY, weight='bold')
    if unit:
        txt(ax, x + 2.0 + len(value) * 2.15, y + h - 6.9, unit, size=8.5, color=accent, weight='bold')
    if foot:
        txt(ax, x + 2.0, y + 2.0, foot, size=6.8, color=GREY)


def pill(ax, x, y, w, h, label, fc, tc):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0,rounding_size=1.1',
                                fc=fc, ec='none', zorder=3))
    txt(ax, x + w / 2, y + h / 2 - 0.05, label, size=6.6, color=tc, weight='bold', ha='center')


STATUS_STYLE = {
    'Draft':        ('#EEF0F5', '#5A6478'),
    'Submitted':    ('#E7F0FB', BLUE),
    'Under Review': ('#FDF0E2', '#B4650F'),
    'Approved':     ('#E6F4EA', GREEN),
    'Implemented':  ('#EDE7F8', VIOLET),
    'Rejected':     ('#FBEAE8', RED),
}


# ── 1. System architecture ─────────────────────────────────────────────────

def architecture():
    """
    An explicit vertical stack. The bands are laid out top-down as absolute
    numbers rather than offsets from each other, because offsets are how the
    first draft ended up with the browser label inside the browser boxes and the
    external services sitting on top of the databases.
    """
    fig, ax = figure(1536, 1024)
    H = 100 * 1024 / 1536          # 66.67

    txt(ax, 50, 62.6, 'System Architecture', size=15, color=PURPLE, weight='bold', ha='center')
    txt(ax, 50, 58.4, 'One registry, one database per organisation — isolation by construction',
        size=8.2, color=GREY, ha='center')

    # ── Who uses it ──
    txt(ax, 4, 54.6, 'IN THE BROWSER', size=7.2, color=BLUE, weight='bold')
    boxes = [('Employee', 'submit · track · vote'),
             ('Reviewer', 'queue · score · approve'),
             ('Org Admin', 'users · chain · analytics'),
             ('Platform Admin', 'tenants · plans · health')]
    w = 21.8
    for i, (name, detail) in enumerate(boxes):
        x = 4 + i * (w + 1.6)
        card(ax, x, 45.0, w, 7.8, fc='#FFFFFF', ec=BLUE, lw=1.3)
        txt(ax, x + w / 2, 50.3, name, size=8.6, color=NAVY, weight='bold', ha='center')
        txt(ax, x + w / 2, 47.3, detail, size=6.8, color=GREY, ha='center')

    # ── App ──
    card(ax, 4, 37.6, 92, 5.8, fc='#EAF2FC', ec=BLUE, lw=1.3)
    txt(ax, 6.5, 40.5, 'React (Vite) single-page app', size=9.4, color=BLUE, weight='bold')
    txt(ax, 93.5, 40.5, 'role-based routing · 7 languages · responsive',
        size=7.4, color=SLATE, ha='right')

    ax.add_patch(FancyArrow(50, 37.0, 0, -2.6, width=0.26, head_width=1.4,
                            head_length=1.1, fc=GREY, ec='none', zorder=4))
    txt(ax, 51.8, 35.6, 'HTTPS · JWT', size=6.8, color=GREY)

    # ── API ──
    card(ax, 4, 27.4, 92, 6.0, fc='#E6F5F5', ec=TEAL, lw=1.3)
    txt(ax, 6.5, 30.4, 'Node.js + Express REST API', size=9.4, color=TEAL, weight='bold')
    for i, m in enumerate(['auth', 'ideas', 'workflow', 'analytics', 'billing', 'integration']):
        txt(ax, 42 + i * 9.0, 30.4, m, size=7.0, color=SLATE, ha='center')

    ax.add_patch(FancyArrow(50, 26.8, 0, -2.5, width=0.26, head_width=1.4,
                            head_length=1.1, fc=GREY, ec='none', zorder=4))

    # ── Data ──
    card(ax, 4, 13.4, 27, 10.4, fc='#F3EEFB', ec=VIOLET, lw=1.4)
    txt(ax, 17.5, 20.8, 'ifqm_master', size=9.0, color=VIOLET, weight='bold', ha='center')
    txt(ax, 17.5, 18.0, 'registry · plans · billing', size=6.9, color=SLATE, ha='center')
    txt(ax, 17.5, 15.6, 'login directory · one-time codes', size=6.9, color=SLATE, ha='center')

    for i in range(3):
        x = 36.5 + i * 20.2
        card(ax, x, 13.4, 18.2, 10.4, fc='#FFFFFF', ec=VIOLET, lw=1.2)
        txt(ax, x + 9.1, 20.8, 'ifqm_tenant_%d' % (i + 1), size=8.2, color=VIOLET,
            weight='bold', ha='center')
        txt(ax, x + 9.1, 18.0, 'users · ideas', size=6.9, color=SLATE, ha='center')
        txt(ax, x + 9.1, 15.6, 'workflow · files', size=6.9, color=SLATE, ha='center')

    txt(ax, 50, 11.2, 'One database per organisation. No query can cross the boundary.',
        size=7.6, color=RED, weight='bold', ha='center')

    # ── Outside ──
    for i, (name, detail, colour) in enumerate([
        ('SMS gateway', 'Kaleyra over Jio DLT', ORANGE),
        ('Email', 'ZeptoMail API', ORANGE),
        ('QCMS', 'approved ideas pushed', GREEN),
        ('Payments', 'Razorpay', BLUE),
    ]):
        x = 4 + i * 23.4
        card(ax, x, 2.2, 21.4, 6.6, fc='#FFFFFF', ec=colour, lw=1.2)
        txt(ax, x + 10.7, 6.4, name, size=8.0, color=colour, weight='bold', ha='center')
        txt(ax, x + 10.7, 3.9, detail, size=6.6, color=GREY, ha='center')

    fig.savefig(os.path.join(OUT, 'image9.png'), dpi=DPI, facecolor=CANVAS)
    plt.close(fig)


# ── 2. Employee dashboard ──────────────────────────────────────────────────
#
# Each of these lays its vertical budget out explicitly. The canvases are wide
# and short — H is about 52 for a 1732x908 slot — so a row pitch that looks
# reasonable in isolation walks straight off the bottom edge, which is exactly
# what the first draft did.

def employee():
    fig, ax = figure(1732, 908)
    H = 100 * 908 / 1732                      # 52.4
    chrome(ax, H, 'My Ideas', 'Everything you have raised, and where each one has reached.')

    for i, (label, value, accent, foot) in enumerate([
        ('Ideas submitted', '14', PURPLE, 'this year'),
        ('Approved', '6', GREEN, '43% of submitted'),
        ('Implemented', '3', VIOLET, 'benefit recorded'),
        ('Points earned', '395', ORANGE, '10 / 25 / 65 per stage'),
    ]):
        kpi(ax, 2.4 + i * 24.2, 30.0, 22.4, 10.0, label, value, accent=accent, foot=foot)

    # ── Recent ideas ──
    card(ax, 2.4, 2.6, 64.0, 25.4)
    txt(ax, 4.4, 25.8, 'RECENT IDEAS', size=7.0, color=GREY, weight='bold')
    for h, x in [('IDEA', 4.4), ('TITLE', 13.5), ('IMPACT', 42.0),
                 ('SCORE', 50.5), ('STATUS', 56.5)]:
        txt(ax, x, 23.2, h, size=6.3, color=GREY, weight='bold')
    ax.plot([4.0, 64.8], [22.2, 22.2], color=BORDER, lw=0.9, zorder=2)

    rows = [
        ('IDEA-0142', 'Recirculate coolant on line 3', 'High', '82', 'Implemented'),
        ('IDEA-0138', 'Ultrasonic leak detection on air lines', 'High', '77', 'Approved'),
        ('IDEA-0131', 'Single-piece flow at the packing bench', 'Medium', '64', 'Under Review'),
        ('IDEA-0127', 'Colour-code the tool trolley', 'Low', '48', 'Approved'),
        ('IDEA-0119', 'Shadow boards for the fitting bay', 'Medium', '61', 'Submitted'),
        ('IDEA-0104', 'Reuse rinse water on the plating line', 'High', '80', 'Implemented'),
    ]
    for i, (code, title, impact, score, status) in enumerate(rows):
        y = 19.9 - i * 2.95
        txt(ax, 4.4, y, code, size=6.4, color=PURPLE, weight='bold')
        txt(ax, 13.5, y, title, size=6.7, color=SLATE)
        txt(ax, 42.0, y, impact, size=6.4, color=GREY)
        txt(ax, 50.5, y, score, size=6.7, color=NAVY, weight='bold')
        fc, tc = STATUS_STYLE[status]
        pill(ax, 56.1, y - 1.05, 7.4, 2.1, status, fc, tc)

    # ── Approval chain ──
    card(ax, 68.6, 2.6, 29.0, 25.4)
    txt(ax, 70.6, 25.8, 'YOUR APPROVAL CHAIN', size=7.0, color=ORANGE, weight='bold')
    chain = [('You', 'submitted', GREEN),
             ('Immediate Manager', 'approved', GREEN),
             ('Department Manager', 'with them now', ORANGE),
             ('Plant Head', 'final decision', '#C3C8D6')]
    for i, (role, state, colour) in enumerate(chain):
        y = 22.4 - i * 4.1
        ax.add_patch(Circle((72.4, y), 0.8, fc=colour, ec='none', zorder=4))
        if i < len(chain) - 1:
            ax.plot([72.4, 72.4], [y - 0.8, y - 3.3], color=BORDER, lw=1.3, zorder=2)
        txt(ax, 75.0, y + 0.75, role, size=7.0, color=NAVY, weight='bold')
        txt(ax, 75.0, y - 1.35, state, size=6.2, color=GREY)

    card(ax, 70.6, 2.9, 25.0, 4.4, fc='#FDF3E8', ec='#F0C79A')
    txt(ax, 72.6, 6.0, 'NEXT BADGE  ·  105 points to Gold', size=6.4, color=ORANGE, weight='bold')
    ax.add_patch(Rectangle((72.6, 3.9), 20.6, 0.8, fc='#F0DCC4', ec='none', zorder=3))
    ax.add_patch(Rectangle((72.6, 3.9), 13.6, 0.8, fc=ORANGE, ec='none', zorder=4))

    fig.savefig(os.path.join(OUT, 'image10.png'), dpi=DPI, facecolor=CANVAS)
    plt.close(fig)


# ── 3. Review and approval queue ───────────────────────────────────────────

def review():
    fig, ax = figure(1912, 1000)
    H = 100 * 1000 / 1912                     # 52.3
    chrome(ax, H, 'Review Queue', 'What is waiting on you, and how long it has been waiting.')

    for i, (label, value, accent, foot) in enumerate([
        ('Waiting on you', '9', ORANGE, '2 past SLA'),
        ('Approved this month', '23', GREEN, 'by your chain'),
        ('Average time to decide', '3.4', BLUE, 'days'),
        ('Escalated to you', '4', VIOLET, 'from your reports'),
    ]):
        kpi(ax, 2.2 + i * 24.4, 30.0, 22.6, 10.0, label, value, accent=accent, foot=foot)

    card(ax, 2.2, 2.6, 95.6, 25.2)
    for h, x in [('IDEA', 4.2), ('TITLE', 12.6), ('SUBMITTED BY', 44.0),
                 ('DEPARTMENT', 58.5), ('WAITING', 70.5), ('SCORE', 78.2), ('ACTION', 85.5)]:
        txt(ax, x, 25.2, h, size=6.2, color=GREY, weight='bold')
    ax.plot([3.8, 96.2], [24.0, 24.0], color=BORDER, lw=0.9, zorder=2)

    rows = [
        ('IDEA-0151', 'Quick-change fixture for the press line', 'A. Kulkarni', 'Production', '1 day', '86'),
        ('IDEA-0149', 'Vacuum pick-up for small castings', 'S. Iyer', 'Assembly', '2 days', '74'),
        ('IDEA-0147', 'Standardise the daily start-up check', 'M. Fernandes', 'Quality', '4 days', '69'),
        ('IDEA-0145', 'LED task lighting at inspection', 'R. Bhat', 'Quality', '5 days', '58'),
        ('IDEA-0143', 'Move the scrap bin closer to the cell', 'T. Nayak', 'Production', '6 days', '52'),
        ('IDEA-0140', 'Digital torque log instead of paper', 'P. Shetty', 'Maintenance', '8 days', '81'),
    ]
    for i, (code, title, who, dept, wait, score) in enumerate(rows):
        y = 21.6 - i * 3.15
        if i % 2 == 0:
            ax.add_patch(Rectangle((3.4, y - 1.5), 92.8, 3.0, fc='#FAFBFD', ec='none', zorder=1))
        txt(ax, 4.2, y, code, size=6.3, color=PURPLE, weight='bold')
        txt(ax, 12.6, y, title, size=6.7, color=SLATE)
        txt(ax, 44.0, y, who, size=6.4, color=SLATE)
        txt(ax, 58.5, y, dept, size=6.4, color=GREY)
        overdue = int(wait.split()[0]) >= 5
        txt(ax, 70.5, y, wait, size=6.4, color=RED if overdue else GREY,
            weight='bold' if overdue else 'normal')
        txt(ax, 78.2, y, score, size=6.8, color=NAVY, weight='bold')
        pill(ax, 84.6, y - 1.05, 5.6, 2.1, 'Approve', '#E6F4EA', GREEN)
        pill(ax, 90.6, y - 1.05, 5.2, 2.1, 'Reject', '#FBEAE8', RED)

    fig.savefig(os.path.join(OUT, 'image11.png'), dpi=DPI, facecolor=CANVAS)
    plt.close(fig)


# ── 4. Organisation analytics ──────────────────────────────────────────────

def analytics():
    fig, ax = figure(1912, 1006)
    H = 100 * 1006 / 1912                     # 52.6
    chrome(ax, H, 'Analytics', 'Where ideas come from, how fast they move, and what they are worth.')

    for i, (label, value, unit, accent, foot) in enumerate([
        ('Total ideas submitted', '486', '', PURPLE, 'across 9 departments'),
        ('Approval rate', '61', '%', GREEN, 'approved and implemented'),
        ('Implementation rate', '28', '%', VIOLET, 'ideas taken through'),
        ('Avg quality score', '68', '', ORANGE, 'across all submitted ideas'),
    ]):
        kpi(ax, 2.2 + i * 24.4, 30.2, 22.6, 10.0, label, value, unit=unit,
            accent=accent, foot=foot)

    # ── Ideas per month ──
    card(ax, 2.2, 2.6, 45.6, 25.2)
    txt(ax, 4.4, 25.4, 'IDEAS PER MONTH', size=6.9, color=GREY, weight='bold')
    vals = [22, 31, 28, 44, 39, 52, 47, 58, 61, 55, 66, 63]
    months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']
    base, top = 6.6, 21.6
    for i, v in enumerate(vals):
        x = 5.2 + i * 3.5
        h = (v / 70.0) * (top - base)
        ax.add_patch(FancyBboxPatch((x, base), 2.5, h, boxstyle='round,pad=0,rounding_size=0.3',
                                    fc=PURPLE if i < 11 else ORANGE, ec='none', zorder=3))
        txt(ax, x + 1.25, base - 1.5, months[i], size=5.4, color=GREY, ha='center')
        txt(ax, x + 1.25, base + h + 1.0, str(v), size=5.5, color=NAVY, ha='center', weight='bold')

    # ── Status split ──
    card(ax, 49.6, 2.6, 22.4, 25.2)
    txt(ax, 51.8, 25.4, 'STATUS SPLIT', size=6.9, color=GREY, weight='bold')
    parts = [('Implemented', 28, VIOLET), ('Approved', 33, GREEN),
             ('Under Review', 21, ORANGE), ('Rejected', 12, RED), ('Submitted', 6, BLUE)]
    cx, cy, r0 = 60.8, 17.6, 5.6
    start = 90
    for _, pct, colour in parts:
        ext = 360 * pct / 100.0
        ax.add_patch(Wedge((cx, cy), r0, start - ext, start, width=2.2,
                           fc=colour, ec='none', zorder=4))
        start -= ext
    for i, (name, pct, colour) in enumerate(parts):
        y = 10.4 - i * 1.85
        ax.add_patch(Rectangle((52.0, y - 0.42), 1.2, 0.85, fc=colour, ec='none', zorder=4))
        txt(ax, 54.0, y, name, size=6.2, color=SLATE)
        txt(ax, 69.8, y, str(pct) + '%', size=6.2, color=NAVY, weight='bold', ha='right')

    # ── By department ──
    card(ax, 73.8, 2.6, 24.0, 25.2)
    txt(ax, 76.0, 25.4, 'BY DEPARTMENT', size=6.9, color=GREY, weight='bold')
    depts = [('Production', 132), ('Assembly', 96), ('Quality', 78),
             ('Maintenance', 64), ('Stores', 51), ('Logistics', 38), ('Tool Room', 27)]
    for i, (name, n) in enumerate(depts):
        y = 21.8 - i * 3.0
        txt(ax, 76.0, y + 0.95, name, size=6.4, color=SLATE)
        txt(ax, 95.8, y + 0.95, str(n), size=6.4, color=NAVY, weight='bold', ha='right')
        ax.add_patch(Rectangle((76.0, y - 0.85), 19.8, 0.9, fc='#EDEFF5', ec='none', zorder=3))
        ax.add_patch(Rectangle((76.0, y - 0.85), 19.8 * n / 132.0, 0.9,
                               fc=PURPLE, ec='none', zorder=4))

    fig.savefig(os.path.join(OUT, 'image12.png'), dpi=DPI, facecolor=CANVAS)
    plt.close(fig)


# ── 5. Platform console ────────────────────────────────────────────────────

def console():
    fig, ax = figure(1567, 904)
    H = 100 * 904 / 1567                      # 57.7

    ax.add_patch(Rectangle((0, H - 4.8), 100, 4.8, fc=PURPLE, ec='none', zorder=2))
    txt(ax, 2.6, H - 2.4, 'IFQM', size=11, color='#FFFFFF', weight='bold')
    txt(ax, 9.4, H - 2.4, 'Platform Console', size=8.6, color='#D6C6F2')
    for i, item in enumerate(['Organisations', 'Plans', 'Registrations', 'Settings', 'Health']):
        txt(ax, 34 + i * 12.5, H - 2.4, item, size=7.4, color='#C4B2E8')
    txt(ax, 2.6, H - 8.2, 'Organisations', size=13, color=NAVY, weight='bold')
    txt(ax, 2.6, H - 11.4, 'Every customer on the platform, what they pay and how much they use.',
        size=8.0, color=GREY)

    for i, (label, value, accent, foot) in enumerate([
        ('Organisations', '5', PURPLE, '4 active · 1 trial'),
        ('Employees', '1,284', BLUE, 'across all tenants'),
        ('Ideas captured', '3,910', GREEN, 'all organisations'),
        ('Pushed to QC', '742', VIOLET, 'tracked as work'),
    ]):
        kpi(ax, 2.6 + i * 24.2, 33.4, 22.4, 10.2, label, value, accent=accent, foot=foot)

    card(ax, 2.6, 2.8, 94.8, 28.2)
    for h, x in [('ORGANISATION', 4.8), ('CODE', 30.0), ('PLAN', 41.0), ('USERS', 58.0),
                 ('IDEAS', 66.0), ('RENEWS', 74.0), ('STATUS', 86.0)]:
        txt(ax, x, 28.4, h, size=6.2, color=GREY, weight='bold')
    ax.plot([4.4, 95.6], [27.1, 27.1], color=BORDER, lw=0.9, zorder=2)

    rows = [
        ('TVS Motors', 'tvs-motors', 'Professional', '486', '1,742', '12 Mar 2027', 'Active', GREEN),
        ('Biocon Group', 'biocon-group', 'Professional', '392', '1,105', '04 Jan 2027', 'Active', GREEN),
        ('Jain University', 'jain-uni', 'Starter', '210', '640', '28 Sep 2026', 'Active', GREEN),
        ('Nandi Precision', 'nandi', 'Lifetime (Free)', '124', '318', 'never', 'Lifetime', VIOLET),
        ('Peenya Tooling', 'peenya', 'Free Trial', '72', '105', '02 Sep 2026', 'Trial', ORANGE),
    ]
    for i, (name, code, plan, users, ideas, renew, status, colour) in enumerate(rows):
        y = 24.0 - i * 4.3
        if i % 2 == 0:
            ax.add_patch(Rectangle((4.0, y - 2.0), 92.0, 4.0, fc='#FAFBFD', ec='none', zorder=1))
        txt(ax, 4.8, y, name, size=7.4, color=NAVY, weight='bold')
        txt(ax, 30.0, y, code, size=6.7, color=GREY)
        txt(ax, 41.0, y, plan, size=6.9, color=SLATE)
        txt(ax, 58.0, y, users, size=6.9, color=SLATE)
        txt(ax, 66.0, y, ideas, size=6.9, color=SLATE)
        txt(ax, 74.0, y, renew, size=6.7, color=GREY)
        fc = {'Active': '#E6F4EA', 'Lifetime': '#EDE7F8', 'Trial': '#FDF0E2'}[status]
        pill(ax, 85.5, y - 1.25, 8.4, 2.5, status, fc, colour)

    fig.savefig(os.path.join(OUT, 'image13.png'), dpi=DPI, facecolor=CANVAS)
    plt.close(fig)


if __name__ == '__main__':
    architecture(); print('image9.png   architecture')
    employee();     print('image10.png  employee dashboard')
    review();       print('image11.png  review queue')
    analytics();    print('image12.png  analytics')
    console();      print('image13.png  platform console')
    print('\nwritten to', OUT)
