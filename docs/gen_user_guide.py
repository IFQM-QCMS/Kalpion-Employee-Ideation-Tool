#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build EIT_User_Guide.pdf - the complete, plain-language manual for every person
who touches the IFQM Employee Ideation Platform: employees who submit ideas,
managers who review them, organisation administrators who run the tool, and the
IFQM platform team who look after all the organisations.

Monochrome by design: black text, white background, grey hairlines. No colour.

    python docs/gen_user_guide.py
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Writes into docs/ alongside the other documents, not into the project root.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'EIT_User_Guide.pdf')

BLACK = colors.black
GREY = colors.Color(0.45, 0.45, 0.45)
HAIR = colors.Color(0.65, 0.65, 0.65)
HEADFILL = colors.Color(0.90, 0.90, 0.90)
BANDFILL = colors.Color(0.965, 0.965, 0.965)
BOXFILL = colors.Color(0.94, 0.94, 0.94)

_MAP = {'→': '->', '←': '<-', '₹': 'Rs.', '—': '-', '–': '-', '‘': "'", '’': "'",
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
S_H1 = style('h1', 'Heading1', fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=BLACK,
             spaceBefore=20, spaceAfter=9)
S_H2 = style('h2', 'Heading2', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=BLACK,
             spaceBefore=13, spaceAfter=5)
S_H3 = style('h3', 'Heading3', fontName='Helvetica-BoldOblique', fontSize=10.3, leading=14, textColor=BLACK,
             spaceBefore=9, spaceAfter=3)
S_BODY = style('b', 'BodyText', fontName='Helvetica', fontSize=10.2, leading=15, textColor=BLACK,
               alignment=TA_JUSTIFY, spaceAfter=8)
S_BULLET = style('bl', 'BodyText', fontName='Helvetica', fontSize=10.2, leading=14.6, textColor=BLACK,
                 leftIndent=16, bulletIndent=5, spaceAfter=4)
S_NUM = style('nm', 'BodyText', fontName='Helvetica', fontSize=10.2, leading=14.6, textColor=BLACK,
              leftIndent=20, bulletIndent=5, spaceAfter=5)
S_NOTE = style('nt', 'BodyText', fontName='Helvetica', fontSize=9.6, leading=13.4, textColor=BLACK, spaceAfter=0)
S_SMALL = style('sm', 'BodyText', fontName='Helvetica', fontSize=8.8, leading=12.4, textColor=GREY, spaceAfter=6)
S_CELL = style('c', 'BodyText', fontName='Helvetica', fontSize=9.2, leading=12.4, textColor=BLACK, spaceAfter=0)
S_CELLB = style('cb', 'BodyText', fontName='Helvetica-Bold', fontSize=9.2, leading=12.4, textColor=BLACK, spaceAfter=0)
S_TH = style('th', 'BodyText', fontName='Helvetica-Bold', fontSize=9.2, leading=12.4, textColor=BLACK, spaceAfter=0)


def P(t, s=S_BODY):
    return Paragraph(clean(t), s)


def H1(t):
    return Paragraph(clean(t), S_H1)


def H2(t):
    return Paragraph(clean(t), S_H2)


def H3(t):
    return Paragraph(clean(t), S_H3)


def bl(items):
    return [Paragraph(clean(i), S_BULLET, bulletText='-') for i in items]


def steps(items):
    return [Paragraph(clean(t), S_NUM, bulletText='%d.' % (i + 1)) for i, t in enumerate(items)]


def table(rows, widths, header=True, band=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    cmds = [('GRID', (0, 0), (-1, -1), 0.4, HAIR), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    if header:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), HEADFILL), ('LINEBELOW', (0, 0), (-1, 0), 0.8, BLACK)]
    if band:
        for i in range(2 if header else 1, len(rows), 2):
            cmds.append(('BACKGROUND', (0, i), (-1, i), BANDFILL))
    t.setStyle(TableStyle(cmds))
    return t


def th(*labels):
    return [Paragraph(clean(x), S_TH) for x in labels]


def tr(*cells):
    return [P(c, S_CELL) for c in cells]


def trb(first, *cells):
    return [Paragraph(clean(first), S_CELLB)] + [P(c, S_CELL) for c in cells]


def callout(title, body):
    """A boxed aside - used for warnings and things people get wrong."""
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
        canvas.drawString(self.leftMargin, A4[1] - 1.35 * cm, 'IFQM Employee Ideation Platform - User Guide')
        canvas.setStrokeColor(HAIR)
        canvas.setLineWidth(0.4)
        canvas.line(self.leftMargin, A4[1] - 1.5 * cm, A4[0] - self.rightMargin, A4[1] - 1.5 * cm)
        canvas.line(self.leftMargin, 1.45 * cm, A4[0] - self.rightMargin, 1.45 * cm)
        canvas.drawString(self.leftMargin, 1.1 * cm, 'If anything here does not match what you see, use Support - '
                                                     'your organisation may have configured it differently.')
        canvas.drawRightString(A4[0] - self.rightMargin, 1.1 * cm, 'Page %d' % doc.page)
        canvas.restoreState()

    def afterFlowable(self, f):
        if isinstance(f, Paragraph):
            if f.style.name == 'h1':
                self.notify('TOCEntry', (0, f.getPlainText(), self.page))
            elif f.style.name == 'h2':
                self.notify('TOCEntry', (1, f.getPlainText(), self.page))


s = []

# ══════════════════════════ COVER ══════════════════════════════════════════
s.append(Spacer(1, 3.6 * cm))
s.append(Paragraph('Employee Ideation Tool', S_TITLE))
s.append(Spacer(1, 0.2 * cm))
s.append(Paragraph('Complete User Guide', S_SUB))
s.append(Spacer(1, 0.4 * cm))
s.append(Paragraph('Turn great ideas into real improvements.', S_SUB))
s.append(Spacer(1, 1.8 * cm))
s.append(table([
    trb('Who this guide is for', 'Everyone who uses the platform: employees, reviewers and managers, '
        'organisation administrators, and the IFQM platform team.'),
    trb('What it covers', 'Every screen, every field, and every decision you will be asked to make - in plain '
        'language, with no technical background assumed.'),
    trb('How to use it', 'Read section 1 to 4 once. After that, use the contents page: each section stands on its '
        'own so you can jump straight to the task in front of you.'),
    trb('Version', 'Written for the current release. Updated %s.' % datetime.now().strftime('%d %B %Y')),
], [4.6 * cm, 12.4 * cm], header=False, band=False))
s.append(Spacer(1, 1.4 * cm))
s.append(P('In one sentence: employees submit improvement ideas, the right managers review and approve them, '
           'everyone can vote and discuss, points reward participation, and approved ideas are handed to the QCMS '
           'tool where the implementation is tracked.', S_SMALL))
s.append(PageBreak())

s.append(Paragraph('Contents', style('h1plain', 'Heading1', fontName='Helvetica-Bold', fontSize=16,
                                    leading=20, textColor=BLACK, spaceAfter=9)))
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle('toc1', fontName='Helvetica-Bold', fontSize=10.2, leading=16),
    ParagraphStyle('toc2', fontName='Helvetica', fontSize=9.4, leading=13.6, leftIndent=16),
]
s.append(toc)
s.append(PageBreak())

# ══════════════════════════ 1. ABOUT ═══════════════════════════════════════
s.append(H1('1. About this guide'))
s.append(P(
    'This guide explains how to use the Employee Ideation Tool from end to end. It assumes nothing: not that you have '
    'used a system like this before, and not that you know what any of the words on the screen mean. Where a word has '
    'a specific meaning here - "escalation", "co-suggester", "challenge" - it is explained the first time it appears '
    'and again in the glossary at the end.'))

s.append(H2('1.1 Conventions used here'))
s.extend(bl([
    'Things you click or type are written in <b>bold</b>: click <b>Submit Idea</b>.',
    'Screens are named as they appear in the left-hand menu: <b>Dashboard</b>, <b>My Ideas</b>, <b>Review Queue</b>.',
    'Boxed notes are the things people most often get wrong, or that cannot be undone. They are worth reading even '
    'if you skim everything else.',
    'Where behaviour depends on how your organisation has set the tool up, it says so. Your administrator can change '
    'quite a lot - the approval chain, the categories, the review deadline, even the name and logo at the top of the '
    'page.',
]))

s.append(H2('1.2 What you need'))
s.extend(bl([
    'A modern web browser. Nothing to install.',
    'An account, created for you by your organisation&apos;s administrator. You cannot sign yourself up - see 3.1.',
    'Your organisation code, if your organisation uses one. Ask your administrator, or see 3.2.',
]))

# ══════════════════════════ 2. HOW IT WORKS ════════════════════════════════
s.append(H1('2. How the platform works'))
s.append(P(
    'The tool exists to make one thing easy: getting a good idea from the person who had it to the person who can '
    'approve it, without the idea being lost, forgotten, or quietly ignored. Everything else in the product supports '
    'that single journey.'))

s.append(H2('2.1 The journey of an idea'))
s.append(table([
    th('Stage', 'What happens', 'Who does it'),
    tr('Draft', 'You start filling in the idea and save it without submitting. Only you (and your administrator) can '
                'see a draft.', 'You'),
    tr('Submitted', 'You submit. The idea gets a permanent code (for example IDA-2026-014), your reviewer is '
                    'notified, and a review deadline is set.', 'You'),
    tr('Under Review', 'A reviewer has picked it up, or it has been escalated to a more senior manager for a '
                       'decision.', 'Your manager or a committee'),
    tr('Approved', 'The idea is accepted. You earn points, and it becomes eligible to be handed to the QCMS tool for '
                   'implementation.', 'A reviewer with approval authority'),
    tr('Rejected', 'The idea is not being taken forward. The reviewer&apos;s comment tells you why - and a rejected idea '
                   'can be reworked and submitted again as a new idea.', 'A reviewer'),
    tr('Implemented', 'The change has actually been made. This is the stage worth the most points, because it is the '
                      'stage that saved the money or removed the risk.', 'A manager tracking delivery'),
], [3.0 * cm, 10.4 * cm, 3.6 * cm]))

