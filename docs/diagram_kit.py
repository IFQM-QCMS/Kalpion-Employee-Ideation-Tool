# -*- coding: utf-8 -*-
"""
A small drawing kit for the architecture document.

The diagrams used to be box-drawing characters in a monospace block. That was a
reasonable choice while the document was being written — it kept everything in
one text file and it never went out of date with a rendering step — but the
result reads as a wall of dashes rather than as a picture, and an entity
relationship diagram drawn in `+---+` is genuinely hard to follow.

So each figure is now drawn: real boxes with real borders, arrows with real
heads, and crow's-foot notation where a relationship has a cardinality.

Colour carries information rather than decorating. Six roles — the system
itself, anywhere data rests, a decision, a good outcome, a refusal, and anything
outside our control — each with a fill and a matching darker outline. A reader
should be able to pick the outcome nobody wanted out of a diagram without
reading a word of it.

Fills stay light because these sit next to 10pt body text, and text colour is
chosen from the fill's brightness so a label never disappears into its box.

Everything renders to PNG at print resolution and is embedded in the .docx.
"""
import os

import matplotlib
matplotlib.use('Agg')                       # no display on a build machine
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Circle, Ellipse, Polygon, FancyArrowPatch

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diagrams')
os.makedirs(OUT_DIR, exist_ok=True)

DPI = 200
FONT = 'DejaVu Sans'

# ── palette ──────────────────────────────────────────────────────────────────
#
# Colour here is information, not decoration. Six roles, and a reader should be
# able to tell them apart at a glance without reading a word:
#
#   PRIMARY    the system itself, and the path through it
#   DATA       anywhere data rests — databases, stores, tables
#   DECISION   a branch: a question with more than one answer
#   GOOD       an outcome somebody wanted
#   STOP       an outcome nobody wanted, or a refusal
#   EXTERNAL   something outside our control
#
# Each has a fill and a darker line, so a box reads as one thing rather than as
# a colour with an unrelated border. Fills are kept light: these are printed
# alongside body text, and a saturated block next to 10pt type is hard to read
# through.

INK = '#1f2430'          # body text on a light fill
INK_ON_DARK = '#ffffff'
GREY = '#5b6472'         # notes and captions
LINE = '#2b3444'         # the default outline

PRIMARY = '#4f46e5'      # indigo — matches the product
PRIMARY_FILL = '#e8e6fb'
PRIMARY_MID = '#c9c4f5'
PRIMARY_DEEP = '#4f46e5'

DATA = '#0e7490'         # teal
DATA_FILL = '#dcf1f5'
DATA_MID = '#b3e0ea'

DECISION = '#b45309'     # amber
DECISION_FILL = '#fdf0d9'

GOOD = '#15803d'         # green
GOOD_FILL = '#dcf3e4'
GOOD_MID = '#b4e3c6'

STOP = '#b91c1c'         # red
STOP_FILL = '#fdE3E3'

EXTERNAL = '#475569'     # slate
EXTERNAL_FILL = '#eef1f5'

# The four names the figures already use, mapped onto the palette. Keeping them
# means every existing drawing recolours without being rewritten.
FILL_PLAIN = '#ffffff'
FILL_SOFT = PRIMARY_FILL
FILL_MED = PRIMARY_MID
FILL_DARK = '#a5a0ee'


def _luminance(hex_colour):
    """Rough perceived brightness, for choosing black or white text."""
    h = hex_colour.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ink_for(fill):
    """
    Text colour that stays legible on a given fill.

    Chosen rather than fixed, because a diagram gains a dark box the moment
    somebody wants to emphasise something, and black text on it disappears. This
    is the kind of thing nobody notices until it is wrong.
    """
    try:
        return INK if _luminance(fill) > 0.55 else INK_ON_DARK
    except Exception:
        return INK


def canvas(w, h):
    """A figure measured in diagram units, with no axes and no margins."""
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w * 10)
    ax.set_ylim(0, h * 10)
    ax.set_aspect('equal')
    ax.axis('off')
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    return fig, ax


def save(fig, name):
    path = os.path.join(OUT_DIR, name + '.png')
    fig.savefig(path, dpi=DPI, facecolor='white', bbox_inches='tight', pad_inches=0.06)
    plt.close(fig)
    return path


