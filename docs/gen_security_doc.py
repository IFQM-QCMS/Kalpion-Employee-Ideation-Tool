#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build EIT_Security_Features.pdf - every security control in the IFQM Employee
Ideation Platform, grouped by what it protects, in plain language.

Content comes from docs/SECURITY_FEATURES.md, which is the source of truth; this
script only lays it out. Every factual claim in that file was checked against
the code before it was written.

Monochrome by design: black text, white background, grey hairlines. No colour,
no pictures, no decoration.

    python docs/gen_security_doc.py
"""
import os
import re
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (BaseDocTemplate, Frame, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'SECURITY_FEATURES.md')
OUT = os.path.join(HERE, 'EIT_Security_Features.pdf')

BLACK = colors.black
GREY = colors.Color(0.45, 0.45, 0.45)
HAIR = colors.Color(0.65, 0.65, 0.65)
HEADFILL = colors.Color(0.90, 0.90, 0.90)
BANDFILL = colors.Color(0.965, 0.965, 0.965)
BOXFILL = colors.Color(0.94, 0.94, 0.94)

# The base-14 fonts cover Latin-1 only, so anything outside it is transliterated
# rather than silently printed as a black box.
_MAP = {'→': '->', '←': '<-', '₹': 'Rs.', '—': ' - ', '–': '-', '‘': "'", '’': "'",
        '“': '"', '”': '"', '…': '...', '·': '-', '•': '*', '✓': '[x]'}
_TAG = re.compile(r'</?(?:b|i|u|sup|sub|br\s*/?)>', re.I)
_BARE_AMP = re.compile(r'&(?!(?:amp|lt|gt|apos|quot|#\d+);)')


def _esc(chunk):
    return _BARE_AMP.sub('&amp;', chunk).replace('<', '&lt;').replace('>', '&gt;')


def clean(text):
    s = str(text if text is not None else '')
    for a, b in _MAP.items():
        s = s.replace(a, b)
    s = ''.join(ch if ord(ch) < 256 else '?' for ch in s)
    out, last = [], 0
    for m in _TAG.finditer(s):
        out.append(_esc(s[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(_esc(s[last:]))
    return ''.join(out)


SS = getSampleStyleSheet()


def style(name, parent, **kw):
    return ParagraphStyle(name, parent=SS[parent], **kw)


S_TITLE = style('t', 'Title', fontName='Helvetica-Bold', fontSize=24, leading=29, textColor=BLACK)
S_SUB = style('st', 'Normal', fontName='Helvetica', fontSize=12, leading=17, textColor=BLACK, alignment=TA_CENTER)
S_H1 = style('h1', 'Heading1', fontName='Helvetica-Bold', fontSize=15, leading=19, textColor=BLACK,
             spaceBefore=18, spaceAfter=8)
S_BODY = style('b', 'BodyText', fontName='Helvetica', fontSize=10.2, leading=15, textColor=BLACK,
               alignment=TA_JUSTIFY, spaceAfter=8)
S_BULLET = style('bl', 'BodyText', fontName='Helvetica', fontSize=10.2, leading=14.6, textColor=BLACK,
                 leftIndent=16, bulletIndent=5, spaceAfter=4)
S_CODE = style('cd', 'BodyText', fontName='Helvetica-Oblique', fontSize=8.8, leading=12.2, textColor=GREY,
               leftIndent=16, spaceAfter=7)
S_NOTE = style('nt', 'BodyText', fontName='Helvetica', fontSize=9.6, leading=13.4, textColor=BLACK, spaceAfter=0)
S_CELL = style('c', 'BodyText', fontName='Helvetica', fontSize=9.2, leading=12.4, textColor=BLACK, spaceAfter=0)
S_CELLB = style('cb', 'BodyText', fontName='Helvetica-Bold', fontSize=9.2, leading=12.4, textColor=BLACK, spaceAfter=0)


def P(t, s=S_BODY):
    return Paragraph(clean(t), s)


def callout(title, body):
    inner = [[Paragraph(clean('<b>%s</b>' % title), S_NOTE)], [Paragraph(clean(body), S_NOTE)]]
    t = Table(inner, colWidths=[17.0 * cm], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BOXFILL),
        ('BOX', (0, 0), (-1, -1), 0.6, BLACK),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (0, 0), 6), ('BOTTOMPADDING', (0, -1), (-1, -1), 7),
        ('TOPPADDING', (0, 1), (-1, -1), 2),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 9)]


class Doc(BaseDocTemplate):
    def __init__(self, path, **kw):
        BaseDocTemplate.__init__(self, path, pagesize=A4, leftMargin=2.0 * cm, rightMargin=2.0 * cm,
                                 topMargin=2.0 * cm, bottomMargin=1.8 * cm, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='body')
        self.addPageTemplates([PageTemplate(id='plain', frames=[frame], onPage=self.decorate)])

    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(GREY)
        canvas.drawString(self.leftMargin, A4[1] - 1.35 * cm,
                          'IFQM Employee Ideation Platform - Security Features')
        canvas.setStrokeColor(HAIR)
        canvas.setLineWidth(0.4)
        canvas.line(self.leftMargin, A4[1] - 1.5 * cm, A4[0] - self.rightMargin, A4[1] - 1.5 * cm)
        canvas.line(self.leftMargin, 1.45 * cm, A4[0] - self.rightMargin, 1.45 * cm)
        canvas.drawString(self.leftMargin, 1.1 * cm,
                          'Every claim in this document was checked against the source code.')
        canvas.drawRightString(A4[0] - self.rightMargin, 1.1 * cm, 'Page %d' % doc.page)
        canvas.restoreState()

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name == 'h1':
            self.notify('TOCEntry', (0, f.getPlainText(), self.page))


# ── read the markdown and turn it into flowables ────────────────────────────
md = open(SRC, encoding='utf-8').read()

# The cover and the closing line are written here rather than lifted from the
# markdown, so the PDF reads as a document rather than a rendered file.
body_md = md.split('---', 2)[2] if md.count('---') >= 2 else md

story = []

story.append(Spacer(1, 3.6 * cm))
story.append(Paragraph('Employee Ideation Tool', S_TITLE))
story.append(Spacer(1, 0.2 * cm))
story.append(Paragraph('Security Features', S_SUB))
story.append(Spacer(1, 0.4 * cm))
story.append(Paragraph('What protects the data, and what does not.', S_SUB))
story.append(Spacer(1, 1.8 * cm))

cover = Table([
    [Paragraph(clean('Who this is for'), S_CELLB),
     P('Anyone deciding whether the tool is safe to put in front of their people, and anyone who has to '
       'verify that decision. No security background is assumed.', S_CELL)],
    [Paragraph(clean('What it covers'), S_CELLB),
     P('Every control built into the software, grouped by what it protects: keeping organisations apart, '
       'signing in, sessions, permissions, what people can see, files, transport, abuse, secrets, '
       'auditing and the data lifecycle.', S_CELL)],
    [Paragraph(clean('How to read it'), S_CELLB),
     P('Each item says what it does, why it is there, and where in the code it lives. Where a control has '
       'limits, the limits are stated: a document that only lists strengths is not useful to anyone who '
       'has to rely on it. Section 15 is the honest list of what this does NOT do.', S_CELL)],
    [Paragraph(clean('Version'), S_CELLB),
     P('1.0, reflecting the code as of %s.' % datetime.now().strftime('%d %B %Y'), S_CELL)],
], colWidths=[4.2 * cm, 12.8 * cm], hAlign='LEFT')
cover.setStyle(TableStyle([
    ('GRID', (0, 0), (-1, -1), 0.4, HAIR), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
]))
story.append(cover)
story.append(PageBreak())

toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle('toc0', fontName='Helvetica', fontSize=10.4, leading=16, leftIndent=0,
                   firstLineIndent=-14, textColor=BLACK),
]
story.append(Paragraph('Contents', S_H1))
story.append(toc)
story.append(PageBreak())

para_buf = []


def flush():
    if para_buf:
        story.append(P(' '.join(para_buf)))
        del para_buf[:]


for raw in body_md.split('\n'):
    line = raw.rstrip()

    if line.startswith('## '):
        flush()
        story.append(Paragraph(clean(line[3:].strip()), S_H1))
        continue
    if line.strip() in ('---', ''):
        flush()
        continue
    # A line entirely in italics is a source-code reference.
    if line.startswith('*(') and line.endswith(')*'):
        flush()
        story.append(Paragraph(clean(line[1:-1]), S_CODE))
        continue
    if line.startswith('*') and line.endswith('*') and not line.startswith('**'):
        flush()
        story.append(Paragraph(clean(line.strip('*')), S_CODE))
        continue
    if line.startswith('- '):
        flush()
        story.append(Paragraph(clean(line[2:].strip()), S_BULLET, bulletText='-'))
        continue
    para_buf.append(line.strip())

flush()

Doc(OUT).multiBuild(story)
print('Wrote %s' % OUT)