s.append(H2('2.2 What you get out of it'))
s.extend(bl([
    '<b>Your idea is on the record.</b> Every decision, comment and escalation is stored against the idea with the '
    'name of the person who made it and the time they made it. Nothing disappears into a mailbox.',
    '<b>You are told what happened.</b> A notification arrives when the idea moves, and the reviewer is asked to '
    'leave a comment with the decision.',
    '<b>You earn recognition.</b> Points are awarded for submitting, for approval and for implementation, and the '
    'leaderboard shows the most active people and departments.',
    '<b>Your colleagues can help.</b> Anyone in your organisation can vote, rate and comment on ideas, and you can '
    'name the colleagues who worked on it with you so they get the credit too.',
]))

s.append(H2('2.3 Three ordinary days'))
s.append(P(
    'The same week, from three points of view. If you only want to know what the tool feels like in use, this is it.'))
s.append(table([
    th('Who', 'What their week looks like'),
    trb('Ravi, machine operator', 'Notices on Monday that line 3 keeps draining coolant. Opens <b>Submit Idea</b> on '
        'his phone during the break, types the situation with the figure he already knows (about 40 litres a shift), '
        'photographs the capped return line, adds the maintenance engineer as a co-suggester and submits. He gets '
        '10 points and a notification that his manager has it. On Thursday a notification says it was approved and '
        'escalated for the spend, with a comment agreeing with his numbers. He can watch the timeline from there.'),
    trb('Priya, production manager', 'Opens <b>Review Queue</b> on Tuesday morning: six ideas, one overdue. She reads '
        'Ravi&apos;s, checks the figures against the coolant purchase report he attached, approves it with a comment '
        'about the March rebuild, and rejects a duplicate with a note pointing at the original. The overdue one she '
        'routes to committee because it crosses into maintenance. Ten minutes, and everyone involved knows where '
        'they stand.'),
    trb('Anil, organisation administrator', 'Checks the dashboard on Monday: submissions up, two reviews overdue in '
        'one department. He messages that manager. Mid-week he imports the new intake of trainees from a '
        'spreadsheet, fixes two reporting lines the import flagged, and adds a category for the new energy '
        'programme. On Friday he opens <b>Approved Ideas</b> and pushes the week&apos;s approvals to QCMS, where '
        'implementation is tracked.'),
], [4.2 * cm, 12.8 * cm], header=False))

s.append(H2('2.4 Who can see what'))
s.append(P(
    'This matters, so it is worth being precise. Your organisation is separate from every other organisation on the '
    'platform: nobody outside it can see your ideas, your files, your comments or your people. Inside your '
    'organisation:'))
s.append(table([
    th('Item', 'Who can see it'),
    tr('A draft', 'Only you, and your organisation administrator.'),
    tr('A submitted idea', 'Everyone in your organisation, on the idea board and in the lists.'),
    tr('An anonymous idea', 'Everyone can see the idea; nobody except senior reviewers and administrators can see who '
                            'submitted it. Your name is hidden from the idea, from the approval timeline and from the '
                            'co-suggester list.'),
    tr('An attachment', 'Anyone signed in to your organisation who can see the idea, and only through the app - '
                        'files are never public links. A draft&apos;s attachments stay private to you.'),
    tr('Your email and phone', 'Your administrator, and colleagues searching for you as a co-suggester (by name and '
                               'employee ID).'),
    tr('Analytics and the audit trail', 'Managers and administrators, depending on their role.'),
], [4.6 * cm, 12.4 * cm]))
s.extend(callout('The IFQM platform team cannot read your ideas',
                 'The vendor team that creates and supports organisations sees only counts and administrator contact '
                 'details. They cannot open your ideas, your files or your user list. If you raise a support ticket '
                 'they see what you write in that ticket, and nothing else.'))

# ══════════════════════════ 3. ROLES ═══════════════════════════════════════
s.append(H1('3. Roles: what each person can do'))
s.append(P(
    'Your role decides which menu items you see and which buttons you get. Your administrator sets it. If you think '
    'yours is wrong - you can see the Review Queue but you are not a reviewer, or you cannot see it and you should - '
    'ask your administrator rather than working around it.'))
s.append(table([
    th('Role', 'Can do', 'Cannot do'),
    tr('Employee / Trainee', 'Submit ideas, save drafts, attach documents, name co-suggesters, submit anonymously, '
                             'vote, rate, comment, earn points, see the leaderboard, raise support tickets.',
       'Review or approve anything, including their own idea. See other people&apos;s drafts. Reach admin screens.'),
    tr('Team Lead / Project Lead', 'Everything an employee can, plus the Review Queue for their own team&apos;s ideas '
                                   'and the ability to approve, reject or escalate them.',
       'Approve their own idea. See ideas outside their reporting line.'),
    tr('Manager / Department Manager / Senior Manager',
       'Everything a team lead can, plus recording ROI and implementation progress, seeing the identity behind an '
       'anonymous idea, bulk review, and analytics for their area.',
       'Administer users, branding or integrations.'),
    tr('Plant Head / Executive', 'Organisation-wide visibility of ideas and analytics, and final approval authority '
                                 'at the top of the escalation chain.', 'Administer users or integrations.'),
    tr('Admin / Super Admin', 'Everything above for their organisation, plus users and bulk import, the reporting '
                              'hierarchy, the approval chain, categories, challenges, branding, email settings, the '
                              'audit trail, exports, approved-idea push and the QCMS integration settings.',
       'See any other organisation. Reach the IFQM platform console.'),
    tr('Platform Admin (IFQM)', 'Create, rename, suspend and remove organisations, manage platform administrators, '
                                'answer support tickets, set platform-wide defaults.',
       'Read any organisation&apos;s ideas, users, files or analytics.'),
], [4.2 * cm, 7.6 * cm, 5.2 * cm]))

# ══════════════════════════ 4. GETTING STARTED ═════════════════════════════
s.append(PageBreak())
s.append(H1('4. Getting started'))

s.append(H2('4.1 Getting an account'))
s.append(P(
    'Accounts are created by your organisation&apos;s administrator - either one at a time or by importing a spreadsheet '
    'of the whole department. You cannot register yourself. If you have no account, open the sign-in page and use '
    '<b>Request access</b>: fill in your name, your email and your organisation, and the request is passed to the '
    'people who can create your account.'))
s.append(P(
    'An <b>organisation</b> that wants to join the platform applies on the registration form instead. That form asks '
    'you to prove two things before it will accept the application: that you hold the email address you gave, and '
    'that you hold the mobile number. Each has a <b>Send OTP</b> button beside it that sends a six-digit code, and a '
    '<b>Verify OTP</b> button to enter it. Both must show as verified before the form can be submitted.'))
s.extend(callout('Why an application asks for two codes',
                 'The address and the number become the contact route for the organisation&apos;s first administrator '
                 'account, so an application with a mistyped address would be approved and then be unreachable. '
                 'Unlike the sign-in page, this form tells you honestly whether the code was sent - you are typing '
                 'your own details into a form you are filling in, so there is nothing to give away, and a form that '
                 'cannot say "that did not send" leaves you waiting for a code that is never coming.'))

s.append(H2('4.2 Signing in'))
s.append(P('The sign-in page asks for three things, and one of them is often optional:'))
s.extend(steps([
    '<b>Organization Code</b> - your organisation&apos;s short code, for example "acme". Many organisations do not need '
    'you to type it: if your email or phone number is registered with only one organisation, leave it blank and the '
    'tool will find you. Leave it blank as well if you are an IFQM platform administrator.',
    '<b>Email or phone number</b> - whichever your administrator registered for you. Both work; switch between the '
    '<b>Email</b> and <b>Phone</b> tabs.',
    '<b>Password</b> - use the eye icon to check what you typed before you submit.',
]))
s.append(P(
    'Tick <b>Keep me signed in</b> on a device that only you use. Your session ends automatically after a period of '
    'inactivity, and it also ends immediately if your password is changed or your account is deactivated.'))
s.extend(callout('Wrong password five times locks the account for 15 minutes',
                 'This protects you: it is what stops somebody guessing their way in. The correct password will not '
                 'open the account during those 15 minutes either, so wait it out or ask your administrator to reset '
                 'your password. The error message never reveals whether an email address exists on the platform - '
                 'that is deliberate.'))

s.append(P(
    '<b>Signing in with a one-time code instead of a password.</b> If the option is offered, the sign-in page carries '
    'a link reading <b>Sign in with a code instead</b>. Type the email address or the mobile number your organisation '
    'registered for you, and a six-digit code is sent to it - by text if you typed a number, by email if you typed an '
    'address. Enter the code and you are signed in exactly as a password would have signed you in; nothing afterwards '
    'behaves differently.'))
s.append(P(
    'The code is valid for five minutes and can be used once. Five wrong attempts destroy it, and asking for a new '
    'one cancels the previous one - so if two codes arrive, only the newer will work. There is a short wait before '
    'the tool will send another, and the screen counts it down for you.'))
s.append(P(
    'The link only appears when the platform can actually deliver a code. That is deliberate: offering a sign-in '
    'route where nothing ever arrives is worse than not offering it, because you would abandon a password that works '
    'for a code that never comes.'))
s.extend(callout('The reply is the same whether or not the number is registered',
                 'Asking for a code always answers "if that number belongs to an account, a code has been sent to '
                 'it", and it says so just as readily for a number nobody has ever used. Anything else would turn '
                 'the sign-in page into a way of discovering who works at your organisation.'))