# ── primitives ───────────────────────────────────────────────────────────────

def box(ax, x, y, w, h, text, *, fill=FILL_PLAIN, edge=None, size=7.2, bold=False,
        rounded=True, dashed=False, lw=1.2, align='center'):
    """A rectangle with centred, wrapped text. Returns its centre."""
    style = 'round,pad=0,rounding_size=1.6' if rounded else 'square,pad=0'
    patch = FancyBboxPatch(
        (x, y), w, h, boxstyle=style,
        linewidth=lw, edgecolor=edge or LINE, facecolor=fill,
        linestyle='--' if dashed else '-', zorder=2,
    )
    ax.add_patch(patch)
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center',
            fontsize=size, family=FONT, color=ink_for(fill),
            fontweight='bold' if bold else 'normal', zorder=3, linespacing=1.35)
    return (x + w / 2, y + h / 2)


def store(ax, x, y, w, h, text, *, size=7.0, fill=None, edge=None):
    """An open-ended store, the usual notation for a place data rests."""
    fill = fill or DATA_FILL
    edge = edge or DATA
    ax.add_patch(Rectangle((x, y), w, h, linewidth=0, facecolor=fill, zorder=1))
    ax.plot([x, x + w], [y + h, y + h], color=edge, lw=1.4, zorder=2)
    ax.plot([x, x + w], [y, y], color=edge, lw=1.4, zorder=2)
    ax.plot([x, x], [y, y + h], color=edge, lw=1.4, zorder=2)
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center',
            fontsize=size, family=FONT, color=INK, zorder=3, linespacing=1.35)
    return (x + w / 2, y + h / 2)


def cylinder(ax, x, y, w, h, text, *, size=7.0, fill=None, edge=None):
    """A database."""
    fill = fill or DATA_FILL
    edge = edge or DATA
    er = h * 0.13
    ax.add_patch(Rectangle((x, y + er), w, h - 2 * er, linewidth=0, facecolor=fill, zorder=1))
    ax.add_patch(Ellipse((x + w / 2, y + h - er), w, 2 * er, linewidth=1.3,
                         edgecolor=edge, facecolor=fill, zorder=2))
    ax.add_patch(Ellipse((x + w / 2, y + er), w, 2 * er, linewidth=1.3,
                         edgecolor=edge, facecolor=fill, zorder=1))
    ax.plot([x, x], [y + er, y + h - er], color=edge, lw=1.3, zorder=2)
    ax.plot([x + w, x + w], [y + er, y + h - er], color=edge, lw=1.3, zorder=2)
    ax.text(x + w / 2, y + h / 2 - er * 0.3, text, ha='center', va='center',
            fontsize=size, family=FONT, color=INK, zorder=3, linespacing=1.35)
    return (x + w / 2, y + h / 2)


def diamond(ax, cx, cy, w, h, text, *, size=6.8, fill=None, edge=None):
    """A decision. Amber by default — a branch is a different kind of thing."""
    fill = fill or DECISION_FILL
    edge = edge or DECISION
    pts = [(cx, cy + h / 2), (cx + w / 2, cy), (cx, cy - h / 2), (cx - w / 2, cy)]
    ax.add_patch(Polygon(pts, closed=True, linewidth=1.3, edgecolor=edge,
                         facecolor=fill, zorder=2))
    ax.text(cx, cy, text, ha='center', va='center', fontsize=size,
            family=FONT, color=ink_for(fill), zorder=3, linespacing=1.3)
    return (cx, cy)


def actor(ax, cx, cy, label, *, size=7.0, scale=1.0, colour=None):
    """A stick figure, for a person outside the system."""
    colour = colour or PRIMARY
    r = 1.5 * scale
    ax.add_patch(Circle((cx, cy + 4 * scale), r, linewidth=1.4, edgecolor=colour,
                        facecolor=PRIMARY_FILL, zorder=2))
    ax.plot([cx, cx], [cy + 4 * scale - r, cy - 0.6 * scale], color=colour, lw=1.4, zorder=2)
    ax.plot([cx - 2.2 * scale, cx + 2.2 * scale], [cy + 1.6 * scale, cy + 1.6 * scale],
            color=colour, lw=1.4, zorder=2)
    ax.plot([cx, cx - 1.8 * scale], [cy - 0.6 * scale, cy - 4 * scale], color=colour, lw=1.4, zorder=2)
    ax.plot([cx, cx + 1.8 * scale], [cy - 0.6 * scale, cy - 4 * scale], color=colour, lw=1.4, zorder=2)
    ax.text(cx, cy - 6.2 * scale, label, ha='center', va='top', fontsize=size,
            family=FONT, color=INK, zorder=3, linespacing=1.3)


