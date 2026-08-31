#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build PROJECT_FLOWCHART.pdf - Kalpion Flows & Timeline.
"""
import os
import re
from PIL import Image as PILImage

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'PROJECT_FLOWCHART.md')
OUT = os.path.join(HERE, 'PROJECT_FLOWCHART.pdf')
DIAGRAMS_DIR = os.path.join(HERE, 'diagrams')

BLACK = colors.Color(0.12, 0.16, 0.22)
GREY = colors.Color(0.40, 0.45, 0.50)
HAIR = colors.Color(0.80, 0.83, 0.87)
HEADFILL = colors.Color(0.93, 0.95, 0.98)
BANDFILL = colors.Color(0.97, 0.98, 0.99)
BOXFILL = colors.Color(0.95, 0.96, 0.98)
ACCENT = colors.Color(0.31, 0.27, 0.90) # #4f46e5

_MAP = {
    '→': '->', '←': '<-', '₹': 'Rs.', '—': ' - ', '–': '-',
    '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '·': '-',
    '•': '*', '✓': '[x]'
}
_TAG = re.compile(r'</?(?:b|i|u|sup|sub|br\s*/?)>', re.I)
_BARE_AMP = re.compile(r'&(?!(?:amp|lt|gt|apos|quot|#\d+);)')


def clean(s):
    if s is None:
        return ''
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


def _esc(chunk):
    return _BARE_AMP.sub('&amp;', chunk).replace('<', '&lt;').replace('>', '&gt;')


SS = getSampleStyleSheet()


def style(name, parent, **kw):
    return ParagraphStyle(name, parent=SS[parent], **kw)


S_TITLE = style('t', 'Title', fontName='Helvetica-Bold', fontSize=22, leading=26, textColor=BLACK, alignment=TA_LEFT)
S_SUB = style('st', 'Normal', fontName='Helvetica', fontSize=11, leading=15, textColor=GREY, alignment=TA_LEFT)
S_H1 = style('h1', 'Heading1', fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=ACCENT, spaceBefore=16, spaceAfter=8)
S_H2 = style('h2', 'Heading2', fontName='Helvetica-Bold', fontSize=12, leading=15, textColor=BLACK, spaceBefore=12, spaceAfter=6)
S_BODY = style('b', 'BodyText', fontName='Helvetica', fontSize=9.5, leading=14, textColor=BLACK, spaceAfter=6)
S_BULLET = style('bl', 'BodyText', fontName='Helvetica', fontSize=9.5, leading=14, textColor=BLACK, leftIndent=14, bulletIndent=4, spaceAfter=4)
S_NOTE = style('nt', 'BodyText', fontName='Helvetica', fontSize=9.0, leading=13, textColor=BLACK)
S_CELL = style('c', 'BodyText', fontName='Helvetica', fontSize=8.8, leading=12, textColor=BLACK)
S_CELLB = style('cb', 'BodyText', fontName='Helvetica-Bold', fontSize=8.8, leading=12, textColor=BLACK)
S_CELLHDR = style('ch', 'BodyText', fontName='Helvetica-Bold', fontSize=9.0, leading=12, textColor=BLACK)


def P(t, s=S_BODY):
    return Paragraph(clean(t), s)


def callout(title, body, box_bg=BOXFILL, box_stroke=BLACK):
    inner = [
        [Paragraph(clean('<b>%s</b>' % title), S_NOTE)],
        [Paragraph(clean(body), S_NOTE)]
    ]
    t = Table(inner, colWidths=[17.0 * cm], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), box_bg),
        ('BOX', (0, 0), (-1, -1), 0.6, box_stroke),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (0, 0), 6),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 7),
        ('TOPPADDING', (0, 1), (-1, -1), 2),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 8)]


def load_diagram_image(img_filename, max_width_cm=17.0):
    p = os.path.join(DIAGRAMS_DIR, img_filename)
    if not os.path.exists(p):
        return None
    try:
        im = PILImage.open(p)
        w, h = im.size
        target_w = max_width_cm * cm
        target_h = (h / float(w)) * target_w
        # Cap height if it exceeds 18cm to fit nicely on page
        if target_h > 18.0 * cm:
            target_h = 18.0 * cm
            target_w = (w / float(h)) * target_h
        return Image(p, width=target_w, height=target_h)
    except Exception as e:
        print('Error loading image %s:' % img_filename, e)
        return None


class Doc(BaseDocTemplate):
    def __init__(self, path, **kw):
        BaseDocTemplate.__init__(
            self, path, pagesize=A4,
            leftMargin=2.0 * cm, rightMargin=2.0 * cm,
            topMargin=2.0 * cm, bottomMargin=1.8 * cm, **kw
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='body')
        self.addPageTemplates([PageTemplate(id='plain', frames=[frame], onPage=self.decorate)])

    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica-Bold', 8)
        canvas.setFillColor(ACCENT)
        canvas.drawString(self.leftMargin, A4[1] - 1.35 * cm, 'Kalpion — Flows & Timeline')
        canvas.setStrokeColor(HAIR)
        canvas.setLineWidth(0.4)
        canvas.line(self.leftMargin, A4[1] - 1.5 * cm, A4[0] - self.rightMargin, A4[1] - 1.5 * cm)
        canvas.line(self.leftMargin, 1.45 * cm, A4[0] - self.rightMargin, 1.45 * cm)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(GREY)
        canvas.drawString(self.leftMargin, 1.1 * cm, 'System Workflow Specifications & Flowchart Visualizations')
        canvas.drawRightString(A4[0] - self.rightMargin, 1.1 * cm, 'Page %d' % doc.page)
        canvas.restoreState()


def build_pdf():
    story = []

    # Title & Subtitle
    story.append(Paragraph(clean('Kalpion'), S_TITLE))
    story.append(Spacer(1, 2))
    story.append(Paragraph(clean('Flows, Process Architecture & Timeline'), S_SUB))
    story.append(Spacer(1, 10))

    # Metadata Card
    meta_data = [
        [Paragraph(clean('Audience'), S_CELLB), Paragraph(clean('Anyone needing to understand product behavior — engineers, design reviewers, and IFQM operational staff.'), S_CELL)],
        [Paragraph(clean('Flow Visuals'), S_CELLB), Paragraph(clean('Each flow includes detailed flowchart specifications and high-resolution diagrams.'), S_CELL)],
        [Paragraph(clean('Source Standard'), S_CELLB), Paragraph(clean('MOM 29 July 2026, Section 2.1 — System Workflow & Process Specifications.'), S_CELL)],
    ]
    meta_table = Table(meta_data, colWidths=[3.5 * cm, 13.5 * cm], hAlign='LEFT')
    meta_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (0, -1), HEADFILL),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 12))

    # Overview Diagram
    img_overview = load_diagram_image('F0_overview.png', max_width_cm=17.0)
    if img_overview:
        story.append(Paragraph(clean('System Overview Flow'), S_H2))
        story.append(Spacer(1, 4))
        story.append(img_overview)
        story.append(Spacer(1, 12))

    # Section 1: Idea Lifecycle
    story.append(Paragraph(clean('1. Idea Lifecycle'), S_H1))
    story.append(P('The core loop of the system. Everything else exists to move an idea smoothly through this path.'))
    img_f1 = load_diagram_image('F1_idea_lifecycle.png', max_width_cm=17.0)
    if img_f1:
        story.append(Spacer(1, 4))
        story.append(img_f1)
        story.append(Spacer(1, 8))

    f1_details = [
        [Paragraph(clean('Starts When'), S_CELLB), Paragraph(clean('An employee opens the Submit page.'), S_CELL)],
        [Paragraph(clean('Ends In'), S_CELLB), Paragraph(clean('Implemented & ROI measured, rejected with reason, or saved as draft.'), S_CELL)],
        [Paragraph(clean('Gamification Points'), S_CELLB), Paragraph(clean('+10 for submission, +25 upon approval, +65 upon implementation.'), S_CELL)],
        [Paragraph(clean('Decision Authority'), S_CELLB), Paragraph(clean('Line manager, or multi-reviewer committee based on org configuration.'), S_CELL)],
        [Paragraph(clean('Key SLA Settings'), S_CELLB), Paragraph(clean('review_sla_days (overdue alert), escalation_days (chain escalation).'), S_CELL)],
    ]
    f1_table = Table(f1_details, colWidths=[4.2 * cm, 12.8 * cm], hAlign='LEFT')
    f1_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(f1_table)
    story.append(Spacer(1, 6))

    story.extend(callout('IMPORTANT: Overdue vs Escalated Ideas',
                         'review_sla_days marks an idea as late so a reviewer is reminded — nothing reassigns automatically. escalation_days is what actually advances the proposal to the next role in the chain.'))

    # Section 2: MSME Registration and Approval
    story.append(Spacer(1, 8))
    story.append(Paragraph(clean('2. MSME Registration and Approval'), S_H1))
    story.append(P('How an organization requests a workspace and how platform administrators verify and provision tenants.'))
    img_f2 = load_diagram_image('F2_registration.png', max_width_cm=17.0)
    if img_f2:
        story.append(Spacer(1, 4))
        story.append(img_f2)
        story.append(Spacer(1, 8))

    f2_details = [
        [Paragraph(clean('Starts When'), S_CELLB), Paragraph(clean('A business fills in the registration form on the landing page.'), S_CELL)],
        [Paragraph(clean('Ends In'), S_CELLB), Paragraph(clean('Provisioned organization workspace with first admin, or rejection.'), S_CELL)],
        [Paragraph(clean('Decided By'), S_CELLB), Paragraph(clean('IFQM platform staff who set plan, trial duration, and org code.'), S_CELL)],
        [Paragraph(clean('Validations'), S_CELLB), Paragraph(clean('Work email domain OTP, Udyam, GSTIN, PAN, CIN, NIC and PIN code.'), S_CELL)],
    ]
    f2_table = Table(f2_details, colWidths=[4.2 * cm, 12.8 * cm], hAlign='LEFT')
    f2_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(f2_table)
    story.append(Spacer(1, 6))

    story.extend(callout('SECURITY GUARD: Registration Approval Required',
                         'Unapproved registration submissions do not provision any databases or create accounts. No workspace exists until platform administration explicitly approves the request.'))

    # Section 3: Authentication
    story.append(Spacer(1, 8))
    story.append(Paragraph(clean('3. Authentication & Security'), S_H1))
    story.append(P('Multi-tenant authentication flow, email OTP login, lockout protection, and JWT session handling.'))
    img_f3 = load_diagram_image('F3_authentication.png', max_width_cm=17.0)
    if img_f3:
        story.append(Spacer(1, 4))
        story.append(img_f3)
        story.append(Spacer(1, 8))

    f3_details = [
        [Paragraph(clean('Sign In Credentials'), S_CELLB), Paragraph(clean('Corporate email, registered phone number, or employee ID.'), S_CELL)],
        [Paragraph(clean('Org Resolution'), S_CELLB), Paragraph(clean('Optional — sign-in directory resolves tenant automatically if omitted.'), S_CELL)],
        [Paragraph(clean('Lockout Guard'), S_CELLB), Paragraph(clean('5 consecutive failures trigger a strict 15-minute security lock.'), S_CELL)],
        [Paragraph(clean('Session Security'), S_CELLB), Paragraph(clean('Stateless JWT token containing password change timestamp stamp.'), S_CELL)],
    ]
    f3_table = Table(f3_details, colWidths=[4.2 * cm, 12.8 * cm], hAlign='LEFT')
    f3_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(f3_table)

    # Section 4: Who Sees What
    story.append(Spacer(1, 8))
    story.append(Paragraph(clean('4. Who Sees What (Role Visibility Matrix)'), S_H1))
    story.append(P('Privacy boundary scoping defining visibility across roles and platform staff.'))
    img_f4 = load_diagram_image('F4_visibility.png', max_width_cm=17.0)
    if img_f4:
        story.append(Spacer(1, 4))
        story.append(img_f4)
        story.append(Spacer(1, 8))

    f4_matrix = [
        [Paragraph(clean('Role'), S_CELLHDR), Paragraph(clean('Visibility Scope'), S_CELLHDR)],
        [Paragraph(clean('Employee'), S_CELLB), Paragraph(clean('Own ideas in full. Public/All Ideas board shows title, status, and configured summary.'), S_CELL)],
        [Paragraph(clean('Line Manager'), S_CELLB), Paragraph(clean('Ideas submitted by employees reporting to them in organizational hierarchy.'), S_CELL)],
        [Paragraph(clean('Plant Head / Exec'), S_CELLB), Paragraph(clean('All ideas within their organization across all departments.'), S_CELL)],
        [Paragraph(clean('Org Admin'), S_CELLB), Paragraph(clean('Full organization data, user management, and system settings.'), S_CELL)],
        [Paragraph(clean('Platform Admin'), S_CELLB), Paragraph(clean('Aggregate metrics, tenant lists, registration queue, support tickets. STRICT ZERO-ACCESS to tenant idea content or employee records.'), S_CELL)],
    ]
    f4_table = Table(f4_matrix, colWidths=[4.2 * cm, 12.8 * cm], hAlign='LEFT')
    f4_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, 0), HEADFILL),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(f4_table)

    # Section 5: Development Timeline
    story.append(Spacer(1, 8))
    story.append(Paragraph(clean('5. Product Development Timeline'), S_H1))
    story.append(P('Chronological progression of features and technical architecture.'))
    img_f5 = load_diagram_image('F5_timeline.png', max_width_cm=17.0)
    if img_f5:
        story.append(Spacer(1, 4))
        story.append(img_f5)
        story.append(Spacer(1, 8))

    timeline_data = [
        [Paragraph(clean('Phase'), S_CELLHDR), Paragraph(clean('Milestones Built'), S_CELLHDR)],
        [Paragraph(clean('Phase 1'), S_CELLB), Paragraph(clean('PHP Prototype: core idea capture, basic review workflow.'), S_CELL)],
        [Paragraph(clean('Phase 2'), S_CELLB), Paragraph(clean('Multi-Tenancy Architecture: database isolation & master registry.'), S_CELL)],
        [Paragraph(clean('Phase 3'), S_CELLB), Paragraph(clean('React + Express Re-architecture: stateless JWT authentication & UI redesign.'), S_CELL)],
        [Paragraph(clean('Phase 4'), S_CELLB), Paragraph(clean('Approval Chains & Gamification: Plant Head reviewer, SLA clock, points & leaderboards.'), S_CELL)],
        [Paragraph(clean('Phase 5'), S_CELLB), Paragraph(clean('Enterprise Integrations & Multi-Language: 7-language i18n, bulk import & QCMS integration.'), S_CELL)],
        [Paragraph(clean('Phase 6'), S_CELLB), Paragraph(clean('MSME Self-Registration & OTP: ZeptoMail email OTP, subscription plans & dedicated reset flow.'), S_CELL)],
    ]
    timeline_table = Table(timeline_data, colWidths=[3.2 * cm, 13.8 * cm], hAlign='LEFT')
    timeline_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, 0), HEADFILL),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(timeline_table)

    Doc(OUT).multiBuild(story)
    print('Successfully generated PDF: %s' % OUT)


if __name__ == '__main__':
    build_pdf()