s.append(H2('4.3 Your first sign-in and the temporary password'))
s.append(P(
    'If your account was created for you, your first password is temporary and predictable: <b>the first four '
    'letters of your name, in lower case, followed by your year of birth</b>. Asha Rao, born in 1994, starts with '
    '<b>asha1994</b>.'))
s.append(P(
    'Because a colleague could guess that, the tool will not let you do anything else until you have replaced it. '
    'Sign in, and you are taken straight to the change-password screen. Every other screen is blocked until you '
    'choose a new password - and that is enforced by the server, so there is no way around it. Choose something at '
    'least twelve characters long that you do not use anywhere else; a short phrase is easier to remember and harder '
    'to guess than a mangled word.'))

s.append(H2('4.4 If you forget your password'))
s.extend(steps([
    'On the sign-in page, click <b>Forgot your password?</b> A small panel opens on the page itself.',
    'Enter your registered email address and click <b>Send reset link</b>. For your safety the reply is always the '
    'same whether or not that address has an account - it never confirms who is registered.',
    'Open the emailed link. It takes you to a page where you type the new password twice, with an eye icon to check '
    'what you typed. The link is valid for one hour and can be used once.',
    'Choose the new password and you are returned to the sign-in page. Setting a new password immediately ends every '
    'session that was opened with the old one, on every device.',
    'If no email arrives, check junk mail, then ask your administrator. An administrator can reset your password '
    'directly.',
]))
s.append(P(
    'There is a second route for anyone who cannot reach the mailbox the link would go to - somebody whose work '
    'address is the very account they are locked out of, or who is on a phone away from their desk. Ask for a '
    '<b>reset code</b> instead: a six-digit code is sent to the registered email address or mobile number, and once '
    'you have entered it you set a new password on the spot. The code follows the same rules as a sign-in code - '
    'five minutes, one use, five wrong attempts and it is destroyed.'))

s.append(H2('4.5 Finding your way around'))
s.append(table([
    th('Where', 'What it is'),
    tr('Left-hand menu', 'Every screen you have access to: Dashboard, Submit Idea, My Ideas, Idea Board, All Ideas, '
                         'Challenges, Review Queue, Leaderboard, Analytics, Audit Trail, Org Hierarchy, Admin Panel, '
                         'Support and My Profile. You only see the ones your role allows. The menu collapses to icons '
                         'if you want more room.'),
    tr('Top bar', 'The bell icon with your unread notifications, the language selector, and your own name and points.'),
    tr('Dashboard', 'Your starting point: total ideas, how many are approved and implemented, how many are waiting '
                    'for review, anything overdue, the spread of statuses and the most recent activity.'),
    tr('Support', 'Raise a ticket with the IFQM team when something is broken. Reachable even when your account is '
                  'stuck on a temporary password, because that is exactly when you need it.'),
], [4.0 * cm, 13.0 * cm]))

s.append(H2('4.6 Two-minute quick starts'))
s.append(P('If you read nothing else, read the row for your role.'))
s.append(table([
    th('If you are...', 'Do this first'),
    trb('An employee', 'Sign in, change your temporary password, open <b>Submit Idea</b>, and write down the one '
        'thing about your work that has annoyed you most this month. Fill in the situation with a number in it, the '
        'solution, and submit. Everything else on the form is optional.'),
    trb('A reviewer or manager', 'Open <b>Review Queue</b> and sort out anything marked Overdue. Decide, and leave a '
        'comment on every rejection. Then check that the people who report to you are correctly listed under you - '
        'if they are not, their ideas are not reaching you.'),
    trb('An organisation administrator', 'Import your people, fix the reporting lines, add your categories, set the '
        'review deadline, upload your logo, and configure email. Then submit one idea yourself and take it all the '
        'way through - it is the fastest way to find anything you have set up wrongly.'),
    trb('A platform administrator', 'Create the organisation, hand its first administrator their credentials, and '
        'point them at section 9 of this guide.'),
], [4.6 * cm, 12.4 * cm], header=False))

s.append(H2('4.7 Your profile'))
s.append(P(
    'Open <b>My Profile</b> to see your details - name, employee ID, department, business unit, location, email, '
    'phone, who you report to - and your total points. You can update your own contact details. You cannot change '
    'your own role, your points or your reporting line; those belong to your administrator, and attempts to set them '
    'from the browser are refused by the server.'))

s.append(H2('4.8 On a phone or tablet'))
s.append(P(
    'There is nothing to install and no separate app: open the same address in the phone&apos;s browser and sign in. The '
    'layout adapts - the left-hand menu collapses behind a button, and the idea form runs one step to a screen. '
    'Photographs taken on the phone can be attached directly, which is usually the fastest way to capture a problem '
    'while you are standing in front of it. Your language choice is remembered per device, so you may need to set it '
    'again on the phone.'))

s.append(H2('4.9 Working in your own language'))
s.append(P(
    'The whole interface is available in seven languages: English, Hindi, Kannada, Malayalam, Marathi, Tamil and '
    'Telugu. Use the language selector in the top bar; the choice is remembered on that device. It changes the labels '
    'and messages, not the content other people have typed - an idea written in English stays in English.'))

# ══════════════════════════ 5. SUBMITTING ══════════════════════════════════
s.append(PageBreak())
s.append(H1('5. Submitting an idea'))
s.append(P(
    'This is the heart of the tool. The form is a six-step wizard: you can move back and forth, and you can save a '
    'draft at any point and come back to it. Nothing is visible to anyone else until you press submit on the last '
    'step.'))

s.append(H2('5.1 Before you start: what makes a good idea'))
s.append(P(
    'The reviewers are busy people reading a queue. The ideas that get approved are almost always the ones that made '
    'the reviewer&apos;s job easy. Three habits do most of that work:'))
s.extend(bl([
    '<b>Describe the situation with a number.</b> "Paint rejection has gone from 2% to 6% on line 3 since March" is '
    'a case. "Quality is poor" is an opinion.',
    '<b>Propose something specific enough to cost.</b> "Install automatic viscosity monitoring on the paint line" '
    'can be quoted. "Improve the process" cannot.',
    '<b>Say what it is worth, even roughly.</b> An estimate you can explain beats a blank field. If you genuinely do '
    'not know, leave it blank - the reviewer can ask.',
]))

s.append(H2('5.2 Step 1 - The situation'))
s.append(table([
    th('Field', 'What to put in it'),
    trb('Situation Title', 'One line that a manager could read in a queue of forty and understand. "Recirculate '
        'coolant on line 3", not "Coolant".'),
    trb('Current Situation Description', 'What is happening today, and why it is a problem. At least 20 characters, '
        'but write a paragraph: how often it happens, who it affects, what it costs in time, money, quality or '
        'safety. This is the field reviewers quote back when they approve.'),
], [4.6 * cm, 12.4 * cm], header=False))
s.append(Spacer(1, 5))
s.append(P(
    'As you type the title, the tool quietly checks for ideas that already exist with a similar title. If it finds '
    'any it lists them under <b>Similar ideas already exist</b>. Open them before you carry on: if somebody has '
    'already raised yours, it is usually better to add a comment and your vote to theirs than to file a duplicate. '
    'If yours is genuinely different, say so in the description and continue - the warning never blocks you.'))

s.append(H2('5.3 Step 2 - The solution and its impact'))
s.append(table([
    th('Field', 'What to put in it'),
    trb('Proposed Solution', 'What you want done, in enough detail that somebody else could act on it. Include what '
        'you have already tried, if anything.'),
    trb('Select Categories', 'The areas your idea improves - quality, cost, delivery, safety, environment, morale and '
        'whatever else your organisation has added. Choose all that genuinely apply; these drive the analytics and '
        'the category the idea carries into the implementation system.'),
    trb('Overall Impact Level', 'Low, Medium or High - your honest assessment of the size of the benefit. Reviewers '
        'sort by this, and inflating it is quickly noticed.'),
], [4.6 * cm, 12.4 * cm], header=False))

s.append(H2('5.4 Step 3 - The business case'))
s.append(P(
    'Every field on this step is optional, and the form says so: fill in what you know and leave the rest. A partly '
    'filled business case is normal and is not held against you - the reviewer will ask for the rest if they need it.'))
s.append(table([
    th('Field', 'What to put in it'),
    trb('Tangible Benefit', 'The measurable gain, with a number where you can: "Rs. 50,000 savings a year", "40 '
        'minutes saved per shift".'),
    trb('Intangible Benefit', 'The gain you cannot put a figure on: better audit scores, less rework frustration, '
        'safer working, improved customer confidence.'),
    trb('Investment required', 'What it would cost to do - money, tooling, or people&apos;s time. "Rs. 2,00,000 for '
        'tooling plus 3 man-days" is a perfect answer.'),
    trb('Feasibility', 'How easy you think it is to actually do, from your own knowledge of the area.'),
    trb('Time required to implement', 'A duration ("about 6 weeks"), a target date, or both.'),
    trb('Benefits expected', 'What improves, and by how much. This is where you turn the two benefit fields into a '
        'sentence a manager can act on.'),
    trb('Support required', 'The teams, approvals or skills you would need. Naming them here is often what turns a '
        'good idea into a scheduled one.'),
], [4.6 * cm, 12.4 * cm], header=False))

s.append(H2('5.5 Step 4 - Attachments'))
s.append(P(
    'You can attach supporting documents to four places: the situation, the solution, the support required and the '
    'benefits. A photograph of the problem is often worth more than a paragraph describing it.'))