def oval(ax, cx, cy, w, h, text, *, size=6.9, fill=None, edge=None):
    fill = fill or PRIMARY_FILL
    ax.add_patch(Ellipse((cx, cy), w, h, linewidth=1.2, edgecolor=edge or PRIMARY,
                         facecolor=fill, zorder=2))
    ax.text(cx, cy, text, ha='center', va='center', fontsize=size,
            family=FONT, color=ink_for(fill), zorder=3, linespacing=1.3)
    return (cx, cy)


def band(ax, x, y, w, h, title, *, fill=None, edge=None, size=7.4):
    """A horizontal layer with its name on the left."""
    fill = fill or PRIMARY_FILL
    ax.add_patch(Rectangle((x, y), w, h, linewidth=1.2, edgecolor=edge or PRIMARY,
                           facecolor=fill, zorder=1))
    ax.text(x + 1.6, y + h / 2, title, ha='left', va='center', fontsize=size,
            family=FONT, color=ink_for(fill), fontweight='bold', zorder=3, rotation=0)


def group(ax, x, y, w, h, title, *, size=7.0, colour=None):
    """A dashed boundary around several boxes."""
    colour = colour or EXTERNAL
    ax.add_patch(Rectangle((x, y), w, h, linewidth=1.1, edgecolor=colour,
                           facecolor='none', linestyle=(0, (4, 3)), zorder=1))
    ax.text(x + 1.2, y + h - 1.2, title, ha='left', va='top', fontsize=size,
            family=FONT, color=colour, fontweight='bold', zorder=3)


def arrow(ax, start, end, *, label=None, size=6.4, style='-|>', dashed=False,
          rad=0.0, lw=1.2, label_pos=0.5, label_offset=(0, 1.1), colour=None):
    """A connector. `rad` bends it, which is how crossings are avoided."""
    ax.add_patch(FancyArrowPatch(
        start, end, arrowstyle=style, mutation_scale=9,
        linewidth=lw, color=colour or LINE, zorder=4,
        linestyle='--' if dashed else '-',
        connectionstyle='arc3,rad=%s' % rad,
        shrinkA=1.5, shrinkB=1.5,
    ))
    if label:
        lx = start[0] + (end[0] - start[0]) * label_pos + label_offset[0]
        ly = start[1] + (end[1] - start[1]) * label_pos + label_offset[1]
        ax.text(lx, ly, label, ha='center', va='center', fontsize=size,
                family=FONT, color=colour or INK, zorder=5, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.18', facecolor='white',
                          edgecolor='none', alpha=0.96))


def note(ax, x, y, text, *, size=6.4, ha='left'):
    ax.text(x, y, text, ha=ha, va='top', fontsize=size, family=FONT,
            color=GREY, zorder=3, linespacing=1.4)


# ── entity relationship ──────────────────────────────────────────────────────

def entity(ax, x, y, w, name, columns, *, row_h=3.0, head_h=3.6, size=6.3,
           accent=None):
    """
    An entity: a titled header over one row per column.

    A key column is marked in the left gutter — PK for the identifier, FK for a
    pointer to another table — which is the part a `+----+` drawing could only
    do by writing the letters into the text and hoping they lined up.
    """
    accent = accent or PRIMARY
    head_fill = accent
    h = head_h + row_h * len(columns)
    ax.add_patch(Rectangle((x, y - h + head_h), w, h - head_h, linewidth=1.2,
                           edgecolor=accent, facecolor='#ffffff', zorder=2))
    ax.add_patch(Rectangle((x, y), w, head_h, linewidth=1.2,
                           edgecolor=accent, facecolor=head_fill, zorder=2))
    ax.text(x + w / 2, y + head_h / 2, name, ha='center', va='center',
            fontsize=size + 0.7, family=FONT, color=ink_for(head_fill),
            fontweight='bold', zorder=3)

    gutter = 4.2
    ax.plot([x + gutter, x + gutter], [y, y - h + head_h], color=accent, lw=0.7,
            alpha=0.5, zorder=3)
    for i, (key, col) in enumerate(columns):
        cy = y - row_h * (i + 0.5)
        if i:
            ax.plot([x, x + w], [y - row_h * i, y - row_h * i], color='#bbbbbb', lw=0.5, zorder=3)
        if key:
            ax.text(x + gutter / 2, cy, key, ha='center', va='center', fontsize=size - 0.9,
                    family=FONT, color=accent, fontweight='bold', zorder=3)
        ax.text(x + gutter + 1.0, cy, col, ha='left', va='center', fontsize=size,
                family=FONT, color=INK, zorder=3)
    return {'x': x, 'y': y, 'w': w, 'h': h, 'top': y + head_h, 'bottom': y - h + head_h,
            'left': x, 'right': x + w, 'cx': x + w / 2, 'cy': y - (h - head_h) / 2,
            'accent': accent}