s.extend(bl([
    'Accepted file types: PDF, Word, Excel, CSV, and images (PNG, JPG, GIF).',
    'Maximum 10 MB per file (your administrator can change this).',
    'Files are stored privately. They are never public links: they can only be downloaded through the app, by '
    'somebody signed in to your organisation who is allowed to see that idea.',
    'While the idea is still a draft, its attachments are visible only to you and your administrator.',
]))
s.extend(callout('Do not attach personal or confidential records',
                 'Attach what is needed to explain the idea. Payroll data, medical information, customer contracts '
                 'and personal identity documents do not belong on an improvement suggestion, however relevant they '
                 'feel at the time.'))

s.append(H2('5.6 Step 5 - Co-suggesters'))
s.append(P(
    'If colleagues worked on this with you, name them. Search by name or employee ID and add as many as apply - there '
    'is no limit of two. They appear on the idea, and the credit is shared: co-suggesters are listed when the idea '
    'goes to the implementation system, and they show up on the idea for everyone to see.'))
s.append(P(
    'Two things to know. You cannot add somebody who is not in your organisation - only colleagues appear in the '
    'search. And on an <b>anonymous</b> idea the co-suggester list is hidden from colleagues along with your own '
    'name, because a list of names is an excellent clue to who filed it.'))

s.append(H2('5.7 Step 6 - Review and submit'))
s.append(P(
    'The last step shows you everything you have entered, in one place, before it goes anywhere. Read it as a '
    'reviewer would. Three more choices live on this step:'))
s.append(table([
    th('Option', 'What it does'),
    trb('Idea Template', 'Tags the idea as a Cost Reduction, Quality Improvement, Safety Enhancement or Process '
        'Optimization idea. Optional, and used for grouping and reporting.'),
    trb('Link to Challenge', 'Attaches the idea to a campaign your organisation is running - for example a quarterly '
        'safety drive. Only open challenges appear.'),
    trb('Submit anonymously', 'Your name is hidden from colleagues everywhere the idea appears: the idea itself, the '
        'approval timeline, and the co-suggester list. Senior reviewers and administrators can still see who you are '
        '- an idea has to be accountable to somebody - and you can always see your own idea unmasked. Use this when '
        'the point of the idea is uncomfortable for somebody; do not use it to avoid getting the credit.'),
], [4.6 * cm, 12.4 * cm], header=False))
s.append(Spacer(1, 5))
s.append(P(
    'Press <b>Submit New Idea</b>. The idea is given its permanent code, your points are added, your reviewer is '
    'notified, and a review deadline is set from your organisation&apos;s service-level setting.'))

s.append(H2('5.8 Drafts'))
s.append(P(
    '<b>Save Draft</b> stores everything without submitting. Drafts appear in <b>My Ideas</b> marked as drafts, and '
    'only you and your administrator can see them. Reopen a draft to carry on where you left off; when you finally '
    'submit, it becomes the same idea rather than a second one. There is no limit on how long a draft can sit there, '
    'but an idea in draft is an idea nobody is acting on.'))

s.append(H2('5.9 A worked example'))
s.append(table([
    th('Field', 'Filled in'),
    tr('Situation Title', 'Recirculate coolant on line 3'),
    tr('Current Situation', 'Line 3 discards roughly 40 litres of coolant every shift because the return line was '
                            'capped during the 2023 rebuild and never reinstated. At three shifts a day that is about '
                            '120 litres a day, plus the disposal cost and the time the operator spends refilling.'),
    tr('Proposed Solution', 'Reinstate the return line with an inline filter and a level sensor, so coolant is '
                            'filtered and returned to the tank instead of being drained. Maintenance confirmed the '
                            'original pipework is still in place.'),
    tr('Categories / Impact', 'Cost, Environment / Medium'),
    tr('Tangible benefit', 'Rs. 4,20,000 a year in coolant and disposal'),
    tr('Investment required', 'Rs. 85,000 for the filter and sensor, plus 2 maintenance days'),
    tr('Time to implement', 'About 3 weeks, target end of next month'),
    tr('Support required', 'Maintenance team for two days; EHS sign-off on the disposal change'),
    tr('Attachments', 'Photo of the capped return line; last quarter&apos;s coolant purchase report'),
    tr('Co-suggesters', 'The line operator who noticed it and the maintenance engineer who confirmed the pipework'),
], [4.2 * cm, 12.8 * cm]))

s.append(H2('5.10 The eight mistakes that get ideas rejected'))
s.append(table([
    th('Mistake', 'What to do instead'),
    tr('A title nobody can act on ("Improve line 3")',
       'Name the change: "Recirculate coolant on line 3".'),
    tr('A situation with no measurement',
       'Add the number you already know: how often, how long, how much, since when.'),
    tr('A solution that is really a complaint',
       'Say what should be done and by whom, not only what is wrong.'),
    tr('An impact level set to High on every idea',
       'Rate it honestly. Reviewers read hundreds of these and calibrate quickly.'),
    tr('An empty business case on an expensive idea',
       'Even a rough figure you can defend beats a blank field. Say it is an estimate.'),
    tr('A photograph attached with no explanation',
       'Say in the text what the reviewer is looking at and why it matters.'),
    tr('Ignoring the duplicate warning',
       'Open the similar ideas. Adding your vote and a comment to an existing idea is often more effective than a '
       'second idea.'),
    tr('Naming colleagues who did not contribute',
       'Co-suggester is credit, and it is visible to everyone. Keep it accurate.'),
], [7.4 * cm, 9.6 * cm]))

# ══════════════════════════ 6. AFTER SUBMISSION ════════════════════════════
s.append(PageBreak())
s.append(H1('6. After you submit'))

s.append(H2('6.1 Following your idea'))
s.append(P(
    '<b>My Ideas</b> lists everything you have submitted with its current status, its code, its votes and its '
    'review deadline. Open an idea to see the full record: what you wrote, the attachments, the co-suggesters, the '
    'comments, the votes, and the timeline of every action taken on it.'))

s.append(H2('6.2 The timeline'))
s.append(P(
    'Every idea carries an approval timeline: who did what, when, and what they said about it. A submission, each '
    'review decision, each escalation to a more senior manager, and the final outcome all appear there in order. It '
    'is the answer to "what is happening with my idea", and it cannot be quietly edited - it is also the audit trail '
    'your administrator sees.'))
s.append(P(
    'On an anonymous idea the timeline hides your name from colleagues in the same way the idea itself does, so the '
    'trail does not become the leak.'))

s.append(H2('6.3 Notifications'))
s.append(P(
    'The bell in the top bar collects everything that concerns you: your idea has been reviewed, escalated, approved, '
    'rejected or marked implemented; somebody has commented on it; a reviewer has asked for something. Click a '
    'notification to go straight to the idea, and use <b>mark read</b> to clear the list. If your organisation has '
    'configured email, the important ones arrive by email too - and if email is not working, nothing is lost: the '
    'in-app notification and the idea itself are unaffected.'))

s.append(H2('6.4 What reviewers are looking at'))
s.append(P(
    'It helps to know how your idea appears on the other side. A reviewer&apos;s queue is sorted by deadline first, then '
    'by the quality score, then by age - so an idea with a clear situation, a specific solution and a filled-in '
    'business case surfaces earlier and reads better. Ideas past their deadline are flagged as <b>Overdue</b> on the '
    'reviewer&apos;s screen and on the administrator&apos;s dashboard, so a forgotten idea becomes visible rather than '
    'invisible.'))

s.append(H2('6.5 The quality score'))
s.append(P(
    'Each submitted idea carries a quality score, used to order the review queue so that well-made cases surface '
    'first. It is calculated from what you wrote - whether the situation is specific, whether the solution is '
    'actionable, whether the benefit and the investment are stated - and it is an aid to sequencing, never a '
    'decision. A low score does not reject anything and a high score does not approve anything; a human makes every '
    'decision, and the comment they leave is the one that counts. If your organisation has connected an AI provider '
    'the scoring uses it; if not, a built-in rule-based version does the same job.'))

s.append(H2('6.6 If your idea is rejected'))
s.append(P(
    'You will get a notification and, on the idea, the reviewer&apos;s comment explaining why. Read it as information '
    'rather than a verdict: the most common reasons are that the cost outweighs the benefit as described, that the '
    'work is already scheduled, or that the situation was not specific enough to act on. All three are answerable. '
    'Rework the idea and submit it again as a new idea, referring to the earlier code, and say what changed.'))

# ══════════════════════════ 7. COMMUNITY ═══════════════════════════════════
s.append(H1('7. Taking part: voting, comments and points'))

s.append(H2('7.1 Browsing ideas'))
s.append(P(
    '<b>Idea Board</b> and <b>All Ideas</b> show what your colleagues have submitted. Filter by status, by impact '
    'level, or search by title or idea code. Employees see their own ideas and the ones they are named on; managers '
    'see their team&apos;s; administrators and executives see the whole organisation. Lists show the most recently '
    'updated ideas first and are capped at a hundred at a time, so use the filters rather than scrolling.'))

s.append(H2('7.2 Voting and rating'))
s.extend(bl([
    '<b>Community vote</b> - a simple up vote. Clicking again removes your vote; you cannot vote twice on the same '
    'idea, however fast you click.',
    '<b>Rating</b> - one to five, for how strong you think the idea is. The average appears on the idea.',
    'Votes are a signal to reviewers, not a decision. A popular idea still needs an approval; an unpopular one can '
    'still be approved if the case is good.',
]))

s.append(H2('7.3 Commenting well'))
s.append(P(
    'Anyone in your organisation can comment on a submitted idea. Comments are limited to a thousand characters, '
    'which is about two paragraphs - long enough to be useful, short enough to be read. The comments that help most '
    'are the ones that add information the submitter did not have: that the same thing was tried in 2022, that '
    'another line has the part in stock, that the maintenance window is in three weeks.'))
s.append(P(
    'Your name is attached to your comment and stays in the record. Comments on an anonymous idea are not anonymous '
    '- only the submitter&apos;s identity is protected.'))

s.append(H2('7.4 Points and the leaderboard'))
s.append(table([
    th('When', 'Points'),
    tr('You submit an idea', '+10'),
    tr('Your idea is approved', '+25'),
    tr('Your idea is implemented', '+65'),
], [10.0 * cm, 7.0 * cm]))
s.append(Spacer(1, 5))
s.append(P(
    'The weighting is deliberate: the tool rewards ideas that actually get done far more than ideas that merely get '
    'filed. Your administrator can change these values for your organisation. <b>Leaderboard</b> ranks people and '
    'departments over all time, or by month, quarter or year, and also lists the highest-scoring ideas.'))

s.append(H2('7.5 Challenges'))
s.append(P(
    'A challenge is a campaign your organisation runs for a period - a safety drive, a cost-reduction month, a push '
    'on a particular line. Open <b>Challenges</b> to see what is running and what each one is asking for, then link '
    'your idea to it on the last step of the form. Ideas raised under a challenge are grouped together for reporting, '
    'which is how the organisation sees whether the campaign worked.'))

# ══════════════════════════ 8. REVIEWING ═══════════════════════════════════
s.append(PageBreak())
s.append(H1('8. Reviewing ideas (managers and reviewers)'))
s.append(P(
    'If your role includes review, you have a <b>Review Queue</b>. This section is about using it well; the mechanics '
    'take five minutes to learn, and the judgement takes longer.'))

s.append(H2('8.1 The queue'))
s.append(P(
    'The queue holds the ideas waiting on you: submitted ideas from the people who report to you, ideas escalated to '
    'you by a reviewer below you, and ideas where you have been named on a review committee. It is ordered by '
    'deadline, then by quality score, then by age. Overdue items are flagged, and they also appear on your '
    'administrator&apos;s dashboard - a queue that is quietly ignored does not stay quiet.'))
s.extend(callout('You can never review your own idea',
                 'The button is disabled and the server refuses the action even if the request is sent directly. If '
                 'your own idea is sitting in your queue because you are also the manager of the person who raised it, '
                 'it will route to the level above you instead.'))

s.append(H2('8.2 Making a decision'))
s.append(P('Open the idea, read it, and choose one of four actions:'))
s.append(table([
    th('Decision', 'What it means', 'What happens next'),
    trb('Approve', 'The idea is sound and should go ahead.', 'If there is a more senior reviewer above you in the '
        'chain, the idea moves to them for the final decision and the step is recorded. If you are the final '
        'approver, the idea becomes Approved, the submitter earns points, and it becomes eligible for the '
        'implementation system.'),
    trb('Reject', 'The idea is not being taken forward.', 'The idea is closed as Rejected and the submitter is '
        'notified with your comment. Write the comment as if you were explaining it to them in person - because you '
        'are.'),
    trb('Move to Under Review', 'You have picked it up and are looking into it.', 'The status changes so the '
        'submitter can see somebody has it, and it stays with you.'),
    trb('Mark as Implemented', 'The change has actually been made.', 'The idea is closed as Implemented and the '
        'submitter earns the largest points award. Only use it when the work is genuinely done.'),
], [3.6 * cm, 5.2 * cm, 8.2 * cm], header=False))
s.append(Spacer(1, 5))
s.append(P(
    'Every decision asks for a comment. It is optional for approvals and effectively compulsory for rejections: it is '
    'the only thing the submitter gets to learn from. Decisions are confirmed before they are applied, and are then '
    'written to the audit trail with your name and the time.'))

s.append(H2('8.3 Escalation'))
s.append(P(
    'Approval walks up the reporting line. When you approve an idea and there is a reviewer above you, the idea is '
    'escalated to them rather than closed, they are notified, and the timeline records the level. This is what stops '
    'a single approval committing an organisation to a cost, and it is also why an approved idea sometimes shows as '
    '<b>Under Review</b> again - it has moved up a level, not gone backwards. Your administrator configures how many '
    'levels are required and which roles count as final approvers.'))

s.append(H2('8.4 Committee review'))
s.append(P(
    'Some ideas are routed to several reviewers at once instead of up a chain. Each named reviewer records their own '
    'decision, the idea shows how many have responded, and it closes when the committee has. Use <b>Route to '
    'Committee</b> when an idea crosses departments and one manager&apos;s opinion is not enough.'))

s.append(H2('8.5 Bulk review'))
s.append(P(
    'When a queue has built up, select several ideas and apply the same decision with one comment. Use it for the '
    'genuinely routine cases - duplicates of an idea already approved, or a batch from a campaign that has been '
    'agreed as a whole. A bulk rejection with a generic comment is the fastest way to teach people not to submit '
    'ideas.'))

s.append(H2('8.6 Recording ROI and implementation'))
s.append(P(
    'Managers can record what an approved idea actually returned, and track its implementation status. Do it when the '
    'numbers are known rather than when the idea is approved: the gap between the estimated benefit and the realised '
    'one is the most useful number the whole system produces, and it is what makes next year&apos;s business cases '
    'credible.'))

s.append(H2('8.7 Writing a comment people learn from'))
s.append(P(
    'The comment is the part of a decision that changes what happens next. Two examples, on the same idea:'))
s.append(table([
    th('Weak', 'Strong'),
    tr('"Not feasible."',
       '"Good catch on the coolant loss - the figures match what maintenance reported. We cannot do it this quarter '
       'because line 3 is down for the rebuild in March and the return line is part of that scope. I have added it to '
       'the rebuild list and asked maintenance to confirm the filter spec. Resubmit if it is not in the rebuild plan '
       'by April."'),
    tr('"Approved."',
       '"Approved. Escalating to the plant head for the spend approval on the sensor. The Rs. 4.2 lakh saving looks '
       'right at three shifts; even at two it pays back inside a year."'),
], [5.6 * cm, 11.4 * cm]))
s.append(Spacer(1, 4))
s.append(P(
    'The strong versions take a minute longer and do three things the weak ones do not: they tell the submitter their '
    'work was read, they say what would change the answer, and they leave a record that makes sense to somebody '
    'reading the audit trail a year later.'))

s.append(H2('8.8 The closure summary'))
s.append(P(
    'Reviewers and administrators can export a single idea as a closure summary PDF - the situation, the solution, '
    'the business case, the decisions and the timeline in one document. It is the thing to attach to a management '
    'review pack or hand to an auditor. It is available to the review hierarchy, not to submitters.'))

# ══════════════════════════ 9. ADMIN ═══════════════════════════════════════
s.append(PageBreak())
s.append(H1('9. Running an organisation (administrators)'))
s.append(P(
    'The <b>Admin Panel</b> is where an organisation is configured. It has eight tabs, described one at a time below. '
    'Everything here affects only your organisation.'))

s.append(H2('9.1 Overview'))
s.append(P(
    'Counts and trends for the whole organisation: how many ideas, where they are in the pipeline, how many are '
    'overdue, and how activity is moving. Start here; it usually tells you which of the other tabs you need.'))

s.append(H2('9.2 User List: creating people'))
s.append(P('To add one person, use <b>Add User</b> and fill in:'))
s.append(table([
    th('Field', 'Notes'),
    trb('Name', 'Required. The first four letters also form their temporary password.'),
    trb('Email', 'Required and unique. This is one of the two things they can sign in with.'),
    trb('Employee ID', 'Required and unique. Colleagues search on this when adding co-suggesters.'),
    trb('Date of birth', 'Required. The year forms the second half of the temporary password.'),
    trb('Role', 'Defaults to employee. This decides everything they can see and do - see section 3.'),
    trb('Department / Business unit / Location', 'Optional, and worth filling in: the analytics group by them.'),
    trb('Phone', 'Optional. Lets them sign in with a phone number instead of an email address.'),
    trb('Reports to', 'Their manager. This is what routes their ideas to the right reviewer, so it matters more than '
        'it looks.'),
], [4.6 * cm, 12.4 * cm], header=False))
s.append(Spacer(1, 5))
s.append(P(
    'The new account starts on the derived temporary password (name plus birth year) and is forced to change it at '
    'first sign-in. You never set somebody&apos;s real password for them.'))

s.append(H2('9.3 User List: importing a spreadsheet'))
s.append(P('For a department or a whole site, import instead of typing. The flow is deliberately cautious:'))
s.extend(steps([
    'Download the template from the import screen. It arrives as a spreadsheet with the correct headers, an example '
    'row, a dropdown of valid roles and a sheet of instructions.',
    'Fill it in. Common column names are recognised automatically, so an export from your HR system usually needs '
    'little editing - "emp id", "empid" and "employee code" all map to employee_id, "dob" maps to date_of_birth.',
    'Upload it and review the <b>preview</b>. Every row is validated before anything is created, and each problem is '
    'reported with its row number.',
    'Confirm the import. Rows whose employee ID or email already exists are skipped, never overwritten - so '
    're-uploading the same file is safe.',
    'Download the errors file if some rows were rejected, fix those rows, and upload just those.',
]))
s.append(table([
    th('Column', 'Required', 'Notes'),
    tr('employee_id', 'Yes', 'Unique. The key the import de-duplicates on.'),
    tr('name', 'Yes', 'Full name.'),
    tr('email', 'Yes', 'Unique work email.'),
    tr('date_of_birth', 'Yes', 'YYYY-MM-DD, or just the four-digit year. The first-login password is built from it.'),
    tr('role', 'No', 'Blank means employee. Use the dropdown in the template.'),
    tr('department, business_unit, location, phone', 'No', 'Optional, but they drive the analytics and phone sign-in.'),
    tr('manager_employee_id', 'No', 'The employee ID of their manager - either somebody who already exists or another '
                                    'row in the same sheet. Circular reporting lines are rejected.'),
], [5.4 * cm, 2.0 * cm, 9.6 * cm]))
s.extend(callout('Tell people their first password before you import',
                 'Everybody in the file will be able to sign in with "first four letters of the name plus year of '
                 'birth" until they change it. Send the note that explains this at the same time as you run the '
                 'import, not a week later.'))