def crow(ax, at, direction, *, many=True, optional=False, span=1.5, colour=None):
    """
    Crow's-foot notation at the end of a relationship line.

    Three prongs mean "many", a single bar means "one", and a small circle means
    the relationship is optional. This is the standard reading, and it is the
    reason a drawn ER diagram beats a text one: cardinality is visible at a
    glance rather than written out in words beside the line.
    """
    x, y = at
    dx, dy = direction
    px, py = -dy, dx                       # perpendicular
    colour = colour or LINE
    if many:
        for s in (-1, 0, 1):
            ax.plot([x, x + dx * span * 1.7 + px * s * span],
                    [y, y + dy * span * 1.7 + py * s * span],
                    color=colour, lw=1.2, zorder=4)
    else:
        ax.plot([x + dx * span - px * span, x + dx * span + px * span],
                [y + dy * span - py * span, y + dy * span + py * span],
                color=colour, lw=1.4, zorder=4)
    if optional:
        ax.add_patch(Circle((x + dx * span * 2.6, y + dy * span * 2.6), span * 0.55,
                            linewidth=1.2, edgecolor=colour, facecolor='white', zorder=5))


def relate(ax, a, b, *, label=None, a_many=False, b_many=True, size=6.2):
    """A relationship line between two entities, with cardinality at each end."""
    start = (a['right'], a['cy'])
    end = (b['left'], b['cy'])
    ax.plot([start[0], end[0]], [start[1], end[1]], color=LINE, lw=1.0, zorder=3)
    crow(ax, start, (1, 0), many=a_many)
    crow(ax, end, (-1, 0), many=b_many)
    if label:
        ax.text((start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 1.3, label,
                ha='center', va='bottom', fontsize=size, family=FONT, color=INK,
                zorder=5, bbox=dict(boxstyle='round,pad=0.16', facecolor='white',
                                    edgecolor='none', alpha=0.95))


def stack(ax, x, top, width, specs, *, gap=4.0, accent=None):
    """
    Place entities down a column, each below the last.

    Positions are computed from the heights the boxes actually turn out to be
    rather than guessed in advance — an entity's height depends on how many
    columns it has, so hard-coded coordinates collide the moment a table gains
    a field. Returns them keyed by name.
    """
    out = {}
    y = top
    for name, cols in specs:
        e = entity(ax, x, y, width, name, cols, accent=accent)
        out[name] = e
        y = e['bottom'] - gap
    return out


def elbow(ax, a, b, *, label=None, a_many=False, b_many=True, size=6.2, mid=None):
    """
    An orthogonal relationship line: out sideways, across, then in.

    Straight diagonals between two grids of boxes cross everything in between
    and land on top of the text. A right-angled route is both the convention for
    an ER diagram and the only one that stays readable at this density.
    """
    a_right = b['cx'] > a['cx']
    sx = a['right'] if a_right else a['left']
    ex = b['left'] if a_right else b['right']
    sy, ey = a['cy'], b['cy']
    mx = mid if mid is not None else (sx + ex) / 2

    colour = a.get('accent', LINE)
    ax.plot([sx, mx], [sy, sy], color=colour, lw=1.2, zorder=3)
    ax.plot([mx, mx], [sy, ey], color=colour, lw=1.2, zorder=3)
    ax.plot([mx, ex], [ey, ey], color=colour, lw=1.2, zorder=3)

    crow(ax, (sx, sy), (1 if a_right else -1, 0), many=a_many, colour=colour)
    crow(ax, (ex, ey), (-1 if a_right else 1, 0), many=b_many, colour=colour)

    if label:
        ax.text(mx, (sy + ey) / 2, label, ha='center', va='center', fontsize=size,
                family=FONT, color=colour, zorder=5, rotation=90, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.16', facecolor='white',
                          edgecolor='none', alpha=0.96))