s.append(H2('9.4 Hierarchy'))
s.append(P(
    'The reporting line is what routes ideas. Use the <b>Hierarchy</b> tab to see the organisation as a tree and to '
    'set who reports to whom. An employee with no manager has nobody obvious to review their ideas, so this screen is '
    'the first place to look when somebody says their idea has not been picked up.'))

s.append(H2('9.5 System settings'))
s.append(table([
    th('Setting', 'What it does'),
    trb('Approval chain', 'Which roles may review, which roles may give final approval, and how many approvals an '
        'idea needs. Use the default unless your organisation has a specific governance requirement.'),
    trb('Review deadline (SLA)', 'How many days a reviewer has before an idea is flagged as overdue.'),
    trb('Points', 'The values awarded for submission, approval and implementation.'),
    trb('Email (SMTP)', 'The mail server used for notifications and password-reset links. The password is stored '
        'securely and is never shown again once saved - leaving the field blank keeps the stored one.'),
], [4.6 * cm, 12.4 * cm], header=False))

s.append(H2('9.6 Categories and challenges'))
s.append(P(
    'Categories are the improvement areas people tag ideas with. Start with the defaults - quality, cost, delivery, '
    'safety, environment, morale - and add only what your organisation genuinely reports on; a long list makes '
    'tagging meaningless. Challenges are the campaigns described in 7.5: give each one a clear title, a description '
    'of what you want and a closing date.'))

s.append(H2('9.7 Branding'))
s.append(P(
    'Set your organisation&apos;s name and upload a logo, and the tool looks like your own. Logos are stored inside the '
    'app rather than on a public address, so they are visible to your people and to nobody else.'))

s.append(H2('9.8 Analytics, exports and the audit trail'))
s.extend(bl([
    '<b>Analytics</b> - submissions over time, status distribution, activity by department and category, and the '
    'realised versus estimated benefit.',
    '<b>Exports</b> - the full idea list as CSV for your own analysis, an analytics export, and the per-idea closure '
    'summary PDF.',
    '<b>Audit Trail</b> - who did what, and when, across the organisation. This is the record to consult when a '
    'decision is questioned, and the one to show an auditor.',
]))

s.append(H2('9.9 A new administrator&apos;s first week'))
s.append(P(
    'In the order that saves the most rework. Each step assumes the one before it.'))
s.append(table([
    th('Day', 'Do this', 'Why in this order'),
    tr('1', 'Change your own password. Set your organisation name and logo (Branding).',
       'Everything after this is easier to demonstrate to colleagues when the tool already looks like yours.'),
    tr('1', 'Set the review deadline and confirm the approval chain (System).',
       'These decide when ideas go overdue and who has to approve them. Changing them after a hundred ideas exist is '
       'confusing for everyone.'),
    tr('2', 'Agree your categories with whoever reports on improvement, then enter them (Categories).',
       'Ideas submitted before the categories exist are tagged with whatever was available at the time.'),
    tr('2-3', 'Import your people, starting with one small department as a trial.',
       'The preview catches format problems before you commit thousands of rows, and a trial import teaches you the '
       'error report while it is still small.'),
    tr('3', 'Fix the reporting lines (Hierarchy).',
       'This is what routes ideas. An import with missing managers produces ideas that reach nobody, and that is the '
       'single most common cause of "nothing happens when I submit".'),
    tr('4', 'Configure email (System), then test it with a password reset to yourself.',
       'Notifications and reset links depend on it. Everything still works without it, but people have to come and '
       'look.'),
    tr('4', 'Submit one idea as yourself and take it through review to approval.',
       'Ten minutes here finds more configuration mistakes than an hour of checking screens.'),
    tr('5', 'If you use QCMS, paste the API key and set the base URL, then push that test idea.',
       'Prove the connection with one idea you do not mind seeing in QCMS, rather than with a real batch.'),
    tr('5', 'Announce it: what the tool is for, the temporary-password rule, and where to get help.',
       'A launch note that explains the first password prevents most of the first week&apos;s support tickets.'),
], [1.6 * cm, 7.6 * cm, 7.8 * cm]))

s.append(H2('9.10 Keeping it healthy'))
s.extend(bl([
    '<b>Watch the overdue count on the dashboard.</b> It is the earliest sign that a manager is drowning or that the '
    'reporting line is wrong. A queue people trust is a queue people submit to.',
    '<b>Deactivate leavers promptly.</b> Their access ends on their next click, and their ideas stay with the '
    'organisation.',
    '<b>Read the rejection comments occasionally.</b> They are the clearest picture you will get of how the scheme is '
    'being run, and of who needs a word about the tone.',
    '<b>Publish what got implemented.</b> The implementation points and the leaderboard help, but nothing drives '
    'submissions like a colleague&apos;s idea visibly happening.',
    '<b>Review the categories once a quarter.</b> Retire the ones nobody uses.',
]))

# ══════════════════════════ 10. QCMS ═══════════════════════════════════════
s.append(PageBreak())
s.append(H1('10. Approved ideas and the QCMS integration'))
s.append(P(
    'An approved idea still has to be implemented, and implementation is tracked in a separate tool: QCMS, the '
    'Quality and Continuous Improvement Management System. This platform hands approved ideas across so nobody '
    're-types them. Two Admin Panel tabs cover it: <b>Approved Ideas</b> and <b>API &amp; Integration</b>.'))

s.append(H2('10.1 What gets sent'))
s.append(P(
    'Only ideas your organisation has approved, and only when an administrator sends them. What travels is the idea '
    'itself: its code, title, situation, solution, category, department, who submitted it, the co-suggesters, the '
    'tangible and intangible benefit, the investment, the implementation time and the impact level. Nothing else '
    'about your organisation leaves the platform, and the connection is one-way.'))

s.append(H2('10.2 Setting it up'))
s.append(P('Open <b>Admin Panel</b> and then <b>API &amp; Integration</b>. There are three controls:'))
s.append(table([
    th('Control', 'What to do with it'),
    trb('Enable', 'Turn the integration on. Nothing is ever sent while it is off.'),
    trb('API key', 'Paste the key QCMS issued to your organisation (it starts with qcms_live_). It is stored securely '
        'on the server and never shown again - the field displays dots once a key is saved. Leave it blank when you '
        'change another setting and the stored key is kept.'),
    trb('QCMS Base URL', 'The address of your QCMS installation&apos;s integration API. The field is pre-filled with the '
        'default your operator configured, shown as placeholder text. Type your own address to override it for your '
        'organisation, or clear the field to go back to the default. The endpoint that ideas will actually be sent to '
        'is shown underneath as you type, so you can check it before saving.'),
], [4.6 * cm, 12.4 * cm], header=False))
s.append(Spacer(1, 5))
s.append(P(
    'The address must be a full web address beginning with http:// or https:// - anything else is refused when you '
    'save, rather than being accepted and silently failing later. Each organisation holds its own key and its own '
    'address, so two organisations on the same platform can point at completely different QCMS installations.'))
s.extend(callout('Only administrators can change these',
                 'The API key and the address are administrator-only, and the key is never sent back to the browser '
                 'once saved. If an ordinary user reaches this screen, something is wrong with their role - fix the '
                 'role, and tell support.'))

s.append(H2('10.3 Sending ideas across'))
s.append(P(
    'The <b>Approved Ideas</b> tab lists everything your organisation has approved, with a push status against each '
    'one. Send them individually with <b>Push</b>, or send everything outstanding with <b>Push all</b> - which skips '
    'anything already sent. Each idea comes back with one of three outcomes:'))
s.append(table([
    th('Status', 'Meaning', 'What to do'),
    trb('Imported', 'QCMS accepted the idea and created it.', 'Nothing. Track it in QCMS from here.'),
    trb('Duplicate', 'QCMS already had an idea with that code.', 'Nothing - this is the safe outcome of sending the '
        'same idea twice. Pushing is deliberately safe to repeat.'),
    trb('Failed', 'QCMS refused it or could not be reached.', 'Read the message on the row. The usual causes are a '
        'wrong or disabled API key, an incorrect base URL, or QCMS being down. Fix it and push again - nothing was '
        'sent, and nothing was lost.'),
], [3.0 * cm, 6.4 * cm, 7.6 * cm], header=False))

s.append(H2('10.4 If pushing does not work'))
s.append(table([
    th('Symptom', 'Most likely cause'),
    tr('"QCMS integration is turned off"', 'The Enable box is not ticked. Tick it and save.'),
    tr('"No QCMS API key saved"', 'The key field is empty. Paste the key from QCMS and save.'),
    tr('Every idea comes back Failed with an authorisation message',
       'The key is wrong, has been rotated, or has been disabled in QCMS. Get a fresh key.'),
    tr('Every idea comes back Failed with a connection message',
       'The base URL is wrong, or QCMS is unreachable from the server. Check the address shown under the field.'),
    tr('Failures mentioning a rate limit', 'You are sending faster than QCMS accepts. Wait a minute and push again; '
                                           'already-imported ideas will come back as duplicates and be skipped.'),
], [6.4 * cm, 10.6 * cm]))

# ══════════════════════════ 11. SUPPORT ════════════════════════════════════
s.append(H1('11. Getting help'))
s.append(H2('11.1 Raising a support ticket'))
s.append(P(
    'Open <b>Support</b>, describe what happened, and attach a screenshot if you have one. Say what you were trying '
    'to do, what you expected, and what you saw instead - those three sentences save a day of correspondence. You can '
    'reply on the ticket and close it when it is sorted.'))
s.append(P(
    'Support is deliberately reachable even when your account is stuck on a temporary password, because that is '
    'exactly when people need it. Your ticket is visible to the IFQM support team and to your own organisation - and '
    'to nobody else. Internal notes the IFQM team write to each other are never shown to you.'))

s.append(H2('11.2 What to tell your administrator instead'))
s.extend(bl([
    'Wrong role, wrong department, or the wrong manager on your account.',
    'A colleague who needs an account, or one who has left and needs deactivating.',
    'Categories or challenges you would like added.',
    'Password resets, if email is not working for you.',
]))

# ══════════════════════════ 12. PLATFORM ═══════════════════════════════════
s.append(H1('12. For the IFQM platform team'))
s.append(P(
    'Platform administrators sign in without an organisation code and land on the <b>Platform Dashboard</b>. Their '
    'console covers the organisations on the platform - never the contents of any of them.'))
s.append(table([
    th('Screen', 'What it is for'),
    trb('Platform Dashboard', 'Every organisation with its user and idea counts, status and admin contact.'),
    trb('Organisations', 'Create an organisation (name, short code, and the first administrator&apos;s name, email and '
        'password - the database and the schema are created automatically and it is usable immediately), rename it, '
        'suspend or reactivate it, reset its administrator&apos;s password, or remove it. Removal requires typing the '
        'organisation&apos;s code to confirm, because it takes the data with it.'),
    trb('Support Tickets', 'Every ticket from every organisation, with internal notes that the customer never sees.'),
    trb('Settings', 'Platform-wide defaults for new organisations, and the platform administrator accounts. An '
        'administrator cannot delete their own account. Also holds the Messaging and Maintenance tabs below.'),
    trb('Settings &gt; Messaging', 'The text-message gateway and the one-time-code policy: how long a code lasts, '
        'how many wrong attempts are allowed, how long before another may be requested, and the registered sender '
        'and template details the mobile operator requires. It shows the last twenty delivery attempts, and a Test '
        'Connection button that sends a real message so the settings are proved before anybody depends on them. '
        'Code sign-in cannot be switched on while the gateway could not actually deliver.'),
    trb('Settings &gt; Maintenance', 'Puts the whole platform on hold while an update is carried out. See below.'),
], [4.6 * cm, 12.4 * cm], header=False))
s.extend(callout('Suspending an organisation blocks sign-in, it does not delete anything',
                 'Everybody in that organisation is refused at the sign-in page until it is reactivated, and all of '
                 'its data is exactly as it was when it comes back.'))

s.append(H2('12.1 Maintenance mode'))
s.append(P(
    'Maintenance mode puts the entire platform on hold so that developers can work on an update without anybody '
    'using the tool underneath them. Switch it on from <b>Settings &gt; Maintenance</b>. While it is on:'))
s.extend(bl([
    'Nobody from any organisation can sign in - by password or by one-time code.',
    'Sessions that were already open stop working on their next action, so a person part-way through a screen is '
    'stopped rather than left to save into a system being changed.',
    'The sign-in page shows a notice explaining that the platform is under maintenance and to check with the '
    'platform administrator. You can write your own wording; leave it blank for the standard sentence.',
    'IFQM platform administrators are unaffected. They can still sign in and use the whole console.',
]))
s.append(P(
    'That last point is the reason the feature is safe to use: the screen you would need in order to turn it off '
    'keeps working. Turning it on asks you to confirm, because it interrupts every customer at once; turning it off '
    'does not, because it restores service. The panel shows how long the platform has been on hold, so a window '
    'somebody forgot to close is visible rather than something to remember.'))
s.extend(callout('Signing out still works during maintenance',
                 'Somebody whose session is being refused can still sign out cleanly and land on the sign-in screen, '
                 'where the notice is. Leaving them holding a session that every other screen rejects would be a '
                 'worse dead end than the one being prevented.'))

# ══════════════════════════ 13. SECURITY ═══════════════════════════════════
s.append(PageBreak())
s.append(H1('13. Your privacy and security'))
s.append(P(
    'Most of this is handled for you. These are the parts that depend on what you do.'))
s.extend(bl([
    '<b>Your password is yours.</b> Nobody at IFQM and nobody in your organisation can read it. An administrator can '
    'reset it, which is different - and if they do, your existing sessions stop working immediately.',
    '<b>Signing out on a shared machine.</b> Use <b>Keep me signed in</b> only on a device that is yours.',
    '<b>Anonymous means anonymous to colleagues.</b> Your name is hidden from the idea, the timeline and the '
    'co-suggester list. Senior reviewers and administrators can still see it, because an idea has to be accountable '
    'to somebody. Do not mention identifying details in the text if you want to stay unidentified - the tool cannot '
    'hide what you write about yourself.',
    '<b>Attachments are not public.</b> They can only be downloaded through the app by somebody signed in and '
    'entitled to see the idea, and they always download rather than opening inside the page.',
    '<b>Leaving the organisation.</b> When your account is deactivated your access ends on your very next click, not '
    'whenever your session happens to expire. Your ideas stay with the organisation.',
    '<b>Nothing crosses between organisations.</b> Each organisation&apos;s data lives in its own database. There is no '
    'screen, address or trick that shows one organisation another&apos;s ideas.',
]))

s.append(H2('13.1 What happens to your data'))
s.append(table([
    th('Question', 'Answer'),
    tr('Where is my organisation&apos;s data stored?', 'In a database that belongs to your organisation alone, separate '
       'from every other organisation on the platform.'),
    tr('What happens when I leave?', 'Your account is deactivated and access ends immediately. The ideas you '
       'submitted stay with the organisation - removing them would break the audit trail and the analytics that '
       'justified the improvements.'),
    tr('Can an idea be deleted?', 'Not through the app, by design. A submitted idea is closed by a decision, and the '
       'record of that decision is what makes the scheme auditable.'),
    tr('Who can export my ideas?', 'People whose role already lets them see those ideas: your manager for their line, '
       'an administrator for the organisation. An export never contains more than the person could see on screen.'),
    tr('What leaves the platform?', 'Only what an administrator sends to your organisation&apos;s own QCMS installation, '
       'and only for approved ideas. Section 10.1 lists exactly which fields travel.'),
    tr('What if the organisation is suspended?', 'Sign-in is blocked and nothing is deleted. Everything is exactly as '
       'it was when it is reactivated.'),
], [5.8 * cm, 11.2 * cm]))

# ══════════════════════════ 14. TROUBLESHOOTING ════════════════════════════
s.append(H1('14. Troubleshooting and frequently asked questions'))
faq = [
    ('I cannot sign in and I am sure the password is right.',
     'Check whether you are typing an organisation code that you do not need - if your email is registered with only '
     'one organisation, leave it blank. If you have had five failed attempts, the account is locked for 15 minutes. '
     'If it still fails, ask your administrator to reset the password.'),
    ('It says my account has been deactivated.',
     'Your administrator has switched the account off, usually because of a role change or an exit process. Only they '
     'can switch it back on.'),
    ('The sign-in page says the platform is under maintenance.',
     'IFQM is working on an update and has put the platform on hold deliberately. Nobody in any organisation can '
     'sign in until it is finished. Nothing has been lost and nothing is broken - wait, or check with the platform '
     'administrator for how long it is expected to last.'),
    ('My one-time code has not arrived.',
     'Give it a minute; a text can take longer than an email. Check that the number or address you typed is the one '
     'your organisation registered - a code goes only to what is on file. If you asked twice, only the newest code '
     'works, because requesting a new one cancels the previous one. If nothing arrives at all, sign in with your '
     'password instead and tell your administrator, who can ask IFQM to check the gateway.'),
    ('My code is refused even though I typed it correctly.',
     'Codes last five minutes and can be used once. If you have requested another since, the earlier one stopped '
     'working the moment the new one was issued - use the most recent message. After five wrong attempts the code is '
     'destroyed and you need a fresh one.'),
    ('The registration form will not let me submit.',
     'Both the email address and the mobile number have to be verified first: use Send OTP beside each, then Verify '
     'OTP with the code. The form tells you honestly if a code could not be sent, so if it says so, check the '
     'address or number for a typo and try again.'),
    ('It keeps sending me to the change-password screen.',
     'You are still on the temporary password. Nothing else will open until you set a new one of at least twelve '
     'characters.'),
    ('I was signed out in the middle of working.',
     'Either your session reached its time limit, or your password was changed - a password change ends every '
     'session that was opened with the old one. Sign in again; a draft you saved is safe.'),
    ('My idea does not appear in the list.',
     'If it is still a draft, only you can see it - open My Ideas and look for the draft marker. If you submitted it, '
     'check the filters at the top of the list; they persist between visits.'),
    ('I attached a file and it was refused.',
     'Check the type (PDF, Word, Excel, CSV, PNG, JPG, GIF) and the size (10 MB by default). Renaming a file does not '
     'change what it is - the tool checks the real extension.'),
    ('The duplicate warning showed ideas that are not the same as mine.',
     'It matches on similar titles only, and it never blocks you. Read them, then carry on.'),
    ('Nobody has looked at my idea.',
     'Check who you report to on My Profile. An empty reporting line is the usual cause: ideas route to the manager, '
     'so with no manager there is nobody to route to. Ask your administrator to set it.'),
    ('My idea was approved but the status says Under Review again.',
     'It has been escalated to a more senior reviewer for the final decision. The timeline shows the level and who it '
     'went to. It has moved forward, not backward.'),
    ('I cannot review an idea that is in my queue.',
     'You cannot review your own idea, including one you are named on as a co-suggester. It will route to the level '
     'above you.'),
    ('I clicked Approve twice. Have I approved it twice?',
     'No. The tool records one decision no matter how many times the button is pressed, and only one entry appears in '
     'the audit trail.'),
    ('I rejected an idea by mistake.',
     'The decision is in the audit trail and cannot be erased, which is the point of an audit trail. Add a comment '
     'explaining the error, and ask the submitter to resubmit so it can be decided properly.'),
    ('Points look wrong.',
     'Points are awarded on submission, approval and implementation. If your organisation changed the values, ideas '
     'decided earlier keep what they were awarded at the time.'),
    ('Emails are not arriving.',
     'Email is configured per organisation. Ask your administrator to check the mail settings. Nothing is lost when '
     'email fails - notifications still appear in the app and every action is still recorded.'),
    ('The interface is in the wrong language.',
     'Use the language selector in the top bar. It is remembered per device, so it may need setting again on your '
     'phone.'),
    ('An export or a report is missing data I expected.',
     'Exports respect your role: you get what you are allowed to see. An employee&apos;s export covers their own ideas; '
     'a manager&apos;s covers their line; an administrator&apos;s covers the organisation.'),
    ('Can I delete an idea?',
     'No, and deliberately so. Ideas are part of the record. A draft you never submitted can simply be left; a '
     'submitted idea is closed by a decision, not by deletion.'),
    ('Can I change an idea after submitting it?',
     'Add the new information as a comment so the reviewer sees it in context. If it has changed fundamentally, ask '
     'the reviewer to reject it and submit the reworked version.'),
    ('Somebody left and their ideas are still listed.',
     'That is correct: the idea belongs to the organisation, and removing it would break the audit trail and the '
     'analytics. Their account no longer has access.'),
    ('Approved ideas are not reaching QCMS.',
     'See 10.4. Almost always it is the enable switch, the API key, or the base URL.'),
    ('The page is slow, or something looks broken.',
     'Refresh first. If it persists, raise a support ticket with the screen name, what you were doing and the time - '
     'the team can find the matching entry in the logs from that.'),
]
s.append(table([th('Question', 'Answer')] + [[P('<b>%s</b>' % q, S_CELL), P(a, S_CELL)] for q, a in faq],
               [5.8 * cm, 11.2 * cm]))