def relate_v(ax, a, b, *, label=None, a_many=False, b_many=True, size=6.2):
    """The same, stacked vertically."""
    start = (a['cx'], a['bottom'])
    end = (b['cx'], b['top'] + (b['h'] - (b['top'] - b['bottom'])) * 0)
    end = (b['cx'], b['top'])
    ax.plot([start[0], end[0]], [start[1], end[1]], color=LINE, lw=1.0, zorder=3)
    crow(ax, start, (0, -1), many=a_many)
    crow(ax, end, (0, 1), many=b_many)
    if label:
        ax.text((start[0] + end[0]) / 2 + 1.2, (start[1] + end[1]) / 2, label,
                ha='left', va='center', fontsize=size, family=FONT, color=INK,
                zorder=5, bbox=dict(boxstyle='round,pad=0.16', facecolor='white',
                                    edgecolor='none', alpha=0.95))


# ── sequence ─────────────────────────────────────────────────────────────────

def sequence(name, participants, messages, *, width=9.2, step=3.4, head_h=4.0,
             note_lines=()):
    """
    A sequence diagram.

    `participants` is a list of names; `messages` is a list of
    (from, to, text, kind) where kind is 'call', 'return' or 'self'.
    """
    n = len(participants)
    lane = (width * 10 - 6) / max(n, 1)
    height = (len(messages) * step + head_h + 6 + len(note_lines) * 2.4) / 10.0
    fig, ax = canvas(width, max(height, 1.6))
    top = ax.get_ylim()[1] - 2

    xs = {}
    for i, p in enumerate(participants):
        cx = 3 + lane * (i + 0.5)
        xs[p] = cx
        box(ax, cx - lane * 0.44, top - head_h, lane * 0.88, head_h, p,
            fill=PRIMARY, edge=PRIMARY, size=6.8, bold=True)
        ax.plot([cx, cx], [top - head_h, top - head_h - len(messages) * step - 2],
                color=PRIMARY, lw=0.9, linestyle=(0, (3, 3)), alpha=0.5, zorder=1)

    y = top - head_h - 2.2
    for src, dst, text, kind in messages:
        if kind == 'self':
            x = xs[src]
            ax.plot([x, x + 3.4, x + 3.4, x], [y, y, y - 1.5, y - 1.5],
                    color=DECISION, lw=1.2, zorder=4)
            ax.add_patch(FancyArrowPatch((x + 3.4, y - 1.5), (x + 0.4, y - 1.5),
                                         arrowstyle='-|>', mutation_scale=8,
                                         linewidth=1.2, color=DECISION, zorder=4))
            ax.text(x + 4.2, y - 0.7, text, ha='left', va='center', fontsize=6.3,
                    family=FONT, color=DECISION, zorder=5)
            # A self-call occupies two lines of height, so the next message
            # needs more room or its label lands on this one.
            y -= step * 0.55
        else:
            a, b = xs[src], xs[dst]
            # A reply is a different kind of thing from a request, so it is a
            # different colour as well as a different line.
            mcol = GOOD if kind == 'return' else PRIMARY
            ax.add_patch(FancyArrowPatch(
                (a, y), (b, y), arrowstyle='-|>', mutation_scale=9,
                linewidth=1.2, color=mcol, zorder=4,
                linestyle='--' if kind == 'return' else '-',
                shrinkA=0, shrinkB=0))
            ax.text((a + b) / 2, y + 0.9, text, ha='center', va='bottom', fontsize=6.3,
                    family=FONT, color=mcol, zorder=5,
                    bbox=dict(boxstyle='round,pad=0.15', facecolor='white',
                              edgecolor='none', alpha=0.95))
        y -= step

    for i, line in enumerate(note_lines):
        note(ax, 3, y - 1 - i * 2.4, line)
    return save(fig, name)