# ══════════════════════════ 15. LAUNCHING ═════════════════════════════════
s.append(PageBreak())
s.append(H1('15. Launching the tool in your organisation'))
s.append(P(
    'This section is for whoever owns the improvement scheme - usually the organisation administrator together with a '
    'quality or operations lead. The software is the easy part; what decides whether the scheme works is how the '
    'first six weeks are handled.'))

s.append(H2('15.1 Before you announce anything'))
s.extend(bl([
    '<b>Decide who reviews what, and tell them.</b> A reviewer who discovers the queue by accident three weeks in '
    'will not clear it. Walk each manager through their Review Queue before launch.',
    '<b>Agree the deadline you can actually meet.</b> Setting the review SLA to three days and then missing it '
    'teaches people the tool is decorative. Start with a number you can hold and tighten it later.',
    '<b>Decide what happens to an approved idea.</b> Who schedules the work, who funds it, and how it is tracked - '
    'through QCMS or otherwise. An approval that leads nowhere is worse than a rejection with a reason.',
    '<b>Pick the first campaign.</b> A challenge with a clear theme ("energy waste on the shop floor, closing 30 '
    'April") gets far more submissions than an open invitation to suggest anything.',
]))

s.append(H2('15.2 The announcement'))
s.append(P('Whatever form it takes, it needs to answer five questions in this order:'))
s.append(table([
    th('Question', 'What to say'),
    trb('What is it for?', 'One sentence about the kind of problem you want raised, with an example from your own '
        'site. Abstract invitations produce abstract ideas.'),
    trb('How do I get in?', 'The address, and the temporary-password rule - first four letters of the name plus year '
        'of birth - with the instruction to change it immediately.'),
    trb('What happens to my idea?', 'Who reviews it, in how many days, and that they will get a written reason '
        'either way.'),
    trb('What do I get?', 'The points, the leaderboard, and whatever recognition your organisation attaches to them. '
        'Say plainly that implementation is worth the most.'),
    trb('Who do I ask?', 'The administrator&apos;s name for accounts and roles, and the Support screen for anything '
        'broken.'),
], [4.6 * cm, 12.4 * cm], header=False))

s.append(H2('15.3 The first six weeks'))
s.extend(bl([
    '<b>Week 1</b> - watch for people stuck on the temporary password and for ideas that reach nobody because a '
    'reporting line is missing. Both are visible from the dashboard and the hierarchy screen.',
    '<b>Week 2</b> - read every rejection comment yourself. This is the moment the tone of the scheme is set, and it '
    'is much easier to correct in week two than in month six.',
    '<b>Week 3-4</b> - close the loop publicly on the first implemented idea. Name the submitter (unless it was '
    'anonymous), say what changed and what it saved.',
    '<b>Week 5-6</b> - look at the analytics by department. A department with no submissions is almost never a '
    'department with no problems; it is usually one whose manager has not mentioned the tool.',
]))

s.append(H2('15.4 What good looks like after a quarter'))
s.append(table([
    th('Signal', 'What it tells you'),
    tr('Overdue reviews near zero', 'The scheme is credible. This is the single most important number.'),
    tr('Rejections carry real comments', 'People are learning what a fundable idea looks like.'),
    tr('Implemented ideas exist, and people know about them', 'The loop closes; submissions sustain themselves.'),
    tr('Submissions spread across departments', 'It is an organisation-wide scheme rather than one keen team.'),
    tr('Realised benefit recorded against approved ideas', 'You can prove the value of the scheme with numbers rather '
                                                          'than enthusiasm.'),
], [7.0 * cm, 10.0 * cm]))

# ══════════════════════════ 16. QUICK REFERENCE ════════════════════════════
s.append(PageBreak())
s.append(H1('16. Quick reference'))

s.append(H2('16.1 Where things are'))
s.append(table([
    th('I want to...', 'Go to'),
    tr('Raise an idea', 'Submit Idea'),
    tr('See what happened to my ideas', 'My Ideas'),
    tr('Read what colleagues have suggested', 'Idea Board or All Ideas'),
    tr('See what is waiting on me', 'Review Queue'),
    tr('See the campaigns running now', 'Challenges'),
    tr('Check my points and the rankings', 'Leaderboard'),
    tr('See trends for the organisation', 'Analytics'),
    tr('Check who did what', 'Audit Trail'),
    tr('Add or import people', 'Admin Panel > User List'),
    tr('Fix a reporting line', 'Admin Panel > Hierarchy'),
    tr('Change categories, the approval chain or email', 'Admin Panel > Categories / System'),
    tr('Send approved ideas for implementation', 'Admin Panel > Approved Ideas'),
    tr('Set the QCMS key or address', 'Admin Panel > API &amp; Integration'),
    tr('Report a problem', 'Support'),
], [8.4 * cm, 8.6 * cm]))

s.append(H2('16.2 Limits and defaults'))
s.append(table([
    th('Thing', 'Default'),
    tr('Attachment size', '10 MB per file'),
    tr('Attachment types', 'PDF, Word, Excel, CSV, PNG, JPG, GIF'),
    tr('Comment length', '1,000 characters'),
    tr('Situation description', 'At least 20 characters'),
    tr('Co-suggesters', 'No limit'),
    tr('Failed sign-ins before lockout', '5, then 15 minutes'),
    tr('Minimum password length', '12 characters'),
    tr('Points', '+10 submitted, +25 approved, +65 implemented'),
    tr('Ideas shown in a list at once', '100 - use the filters and search'),
    tr('Languages', 'English, Hindi, Kannada, Malayalam, Marathi, Tamil, Telugu'),
], [8.4 * cm, 8.6 * cm]))
s.append(P('Your administrator can change several of these for your organisation.', S_SMALL))

s.append(H2('16.3 Glossary'))
gl = [
    ('Anonymous idea', 'An idea submitted without your name being shown to colleagues. Senior reviewers and '
                       'administrators can still see who submitted it.'),
    ('Approval chain', 'The sequence of roles an idea must pass through before it is finally approved.'),
    ('Audit trail', 'The permanent record of who did what and when, across the organisation.'),
    ('Challenge', 'A campaign inviting ideas on a particular theme for a period.'),
    ('Co-suggester', 'A colleague who worked on the idea with you and shares the credit.'),
    ('Draft', 'A saved but unsubmitted idea, visible only to you and your administrator.'),
    ('Escalation', 'Passing an approved idea up to a more senior reviewer for the final decision.'),
    ('Idea code', 'The permanent identifier an idea gets when submitted, for example IDA-2026-014.'),
    ('Impact level', 'Your assessment of how big the benefit is: Low, Medium or High.'),
    ('Organisation code', 'The short code identifying your organisation at sign-in, for example "acme".'),
    ('QCMS', 'The separate Quality and Continuous Improvement Management System where approved ideas are '
             'implemented and tracked.'),
    ('Review deadline (SLA)', 'The number of days a reviewer has before an idea is flagged as overdue.'),
    ('Role', 'What you are allowed to see and do. Set by your administrator.'),
    ('Temporary password', 'The first-login password derived from your name and year of birth, which must be changed '
                           'before anything else can be used.'),
    ('Timeline', 'The list of actions taken on one idea, in order.'),
]
s.append(table([[Paragraph(clean(k), S_CELLB), P(v, S_CELL)] for k, v in gl], [4.4 * cm, 12.6 * cm], header=False))

s.append(Spacer(1, 16))
s.append(P('End of guide. If something here does not match what you see on screen, your organisation may have '
           'configured the platform differently - ask your administrator, or raise a support ticket.', S_SMALL))

Doc(OUT).multiBuild(s)
print('Wrote %s' % OUT)
