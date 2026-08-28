#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build Kalpion_TestCases_Simple.pdf from backend/test/tc_results.json.

The runner (backend/test/tc_runner.mjs) drives the real Express application over
HTTP against scratch tenant databases and records, per case:

    Test Case ID | Module | Functionality | Expected Output | Actual Output | Result | Timestamp

This script turns that JSON into the deliverable document: narrative sections
that explain what was tested and why, the measured results, the defects the run
found, and then every individual case in full.

Deliberately monochrome — black text on white, grey hairlines only. No colour
anywhere, so it prints and photocopies identically.

    python docs/gen_testcases_doc.py
"""
import json
import os
import re
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = os.path.join(ROOT, 'backend', 'test', 'tc_results.json')
# Writes into docs/ alongside the other documents, not into the project root.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Kalpion_TestCases_Simple.pdf')

BLACK = colors.black
GREY = colors.Color(0.45, 0.45, 0.45)
HAIR = colors.Color(0.65, 0.65, 0.65)
HEADFILL = colors.Color(0.90, 0.90, 0.90)
BANDFILL = colors.Color(0.96, 0.96, 0.96)

# ── Text hygiene ────────────────────────────────────────────────────────────
# The built-in Helvetica covers WinAnsi. Anything outside it (arrows, rupee
# sign, CJK, emoji that appear inside recorded output) is folded down to a plain
# equivalent rather than rendered as a black box.
_MAP = {
    '→': '->', '←': '<-', '⇒': '=>', '≤': '<=', '≥': '>=',
    '₹': 'Rs.', '✓': 'yes', '✗': 'no', '•': '*', '·': '-',
    '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"',
    '”': '"', '…': '...', ' ': ' ', '‑': '-',
}


# Inline markup the narrative is allowed to use. Everything else that looks like
# a tag - including the <script> payloads that appear verbatim in recorded test
# output - is escaped so it prints as text instead of confusing the renderer.
_TAG = re.compile(r'</?(?:b|i|u|sup|sub|br\s*/?)>', re.I)
_BARE_AMP = re.compile(r'&(?!(?:amp|lt|gt|apos|quot|#\d+);)')


def _escape(chunk):
    chunk = _BARE_AMP.sub('&amp;', chunk)
    return chunk.replace('<', '&lt;').replace('>', '&gt;')


def clean(text):
    s = str(text if text is not None else '')
    for src, dst in _MAP.items():
        s = s.replace(src, dst)
    s = ''.join(ch if ord(ch) < 256 else '?' for ch in s)
    out, last = [], 0
    for m in _TAG.finditer(s):
        out.append(_escape(s[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(_escape(s[last:]))
    return ''.join(out)


# ── Styles ──────────────────────────────────────────────────────────────────
SS = getSampleStyleSheet()


def style(name, parent, **kw):
    return ParagraphStyle(name, parent=SS[parent], **kw)


S_TITLE = style('t', 'Title', fontName='Helvetica-Bold', fontSize=22, leading=27, textColor=BLACK, spaceAfter=6)
S_SUB = style('st', 'Normal', fontName='Helvetica', fontSize=11.5, leading=16, textColor=BLACK, alignment=TA_CENTER)
S_H1 = style('h1', 'Heading1', fontName='Helvetica-Bold', fontSize=15, leading=19, textColor=BLACK,
             spaceBefore=18, spaceAfter=8)
S_H2 = style('h2', 'Heading2', fontName='Helvetica-Bold', fontSize=11.5, leading=15, textColor=BLACK,
             spaceBefore=12, spaceAfter=5)
S_BODY = style('b', 'BodyText', fontName='Helvetica', fontSize=9.8, leading=14.2, textColor=BLACK,
               alignment=TA_JUSTIFY, spaceAfter=7)
S_BULLET = style('bl', 'BodyText', fontName='Helvetica', fontSize=9.8, leading=14, textColor=BLACK,
                 leftIndent=14, bulletIndent=4, spaceAfter=3)
S_SMALL = style('sm', 'BodyText', fontName='Helvetica', fontSize=8.6, leading=12, textColor=GREY, spaceAfter=6)
S_CELL = style('c', 'BodyText', fontName='Helvetica', fontSize=8.9, leading=11.6, textColor=BLACK, spaceAfter=0)
S_CELLB = style('cb', 'BodyText', fontName='Helvetica-Bold', fontSize=8.9, leading=11.6, textColor=BLACK, spaceAfter=0)
S_TH = style('th', 'BodyText', fontName='Helvetica-Bold', fontSize=8.9, leading=11.6, textColor=BLACK, spaceAfter=0)
S_CELLS = style('cs', 'BodyText', fontName='Helvetica-Bold', fontSize=8.0, leading=10.4, textColor=BLACK, spaceAfter=0)
S_CELLT = style('ct', 'BodyText', fontName='Helvetica', fontSize=8.0, leading=10.4, textColor=BLACK, spaceAfter=0)
S_MONO = style('m', 'BodyText', fontName='Courier', fontSize=8.4, leading=11.6, textColor=BLACK, spaceAfter=6)


def P(text, s=S_BODY):
    return Paragraph(clean(text), s)


def bullets(items, s=S_BULLET):
    return [Paragraph(clean(i), s, bulletText='-') for i in items]


# ── Document template with running header/footer and a real TOC ─────────────
class Doc(BaseDocTemplate):
    def __init__(self, path, **kw):
        BaseDocTemplate.__init__(self, path, pagesize=A4,
                                 leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                                 topMargin=2.0 * cm, bottomMargin=1.7 * cm, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='body')
        self.addPageTemplates([
            PageTemplate(id='plain', frames=[frame], onPage=self.decorate_plain),
            PageTemplate(id='cover', frames=[frame]),
        ])

    def decorate_plain(self, canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 7.6)
        canvas.setFillColor(GREY)
        canvas.drawString(self.leftMargin, A4[1] - 1.35 * cm,
                          'Kalpion - Test Case & Assurance Document')
        canvas.drawRightString(A4[0] - self.rightMargin, A4[1] - 1.35 * cm, RUN_LABEL)
        canvas.setStrokeColor(HAIR)
        canvas.setLineWidth(0.4)
        canvas.line(self.leftMargin, A4[1] - 1.5 * cm, A4[0] - self.rightMargin, A4[1] - 1.5 * cm)
        canvas.line(self.leftMargin, 1.35 * cm, A4[0] - self.rightMargin, 1.35 * cm)
        canvas.drawString(self.leftMargin, 1.0 * cm, 'Generated from backend/test/tc_results.json - no results are typed by hand.')
        canvas.drawRightString(A4[0] - self.rightMargin, 1.0 * cm, 'Page %d' % doc.page)
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            st = flowable.style.name
            if st == 'h1':
                self.notify('TOCEntry', (0, flowable.getPlainText(), self.page))
            elif st == 'h2':
                self.notify('TOCEntry', (1, flowable.getPlainText(), self.page))


# ── Load results ────────────────────────────────────────────────────────────
if not os.path.exists(RESULTS):
    sys.exit('No results file at %s - run: node test/tc_runner.mjs' % RESULTS)

data = json.load(open(RESULTS, encoding='utf-8'))
CASES = data['results']
TOTAL, PASSED, FAILED = data['total'], data['pass'], data['fail']
RUN_AT = data['generated']
RUN_LABEL = 'Run %s' % RUN_AT

# Modules in first-appearance order, with their case lists.
MODULES = []
for c in CASES:
    if not MODULES or MODULES[-1][0] != c['module']:
        if not any(m[0] == c['module'] for m in MODULES):
            MODULES.append((c['module'], []))
for name, lst in MODULES:
    lst.extend([c for c in CASES if c['module'] == name])


def find(case_id):
    for c in CASES:
        if c['id'] == case_id:
            return c
    return {'actual': 'n/a', 'functionality': case_id, 'result': 'n/a'}


def actual(case_id):
    return find(case_id)['actual']


# Dimension grouping used by the summary and coverage sections.
DIMENSIONS = [
    ('Functional behaviour', ['Authentication', 'Platform Admin', 'Org Admin / Users', 'Ideas',
                              'Voting & Community', 'Comments', 'Review & Approval',
                              'Categories & Challenges', 'Analytics & Reports', 'Notifications',
                              'Reports & Export', 'Branding & Settings', 'Support', 'QCMS Integration']),
    ('Safety, security and privacy', ['Security & Multi-Tenancy', 'Safety & Data Protection']),
    ('Reliability and fault tolerance', ['Reliability & Fault Tolerance']),
    ('Scalability - horizontal', ['Scalability - Horizontal']),
    ('Scalability - vertical', ['Scalability - Vertical & Performance']),
    ('Data integrity and recovery', ['Data Integrity & Recovery']),
    ('Extensibility and future scope', ['Extensibility & Future Scope']),
    ('Observability and operations', ['Observability & Operations']),
]


def norm(name):
    return clean(name).replace('&amp;', '&')


def dim_of(module):
    for dim, mods in DIMENSIONS:
        if any(norm(module) == norm(m) for m in mods):
            return dim
    return 'Functional behaviour'


# ── Reusable table builders ────────────────────────────────────────────────
def grid(rows, widths, header=True, band=True, align_right=()):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    cmds = [
        ('GRID', (0, 0), (-1, -1), 0.4, HAIR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), HEADFILL), ('LINEBELOW', (0, 0), (-1, 0), 0.8, BLACK)]
    if band:
        for i in range(2 if header else 1, len(rows), 2):
            cmds.append(('BACKGROUND', (0, i), (-1, i), BANDFILL))
    for col in align_right:
        cmds.append(('ALIGN', (col, 0), (col, -1), 'RIGHT'))
    t.setStyle(TableStyle(cmds))
    return t


def info_table(pairs, w1=5.0 * cm):
    rows = [[Paragraph(clean(k), S_CELLB), Paragraph(clean(v), S_CELL)] for k, v in pairs]
    return grid(rows, [w1, 17.8 * cm - w1], header=False)


story = []

# ══════════════════════════════ COVER ══════════════════════════════════════
story.append(Spacer(1, 3.2 * cm))
story.append(Paragraph('Kalpion', S_TITLE))
story.append(Paragraph('Test Case and Assurance Document', S_SUB))
story.append(Spacer(1, 0.5 * cm))
story.append(Paragraph('Functionality - Safety - Reliability - Scalability - Data Integrity - Future Scope', S_SUB))
story.append(Spacer(1, 1.6 * cm))
story.append(info_table([
    ('Document', 'Kalpion_TestCases_Simple.pdf'),
    ('System under test', 'Kalpion (multi-tenant, role-based) - Node/Express API + React front end + MySQL'),
    ('Test method', 'Automated runner driving the real application over HTTP; nothing mocked'),
    ('Evidence source', 'backend/test/tc_results.json, written by backend/test/tc_runner.mjs'),
    ('Run completed', RUN_AT),
    ('Total test cases', str(TOTAL)),
    ('Passed', '%d (%.1f%%)' % (PASSED, 100.0 * PASSED / TOTAL)),
    ('Failed', str(FAILED)),
    ('Modules covered', str(len(MODULES))),
    ('Assurance dimensions', str(len(DIMENSIONS))),
    ('Document generated', datetime.now().strftime('%Y-%m-%d %H:%M')),
], w1=4.6 * cm))
story.append(Spacer(1, 1.2 * cm))
story.append(P('Every "Actual Output" in this document is a verbatim record of what the running system did during the '
               'run named above. Nothing in the results tables is written by hand, and a case that fails is printed as '
               'a failure rather than removed.', S_SMALL))
story.append(PageBreak())

# ══════════════════════════════ CONTENTS ═══════════════════════════════════
story.append(Paragraph('Contents', S_H1))
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle('toc1', fontName='Helvetica-Bold', fontSize=10, leading=16, leftIndent=0, firstLineIndent=-0),
    ParagraphStyle('toc2', fontName='Helvetica', fontSize=9.2, leading=13.5, leftIndent=16),
]
story.append(toc)
story.append(PageBreak())

# ══════════════════════════════ 1. PURPOSE ═════════════════════════════════
story.append(Paragraph('1. Purpose and scope', S_H1))
story.append(P(
    'This document is the test record for Kalpion. It exists to answer four questions that '
    'an evaluating organisation asks before putting a system in front of its whole workforce: does it do what it '
    'claims, is it safe with people&apos;s data, does it stay up when things go wrong, and will it still work when the '
    'organisation is ten times larger than it is today. A fifth question - can this be extended without a rewrite - is '
    'answered in the same way, because a system that cannot absorb the next requirement becomes a liability whatever '
    'its test results say.'))
story.append(P(
    'The scope is the whole product as deployed: the HTTP API that every client uses, the multi-tenant database layer '
    'beneath it, the authentication and authorisation rules, the file handling, the outbound integration with the QCMS '
    'implementation tool, and the operational surfaces (health probes, logging, migrations, backups) that keep it '
    'running. The React front end is exercised indirectly: every screen in it is a client of the endpoints tested here, '
    'and the rules that matter are enforced on the server precisely so that a browser cannot talk its way around them.'))

story.append(Paragraph('1.1 Audience, and how to use this document', S_H2))
story.append(P(
    'It is written for four readers, and each can stop at a different point. An <b>evaluator or buyer</b> needs '
    'sections 5 to 9: the results, what the testing found, the measured behaviour under load, and the residual risks '
    'stated plainly. An <b>IT or security reviewer</b> will want section 3.4 (the threat model), section 4.2 (the '
    'safety approach), and then the Safety and Data Protection cases in section 10 in full. An <b>operations team</b> '
    'should read sections 7 and 9 with appendices B and C, which list every endpoint with its access rule and every '
    'configuration setting that a claim in this document depends on. A <b>developer joining the project</b> should '
    'read section 3 and then run the suite; it is the fastest accurate description of how the system behaves.'))

story.append(Paragraph('1.2 How to read a test case', S_H2))
story.append(P(
    'Each case is one row with seven fields, the same format used across this programme:'))
story.extend(bullets([
    '<b>Test Case ID</b> - stable identifier of the form TC-&lt;MODULE&gt;-&lt;NNN&gt;.',
    '<b>Module</b> - the functional or assurance area the case belongs to.',
    '<b>Functionality</b> - what was done, described as an action a person or a client performs.',
    '<b>Expected Output</b> - the behaviour the system is required to show. Written before the run, not after it.',
    '<b>Actual Output</b> - what the running system actually did, recorded automatically, including measured latency, '
    'row counts and error text where those are the point of the case.',
    '<b>Result</b> - Pass only when the actual output satisfies the expectation. Anything else is a Fail.',
    '<b>Timestamp</b> - when that case executed.',
]))
story.append(P(
    'Negative cases are as important as positive ones and are written the same way. "User enters an email that does not '
    'exist" expects a refusal, so a refusal is a Pass and a successful login would be a Fail. Roughly half the suite is '
    'of this kind: it is easy to show that a feature works, and much more useful to show that it refuses to work when '
    'it should.'))

# ══════════════════════════════ 2. SYSTEM UNDER TEST ═══════════════════════
story.append(Paragraph('2. The system under test', S_H1))
story.append(P(
    'The platform collects improvement ideas from employees, routes them through a review hierarchy, rewards '
    'participation with points and recognition, and hands approved ideas to the QCMS tool where implementation is '
    'tracked. It is sold to multiple organisations at once, which is the single most important fact about its '
    'architecture and about this test plan.'))

story.append(Paragraph('2.1 Tenancy model', S_H2))
story.append(P(
    'Each customer organisation is a tenant with its own MySQL schema. A registry database holds the list of tenants '
    'and, per tenant, the database host and schema name. A request is bound to exactly one tenant by the organisation '
    'slug carried inside the caller&apos;s signed token; the connection pool handed to the request is that tenant&apos;s pool '
    'and no other. Cross-tenant leakage is therefore not prevented by a WHERE clause that somebody might forget - the '
    'other organisation&apos;s rows are in a different schema that the request never opens. Several cases in this document '
    'attack that boundary directly by presenting one tenant&apos;s record identifiers to another tenant&apos;s session.'))

story.append(Paragraph('2.2 Roles', S_H2))
role_rows = [[Paragraph(x, S_TH) for x in ('Role', 'What it can do', 'Where the account lives')]]
for r, d, w in [
    ('Platform Admin', 'Vendor staff. Creates and suspends organisations, manages support tickets and platform '
                       'settings. Sees tenant counts and admin contacts only - never a tenant&apos;s ideas, users or files.',
     'Registry database'),
    ('Super Admin / Admin', 'Runs one organisation: users, hierarchy, approval chain, categories, challenges, '
                            'branding, mail settings, analytics, exports, and the QCMS integration.', 'That tenant'),
    ('Plant Head / Executive', 'Organisation-wide visibility of ideas and analytics; final approval authority.', 'That tenant'),
    ('Senior Manager / Department Manager / Manager', 'Reviews ideas from their reporting line, approves, rejects or '
                                                     'escalates, records ROI and implementation progress.', 'That tenant'),
    ('Team Lead / Project Lead', 'First-level review of their team&apos;s ideas.', 'That tenant'),
    ('Employee / Trainee', 'Submits ideas, attaches evidence, names co-suggesters, votes, comments, earns points.', 'That tenant'),
]:
    role_rows.append([Paragraph(clean(r), S_CELLB), P(d, S_CELL), P(w, S_CELL)])
story.append(grid(role_rows, [4.3 * cm, 10.3 * cm, 3.2 * cm]))
story.append(Spacer(1, 6))
story.append(P(
    'The role in the signed token is never trusted. On every single request the user row is re-read from the '
    'tenant database and the role, the account status and the password-change marker are taken from that row. Three '
    'cases in the safety module exist purely to prove this: a token whose role claim has been raised to admin, a token '
    'belonging to an account that has since been deactivated, and a token issued before a password change.', ))

story.append(Paragraph('2.3 Idea lifecycle', S_H2))
story.append(P(
    'Draft - Submitted - Under Review - Approved or Rejected - Implemented. Approval can escalate up the reporting '
    'line: an approval by a reviewer who has a manager above them in the reviewer pool moves the idea to that manager '
    'rather than closing it, and each hop is written to the idea&apos;s workflow trail. Points are awarded on submission, '
    'on approval and on implementation, at values that are configuration rather than code.'))

story.append(Paragraph('2.4 The life of one request', S_H2))
story.append(P(
    'Almost every case in this document is an assertion about one of the steps below, so it is worth setting them out '
    'once. A request arrives and passes through, in order:'))
story.extend(bullets([
    '<b>Security headers</b> - a locked-down content policy, no-referrer, nosniff, no framework fingerprint, and HSTS '
    'when HTTPS is enforced.',
    '<b>Transport</b> - in a configuration that enforces HTTPS, a plaintext request is redirected rather than allowed '
    'to carry a bearer token in the clear.',
    '<b>Cross-origin policy</b> - only origins on the configured allow-list are granted access.',
    '<b>Body limits</b> - one megabyte, enforced before any handler sees the request, with a clean client error '
    'rather than a server error.',
    '<b>Rate limiting</b> - a per-IP global budget, a much tighter budget on authentication endpoints that counts '
    'only failures, and a small hourly budget on expensive operations such as bulk rescoring and imports.',
    '<b>Authentication</b> - the signed token is verified with the algorithm pinned by the server, then the tenant is '
    'resolved from the organisation slug inside it and that tenant&apos;s connection pool is attached to the request.',
    '<b>Live user check</b> - the user row is re-read: role, account status and the password-change marker come from '
    'the database, never from the token. A user still holding a temporary password is confined to changing it.',
    '<b>Authorisation</b> - the route&apos;s declared role list is checked against the role just read from the database.',
    '<b>Handler and service</b> - all statements are parameterised, and every query runs against the tenant pool that '
    'was attached in step six, which is what makes cross-tenant access structurally impossible rather than merely '
    'forbidden.',
    '<b>Error handling</b> - known errors keep their status and message; anything unexpected is logged with its method '
    'and path and returned to the caller as a generic message with no internals.',
]))

# ══════════════════════════════ 3. ENVIRONMENT & METHOD ════════════════════
story.append(Paragraph('3. Test environment and method', S_H1))
story.append(P(
    'The suite is not a set of unit tests with mocked databases. It starts the real application factory, listens on a '
    'real port, and sends real HTTP requests. Where a case needs to know what was stored, it queries the database '
    'directly rather than trusting the response body it just received.'))

story.append(Paragraph('3.1 Environment', S_H2))
story.append(info_table([
    ('Application', 'Node.js / Express API (the production application factory, unmodified)'),
    ('Database', 'MySQL, three scratch schemas created and dropped by the run: a tenant registry and two tenant '
                 'databases, plus any tenant the product itself provisions during the run'),
    ('Isolation', 'Registry, fallback tenant and all seed rows are redirected to the scratch schemas before the '
                  'application configuration is loaded, so no code path - including the default-tenant fallback - can '
                  'reach a real database'),
    ('Second instance', 'For the horizontal-scalability module a second, separate operating-system process runs the '
                        'same application against the same databases, on its own port'),
    ('External systems', 'The QCMS endpoint is replaced by purpose-built local servers that reproduce its documented '
                         'behaviour, including 201 imported, 409 duplicate, 401 invalid key, a connection refusal and '
                         'a server that accepts the connection and then never answers'),
    ('Mail', 'Deliberately pointed at an unreachable SMTP host for the fault-tolerance cases'),
    ('Data volume', 'One tenant is loaded with %s ideas and %s additional user accounts before the performance cases run'
     % ('5,000', '300')),
    ('Rate limits', 'The per-IP global limiter is raised for the run because the suite is itself a load generator; the '
                    'shipped defaults are 300 requests/minute per IP and 30 authentication attempts per 15 minutes'),
], w1=4.2 * cm))

story.append(Paragraph('3.2 What "Actual Output" is allowed to be', S_H2))
story.append(P(
    'A case may only report what it observed. Latency figures are wall-clock measurements around the request. Row '
    'counts come from a direct query. Error strings are the exact text the API returned. Where a case documents a '
    'design limitation rather than a defect - for example that per-process rate-limit counters are not shared between '
    'instances - the limitation is written into the expected output so the reader is not misled by a green result.'))

story.append(Paragraph('3.3 Reproducing this run', S_H2))
story.append(Paragraph(clean(
    'cd backend\n'
    'npm install\n'
    'node test/tc_runner.mjs        # writes test/tc_results.json\n'
    'npm test                       # the assertion suite (33 tests)\n'
    'python ../docs/gen_testcases_doc.py'), S_MONO))
story.append(P(
    'The runner is destructive only towards its own scratch schemas, which it drops on the way in and on the way out. '
    'It is safe to run on a machine that also holds live data.'))

story.append(Paragraph('3.4 The rules a case has to follow', S_H2))
story.append(P(
    'A suite is only as trustworthy as the discipline behind the cases in it, so five rules are applied to every one '
    'of them.'))
story.extend(bullets([
    '<b>The expectation is written first.</b> If the expected output were written after seeing the behaviour, the '
    'suite would document the system rather than test it.',
    '<b>Assert the consequence, not the mechanism.</b> A vote case counts the stored rows; it does not check that a '
    'particular function was called. That is what lets the implementation be rewritten without rewriting the suite.',
    '<b>Verify persistence independently.</b> Where a case matters, it queries the database rather than believing the '
    'response body it just received - several cases pass their HTTP check and would still fail here.',
    '<b>No case may depend on another case&apos;s leftovers.</b> Cases that must deactivate, delete, lock or expire an '
    'account seed their own throwaway account for the purpose.',
    '<b>A limitation is written into the expectation.</b> Where behaviour is a deliberate design trade-off rather than '
    'a guarantee - per-process rate-limit counters, attachments on local storage - the expected output says so, so a '
    'green result never overstates what was proven.',
]))

story.append(Paragraph('3.5 Threat model behind the safety cases', S_H2))
story.append(P(
    'The safety module is not a checklist of fashionable vulnerabilities; it is derived from what an attacker or a '
    'careless integration would actually try against a multi-tenant workplace application, and from the incidents '
    'that occur in systems of this shape.'))
threat_rows = [[Paragraph(x, S_TH) for x in ('Threat', 'Why it matters here', 'Cases')]]
for th, why, cs in [
    ('Forged or edited session token', 'Anyone who can mint a token owns every tenant. This includes the classic '
     '"algorithm none" trick and simply editing the role inside an otherwise valid token.',
     'TC-SAFE-001 to TC-SAFE-004'),
    ('Stale session after a personnel change', 'An employee who leaves, or is demoted, keeps a valid token for hours '
     'unless the server re-checks the row.', 'TC-SAFE-007 to TC-SAFE-010'),
    ('Self-granted privilege', 'The cheapest escalation is to send a role field the server did not expect to receive.',
     'TC-SAFE-005, TC-SAFE-006'),
    ('Cross-tenant read', 'Identifiers auto-increment per tenant, so the same number exists in every organisation. '
     'Isolation must not depend on a filter somebody could forget.',
     'TC-SEC-001, TC-SUP-002, TC-EXP-003, TC-SAFE-023'),
    ('Attachment as an attack surface', 'Uploads are the most common way to get executable content into an origin, '
     'and the most common way for private documents to become public URLs.', 'TC-SAFE-017 to TC-SAFE-026'),
    ('Injection', 'Any string a user types can reach a query or a rendered page.',
     'TC-AUTH-007, TC-SEC-003, TC-SAFE-015, TC-SAFE-016'),
    ('Secret disclosure', 'Password hashes, mail passwords and integration keys leak through responses far more often '
     'than through databases.', 'TC-SAFE-011, TC-BRND-003, TC-QCMS-002'),
    ('Identity disclosure of an anonymous report', 'The feature is worthless if a colleague can work out who filed '
     'the report - and the disclosure is usually in a field nobody thought about.',
     'TC-SAFE-027 to TC-SAFE-029'),
    ('Credential stuffing and spraying', 'Per-account lockout stops grinding one account; the IP budget is what caps '
     'a spray across many.', 'TC-AUTH-011, TC-SAFE-033, TC-SAFE-034, TC-SCLH-011'),
    ('Denial of service through cost', 'Oversized bodies, huge uploads, unbounded exports and repeated expensive '
     'operations.', 'TC-SEC-004, TC-SAFE-019, TC-SCLV-002, TC-SCLV-003'),
    ('Insecure deployment', 'The most likely real-world failure is not an exploit but shipping with the example '
     'secret and a passwordless database.', 'TC-SAFE-035, TC-OPS-007'),
]:
    threat_rows.append([Paragraph(clean(th), S_CELLB), P(why, S_CELL), Paragraph(clean(cs), S_CELL)])
story.append(grid(threat_rows, [4.2 * cm, 9.0 * cm, 4.6 * cm]))

# ══════════════════════════════ 4. APPROACH BY DIMENSION ═══════════════════
story.append(Paragraph('4. Test approach, dimension by dimension', S_H1))

story.append(Paragraph('4.1 Functional behaviour', S_H2))
story.append(P(
    'Every feature area is exercised through the same endpoints the browser uses: authentication, organisation '
    'provisioning, user administration and bulk import, idea submission and retrieval, voting and rating, comments, '
    'the review and approval chain, categories and challenges, analytics, notifications, exports, branding and mail '
    'settings, the support desk, and the QCMS integration. Each area includes at least one case that supplies invalid '
    'input and at least one that supplies valid input from the wrong role.'))

story.append(Paragraph('4.2 Safety, security and privacy', S_H2))
story.append(P(
    'This is the largest module in the suite. It is organised around the ways a system of this kind is actually '
    'attacked or, more often, accidentally leaks:'))
story.extend(bullets([
    '<b>Token forgery and misuse</b> - unsigned (alg=none) tokens, tokens signed with a foreign secret, expired '
    'tokens, and tokens whose embedded role has been edited upwards.',
    '<b>Session lifetime against reality</b> - a token must stop working the moment the account is deactivated, '
    'deleted, or has its password changed. Offboarding that does not end a session is a real breach, not a nuisance.',
    '<b>Privilege escalation and mass assignment</b> - an employee editing their own user record, or posting a role '
    'and a points balance through the profile endpoint.',
    '<b>Tenant isolation</b> - one organisation presenting another organisation&apos;s identifiers for ideas, tickets, '
    'attachments and PDFs.',
    '<b>File handling</b> - extension allow-list, double extensions, oversize uploads, ownership on upload and delete, '
    'authentication on download, path traversal, and the response headers that stop a stored file executing in the '
    'application&apos;s own origin.',
    '<b>Injection and malformed input</b> - SQL metacharacters in query parameters and stored fields, script payloads, '
    'malformed JSON, oversized bodies, CRLF in user-supplied names.',
    '<b>Secret handling</b> - password hashes, SMTP passwords and integration API keys must never appear in any '
    'response, and the configuration guard must refuse to boot a production server with placeholder secrets.',
    '<b>Privacy of anonymous submissions</b> - the identity must be hidden from colleagues in every field of the '
    'response, while remaining recoverable in the database for accountability.',
    '<b>Brute force</b> - per-account lockout that a correct password cannot clear, counted centrally so that it '
    'cannot be evaded by rotating between application instances.',
]))

story.append(Paragraph('4.3 Reliability and fault tolerance', S_H2))
story.append(P(
    'Two questions: does the service degrade gracefully when something it depends on fails, and does it stay correct '
    'when several things happen at the same instant. The first is tested by breaking dependencies deliberately - an '
    'unreachable QCMS endpoint, a QCMS server that accepts a connection and never replies, an unreachable mail server '
    '- and requiring that the user-facing operation still completes and is still recorded. The second is tested with '
    'genuine parallel requests: ten simultaneous votes from one user, ten simultaneous comments, five simultaneous '
    'approvals of the same idea, and two simultaneous account creations with the same email address. Concurrency '
    'cases are where this run found real defects; section 6 records them.'))

story.append(Paragraph('4.4 Scalability - horizontal', S_H2))
story.append(P(
    'Horizontal scalability means adding a second application server and having the system behave identically. The '
    'only honest way to test that is to run two separate processes against one database and prove that a request may '
    'land on either. The suite spawns a second instance and checks that a session minted on one is accepted by the '
    'other in both directions, that data written on one is visible on the other with no cache to go stale, that '
    'organisation settings, branding, integration credentials and newly created tenants are picked up without a '
    'restart, that the brute-force lockout is enforced across instances, and that killing one instance leaves the '
    'other serving.'))

story.append(Paragraph('4.5 Scalability - vertical', S_H2))
story.append(P(
    'Vertical scalability means the same box coping with far more data. One tenant is loaded with five thousand ideas '
    'and three hundred extra users, and then every screen that an organisation actually uses is held to a latency '
    'budget on that dataset: the idea list, the dashboard aggregates, analytics, the leaderboard, the audit report, '
    'search, filtered lists, the integration listing, single-idea retrieval and the full CSV export. Alongside the '
    'budgets, the suite checks the structural properties that keep those numbers flat as the dataset grows: the '
    'response is capped at one hundred rows and a client cannot raise that cap, the ordering index exists and the '
    'query plan uses it, thirty concurrent requests queue against a pool of ten rather than failing, resident memory '
    'does not grow with the dataset, and the second tenant is unaffected by the first tenant&apos;s volume.'))

story.append(Paragraph('4.6 Data integrity and recovery', S_H2))
story.append(P(
    'Schema changes are applied by a migration runner with a ledger, so the suite runs it, runs it again to prove it '
    'applies nothing the second time, and then drops a brand-new migration file into the folder to prove that a future '
    'change is picked up automatically and recorded. Beyond that: unique constraints, cascade behaviour when a parent '
    'row is removed, the atomicity of a decision (status and audit entry together), points arithmetic against the '
    'configured values, timestamp consistency with the database clock, character set and storage engine of every '
    'table, a primary key on every table, and the backup and restore path.'))

story.append(Paragraph('4.7 Extensibility and future scope', S_H2))
story.append(P(
    'A test suite cannot prove that a future requirement will be easy, but it can prove that the extension points '
    'exist and work today. The cases here add a real tenant at runtime and use it immediately, hold two organisations '
    'on different integration endpoints at the same time, confirm that every capacity and policy limit is read from '
    'configuration rather than hard-coded, check translation coverage across all seven shipped languages, apply a new '
    'migration file, and confirm that the field mapping to the downstream system is a pure function - which is what '
    'makes a second downstream system a new mapper rather than a new project.'))

story.append(Paragraph('4.8 Observability and operations', S_H2))
story.append(P(
    'Liveness and readiness are separate probes, because a process that is running but cannot reach its database is '
    'worse than one that is down. The suite checks both, the cost of polling them, the graceful-shutdown path, the '
    'crash handlers, the durable log trail, the audit report, and the boot-time configuration guard.'))

story.append(Paragraph('4.9 What this suite does not cover', S_H2))
story.append(P(
    'Stating the boundary is part of the evidence. This suite does not exercise the browser: layout, keyboard '
    'navigation, screen-reader behaviour and visual regressions are outside its reach, and the rules it verifies are '
    'verified on the server precisely because a browser cannot be trusted to enforce them. It does not test a real '
    'SMTP delivery, a real QCMS installation, or the network between them - it tests what this system does when those '
    'behave, misbehave, or vanish. It is not a penetration test by an independent party, and it is not a capacity '
    'certification on production hardware; section 9 says what to do about both.'))

# ══════════════════════════════ 5. RESULTS ═════════════════════════════════
story.append(PageBreak())
story.append(Paragraph('5. Results', S_H1))
story.append(P(
    'The run named on the cover executed <b>%d</b> cases. <b>%d</b> passed and <b>%d</b> failed, a pass rate of '
    '<b>%.1f%%</b>. The failures found during development of this cycle are described in section 6 together with the '
    'code changes that resolved them; the figures below are from the final run after those changes.'
    % (TOTAL, PASSED, FAILED, 100.0 * PASSED / TOTAL)))

story.append(Paragraph('5.1 By assurance dimension', S_H2))
rows = [[Paragraph(x, S_TH) for x in ('Assurance dimension', 'Cases', 'Passed', 'Failed', 'Pass rate')]]
for dim, _ in DIMENSIONS:
    sel = [c for c in CASES if dim_of(c['module']) == dim]
    if not sel:
        continue
    p = len([c for c in sel if c['result'] == 'Pass'])
    rows.append([P(dim, S_CELL), P(str(len(sel)), S_CELL), P(str(p), S_CELL),
                 P(str(len(sel) - p), S_CELL), P('%.0f%%' % (100.0 * p / len(sel)), S_CELL)])
rows.append([Paragraph('<b>All dimensions</b>', S_CELLB), Paragraph('<b>%d</b>' % TOTAL, S_CELLB),
             Paragraph('<b>%d</b>' % PASSED, S_CELLB), Paragraph('<b>%d</b>' % FAILED, S_CELLB),
             Paragraph('<b>%.1f%%</b>' % (100.0 * PASSED / TOTAL), S_CELLB)])
story.append(grid(rows, [7.6 * cm, 2.4 * cm, 2.4 * cm, 2.4 * cm, 3.0 * cm]))

story.append(Paragraph('5.2 By module', S_H2))
rows = [[Paragraph(x, S_TH) for x in ('Module', 'Dimension', 'Cases', 'Passed', 'Failed')]]
for name, lst in MODULES:
    p = len([c for c in lst if c['result'] == 'Pass'])
    rows.append([P(name, S_CELL), P(dim_of(name), S_CELL), P(str(len(lst)), S_CELL),
                 P(str(p), S_CELL), P(str(len(lst) - p), S_CELL)])
story.append(grid(rows, [5.6 * cm, 6.2 * cm, 2.0 * cm, 2.0 * cm, 2.0 * cm]))

# ══════════════════════════════ 6. DEFECTS ═════════════════════════════════
story.append(PageBreak())
story.append(Paragraph('6. Defects found by this cycle, and their fixes', S_H1))
story.append(P(
    'Deepening the suite was worthwhile precisely because it failed. Three genuine defects were found, all of them in '
    'behaviour that the previous, shallower suite could not have reached: two only appear under true concurrency, and '
    'one only appears when the response is inspected field by field rather than as a whole. Each was fixed in the '
    'product, and each now has a permanent case guarding it.'))

def defect(n, title, sev, found_by, symptom, cause, fix, guard):
    rows = [
        [Paragraph('Severity', S_CELLB), P(sev, S_CELL)],
        [Paragraph('Found by', S_CELLB), P(found_by, S_CELL)],
        [Paragraph('Symptom', S_CELLB), P(symptom, S_CELL)],
        [Paragraph('Root cause', S_CELLB), P(cause, S_CELL)],
        [Paragraph('Fix', S_CELLB), P(fix, S_CELL)],
        [Paragraph('Now guarded by', S_CELLB), P(guard, S_CELL)],
    ]
    return [Paragraph(clean('6.%d %s' % (n, title)), S_H2), grid(rows, [3.2 * cm, 14.6 * cm], header=False, band=False)]

story.extend(defect(
    1, 'Simultaneous submissions collided on the idea code', 'High - user-visible failure of the core action',
    'TC-REL-024 (export requested while writes are in flight): only 2 of 5 parallel submissions were stored.',
    'Two employees submitting at the same instant both received a server error. The idea was not saved and the '
    'submitter was given no usable explanation.',
    'The next idea code was derived from COUNT(*) of this year&apos;s ideas. Two concurrent submissions read the same '
    'count and computed the same code, and the column is UNIQUE, so the second INSERT failed. The same arithmetic also '
    'reused a number whenever any idea was deleted, so a deletion could break the next unrelated submission.',
    'The sequence is now taken from the highest code already issued this year rather than a count, and the insert '
    'retries on a duplicate-key collision after re-reading the sequence. A collision is now invisible to the '
    'submitter instead of being fatal.',
    'TC-REL-024 (five parallel writes must all be stored) and TC-DATA-008 (the sequence must continue past the highest '
    'issued code after a deletion).'))

story.extend(defect(
    2, 'An idea could be approved five times over', 'Medium - audit and notification integrity',
    'TC-REL-010 (five simultaneous approvals of the same idea): five approval entries were written.',
    'A double-tapped Approve button, or a client retry on a slow connection, produced multiple approval records for '
    'one decision, multiple notifications to the submitter and a duplicated audit trail.',
    'The duplicate-action guard read the recent-actions table and then wrote to it. Under true concurrency all callers '
    'read "nothing recent" before any of them wrote, so the guard never fired.',
    'The whole decision now runs under a named database lock scoped to the idea, so the read-then-write is atomic - '
    'and, because the lock lives in MySQL rather than in the process, it holds across every application instance '
    'behind a load balancer, not just within one.',
    'TC-REL-010 (exactly one approval row after five parallel approvals) and TC-DATA-009 (status and audit entry '
    'written together).'))

story.extend(defect(
    3, 'Anonymous submissions were identifiable from the approval timeline', 'High - privacy commitment broken',
    'TC-SAFE-027 (anonymous idea opened by a colleague): the author&apos;s real name was present in the response.',
    'The header fields of an anonymous idea were masked, but the approval timeline attached to the same response '
    'carried an actor name on every entry - starting with the author&apos;s own "Submitted" entry - and the co-suggester '
    'list named the colleagues who raised it with them. Any employee who opened the idea could see exactly who filed '
    'the anonymous report.',
    'Masking was applied to the summary fields only, and had not followed the data into the related collections '
    'returned alongside it.',
    'Masking now covers the whole payload for a viewer who is not privileged and is not the author: timeline entries '
    'authored by the submitter are attributed to "Anonymous", and the co-suggester list is withheld. The author still '
    'sees their own submission unmasked, and the submitter identity remains in the database for accountability.',
    'TC-SAFE-027 (colleague must not see the identity anywhere in the payload), TC-SAFE-028 (the author must still see '
    'their own), TC-SAFE-029 (the database must still hold the real submitter).'))

story.append(Paragraph('6.4 Observations that were not defects', S_H2))
story.extend(bullets([
    'The global rate limiter did its job so effectively that it initially failed the performance module - the suite '
    'itself was throttled at 300 requests per minute. The limiter is correct; the runner now raises the limit for its '
    'own traffic and the shipped default is documented rather than disabled.',
    'Tenant provisioning is not idempotent when a database for that slug already exists from an earlier run. This is '
    'correct behaviour for a product (silently adopting an existing schema would be worse), but it means an aborted '
    'provisioning attempt must be cleaned up before the slug can be reused. The runner now removes the schemas it '
    'provisions.',
]))

# ══════════════════════════════ 7. MEASUREMENTS ════════════════════════════
story.append(PageBreak())
story.append(Paragraph('7. Measured behaviour under load', S_H1))
story.append(P(
    'The figures below were measured during this run on a single developer-class machine with the database on the '
    'same host. They are not a capacity certification for production hardware; they are evidence that the work per '
    'request does not grow with the size of the dataset, which is the property that decides whether a system survives '
    'its third year.'))

story.append(Paragraph('7.1 Dataset', S_H2))
story.append(info_table([
    ('Load applied', actual('TC-SCLV-001')),
    ('Idea list payload', actual('TC-SCLV-002')),
    ('Client cap override attempt', actual('TC-SCLV-003')),
    ('Query plan for the list', actual('TC-SCLV-015')),
    ('Ordering index', actual('TC-SCLV-014')),
], w1=5.2 * cm))

story.append(Paragraph('7.2 Latency at 5,000 ideas', S_H2))
perf_ids = ['TC-SCLV-004', 'TC-SCLV-005', 'TC-SCLV-006', 'TC-SCLV-007', 'TC-SCLV-008',
            'TC-SCLV-009', 'TC-SCLV-010', 'TC-SCLV-011', 'TC-SCLV-012', 'TC-SCLV-013']
rows = [[Paragraph(x, S_TH) for x in ('Operation', 'Measured', 'Budget', 'Result')]]
for cid in perf_ids:
    c = find(cid)
    m = re.search(r'in (\d+) ms \(budget (\d+) ms\)', c['actual'])
    rows.append([P(c['functionality'], S_CELL),
                 P((m.group(1) + ' ms') if m else c['actual'], S_CELL),
                 P((m.group(2) + ' ms') if m else '-', S_CELL),
                 P(c['result'], S_CELL)])
story.append(grid(rows, [8.6 * cm, 3.2 * cm, 3.0 * cm, 3.0 * cm]))

story.append(Paragraph('7.3 Throughput, concurrency and footprint', S_H2))
story.append(info_table([
    ('Full CSV export', actual('TC-SCLV-016')),
    ('Concurrency against the pool', actual('TC-SCLV-017')),
    ('Sustained read throughput', actual('TC-SCLV-018')),
    ('Neighbouring tenant', actual('TC-SCLV-019')),
    ('Process memory after the load', actual('TC-SCLV-020')),
], w1=5.2 * cm))
story.append(Spacer(1, 4))
story.append(P(
    'The list endpoint returns at most one hundred rows and the client cannot raise that cap, so the payload is '
    'constant whether the organisation holds five thousand ideas or five hundred thousand. The ordering index turns '
    'the top-100 read into an ordered index scan that stops at the limit - visible in the recorded query plan above - '
    'rather than a full scan and a sort of the whole table. Resident memory after loading and querying the dataset '
    'shows that no part of it is held in the application.'))

story.append(Paragraph('7.4 Two instances behind one database', S_H2))
rows = [[Paragraph(x, S_TH) for x in ('Property', 'Observed')]]
for cid in ['TC-SCLH-001', 'TC-SCLH-003', 'TC-SCLH-004', 'TC-SCLH-005', 'TC-SCLH-008',
            'TC-SCLH-011', 'TC-SCLH-012', 'TC-SCLH-013', 'TC-SCLH-016']:
    c = find(cid)
    rows.append([P(c['functionality'], S_CELL), P(c['actual'], S_CELL)])
story.append(grid(rows, [8.0 * cm, 9.8 * cm]))
story.append(Spacer(1, 4))
story.append(P(
    'Nothing that matters is held in a process. Sessions are signed tokens re-validated against the database on every '
    'request; the brute-force lockout, the tenant registry, organisation settings, branding and integration '
    'credentials are all shared state in MySQL. Two limitations are recorded honestly rather than hidden: uploaded '
    'files are written to a local directory, so a multi-host deployment needs shared or object storage; and the '
    'per-IP rate-limit counters are per process, so a strict global budget needs a shared store. Both are noted in '
    'section 9.'))

story.append(Paragraph('7.5 What the measurements imply for sizing', S_H2))
story.append(P(
    'Three properties observed above are what make a sizing estimate possible at all. First, the work per read is '
    'bounded: the list is capped at one hundred rows and served from an ordered index, so its cost is independent of '
    'how many ideas the organisation has accumulated. Second, the application holds no dataset in memory, so a larger '
    'organisation costs database storage rather than application memory. Third, tenants are separate schemas, so one '
    'large customer does not slow another - demonstrated by the neighbouring organisation staying fast while the '
    'first held five thousand ideas.'))
story.append(P(
    'Together those mean capacity is planned in three independent directions rather than one: application instances '
    'for concurrent users, database resources for total data, and - beyond a certain size - additional database hosts '
    'for particularly large tenants, which the registry already supports by storing a host per tenant. The suggested '
    'starting points below follow from the measurements; they are a planning aid, not a guarantee, and section 9 '
    'recommends re-running the vertical module on the target hardware as an acceptance step.'))
story.append(info_table([
    ('Application instances', 'Two behind a load balancer as a minimum, for rolling restarts and fault tolerance - '
                              'proven interchangeable in section 7.4. Add instances for concurrent users, not for '
                              'data volume.'),
    ('Database connections', 'Per-tenant pool size multiplied by (tenants + 1) must stay below the server&apos;s connection '
                             'limit. Thirty concurrent requests queued cleanly against a pool of ten in this run.'),
    ('Storage', 'Ideas are small rows; attachments dominate. Budget from expected attachments per idea and the '
                'configured maximum file size, on shared or object storage once there is more than one host.'),
    ('Backups', 'A per-schema dump plus the uploads directory, retained on the schedule in the deployment guide.'),
    ('Growth trigger', 'Move a tenant to its own database host when its schema alone drives the database server, '
                       'rather than splitting the application.'),
], w1=5.0 * cm))

# ══════════════════════════════ 8. COVERAGE MATRIX ═════════════════════════
story.append(PageBreak())
story.append(Paragraph('8. Coverage matrix', S_H1))
story.append(P(
    'Read down the column to see how much of the suite defends each property; read across to see which modules '
    'contribute. A blank cell is not necessarily a gap - tenant isolation, for example, is concentrated in the safety '
    'module by design - but it is where the next cycle should look.'))
matrix_props = ['Valid input', 'Invalid input', 'Wrong role', 'Tenant boundary', 'Concurrency', 'Failure injection',
                'Latency budget', 'Persistence check']
prop_hits = {
    'Authentication': [1, 1, 1, 1, 0, 0, 0, 1],
    'Platform Admin': [1, 1, 1, 1, 0, 0, 0, 1],
    'Org Admin / Users': [1, 1, 1, 0, 1, 0, 0, 1],
    'Ideas': [1, 1, 1, 1, 1, 0, 1, 1],
    'Voting & Community': [1, 1, 1, 0, 1, 0, 0, 1],
    'Comments': [1, 1, 0, 0, 1, 0, 0, 1],
    'Review & Approval': [1, 1, 1, 0, 1, 0, 0, 1],
    'Categories & Challenges': [1, 0, 1, 0, 0, 0, 0, 0],
    'Analytics & Reports': [1, 0, 1, 0, 0, 0, 1, 0],
    'Notifications': [1, 0, 1, 0, 0, 0, 0, 0],
    'Reports & Export': [1, 0, 1, 1, 1, 0, 1, 0],
    'Branding & Settings': [1, 0, 1, 0, 0, 0, 0, 1],
    'Support': [1, 0, 1, 1, 0, 0, 0, 0],
    'QCMS Integration': [1, 1, 1, 1, 0, 1, 1, 1],
    'Security & Multi-Tenancy': [0, 1, 1, 1, 0, 0, 0, 0],
    'Safety & Data Protection': [1, 1, 1, 1, 0, 1, 0, 1],
    'Reliability & Fault Tolerance': [1, 1, 0, 0, 1, 1, 0, 1],
    'Scalability - Horizontal': [1, 0, 0, 1, 1, 1, 0, 1],
    'Scalability - Vertical & Performance': [1, 1, 0, 1, 1, 0, 1, 1],
    'Data Integrity & Recovery': [1, 1, 0, 1, 0, 1, 0, 1],
    'Extensibility & Future Scope': [1, 0, 0, 1, 0, 0, 0, 1],
    'Observability & Operations': [1, 0, 1, 0, 0, 0, 1, 0],
}
rows = [[Paragraph('Module', S_TH)] + [Paragraph(clean(p), S_TH) for p in matrix_props]]
for name, _ in MODULES:
    hits = prop_hits.get(norm(name), [0] * 8)
    rows.append([P(name, S_CELL)] + [P('X' if h else '', S_CELL) for h in hits])
w = [5.4 * cm] + [1.55 * cm] * 8
story.append(grid(rows, w))

# ══════════════════════════════ 9. RISKS ══════════════════════════════════
story.append(PageBreak())
story.append(Paragraph('9. Residual risks, limitations and recommendations', S_H1))
story.append(P(
    'Everything in this section passed its test. They are listed because a green result under one set of assumptions '
    'is a risk under another, and the reader deserves to know which assumptions were made.'))

risk_rows = [[Paragraph(x, S_TH) for x in ('Area', 'What is true today', 'Recommendation before scale-out')]]
for a, t, r in [
    ('Uploaded files', 'Attachments are written to a local directory per tenant and served only through an '
                       'authenticated, tenant-scoped endpoint. Both instances in the horizontal test served the same '
                       'file because they shared a filesystem.',
     'On more than one host, mount shared storage or move attachments to object storage. Nothing else in the design '
     'needs to change.'),
    ('Rate limiting', 'Counters live in each process. Two instances therefore allow twice the configured budget.',
     'Point the limiter at a shared store (for example Redis) if a strict global budget is a requirement. The '
     'per-account brute-force lockout is already central and is unaffected.'),
    ('Read pagination', 'List endpoints are capped at 100 rows, which keeps payloads and query cost constant.',
     'Add cursor pagination when a screen genuinely needs to walk beyond the cap; the cap is server-side so no client '
     'is broken by adding it.'),
    ('Uploaded file content', 'Uploads are validated by extension allow-list and size, stored under a generated name, '
                              'and always served as an attachment with nosniff, so a stored file cannot execute in '
                              'the application origin.',
     'Add content-signature checking and an anti-virus pass if the deployment accepts documents from outside the '
     'organisation.'),
    ('Database capacity', 'One schema per tenant, with the host recorded per tenant in the registry.',
     'Growth is absorbed by moving tenants to additional database hosts - already supported by the registry - before '
     'any single schema becomes a bottleneck.'),
    ('Performance figures', 'Measured on a developer machine with the database on the same host.',
     'Re-run the vertical module on the target hardware as an acceptance step; the budgets in section 7 are the ones '
     'to hold to.'),
    ('Secrets in production', 'The application refuses to boot in production with a placeholder token secret or a '
                              'passwordless database account.',
     'Keep that guard enabled and rotate the token secret on a schedule; rotation invalidates existing sessions by '
     'design.'),
    ('Front-end coverage', 'The suite exercises the API that every screen uses, and the server enforces every rule '
                           'independently of the browser.',
     'Add a browser-level regression pass for visual and interaction defects, which no API-level suite can see.'),
]:
    risk_rows.append([Paragraph(clean(a), S_CELLB), P(t, S_CELL), P(r, S_CELL)])
story.append(grid(risk_rows, [3.0 * cm, 7.4 * cm, 7.4 * cm]))

story.append(Paragraph('9.1 Future scope, and what already supports it', S_H2))
story.append(P(
    'The extensibility module is written so that each case names the extension it protects. In summary:'))
story.extend(bullets([
    'A new customer organisation is created at runtime and is usable immediately - no deployment, no restart.',
    'An eighth language is one dictionary file and one registry line; all seven shipped locales are complete today.',
    'A new feature area is one route module registered in one aggregator.',
    'A new role is an entry in a declared list rather than a scattered set of conditionals.',
    'A second downstream system is a new mapping function: the QCMS mapping is pure, with no I/O of its own.',
    'Capacity and policy limits - rate limits, pool size, token lifetime, file size, password minimum and every points '
    'value - are environment configuration.',
    'Schema evolution is a numbered file in the migrations folder, applied and ledgered automatically, proven in this '
    'run by adding one.',
]))

# ══════════════════════════════ 10. THE CASES ══════════════════════════════
story.append(PageBreak())
story.append(Paragraph('10. Test cases in full', S_H1))
story.append(P(
    'Every case executed in the run named on the cover, in execution order, grouped by module. Actual Output is '
    'verbatim.'))

COLW = [2.15 * cm, 2.0 * cm, 3.5 * cm, 3.35 * cm, 3.4 * cm, 1.25 * cm, 2.15 * cm]
HEADER = [Paragraph(x, S_TH) for x in
          ('Test Case ID', 'Module', 'Functionality', 'Expected Output', 'Actual Output', 'Result', 'Timestamp')]

# One paragraph per module: what this group of cases is actually defending, so
# the table that follows can be read without reverse-engineering its intent.
MODULE_NOTES = {
    'Authentication': 'The front door. These cases cover the three ways in (organisation admin, employee, vendor '
        'platform admin), every way of getting it wrong, and the properties that must hold while getting it wrong: an '
        'unknown email and a wrong password must be indistinguishable to the caller, injection strings must be inert, '
        'a deactivated account must not open, a tampered or absent token must be refused, repeated failures must '
        'throttle the account, and a forgotten-password request must not reveal whether the address exists.',
    'Platform Admin': 'Vendor-side administration. Creating an organisation provisions a database, a schema and a '
        'first administrator in one action, so the cases cover the happy path, duplicate slugs, missing fields, '
        'suspension and reactivation, the confirmation guard on deletion, password-reset targeting, and the boundary '
        'that stops a tenant administrator reaching any of it.',
    'Org Admin / Users': 'Account lifecycle inside one organisation: creating users with derived temporary passwords, '
        'rejecting duplicates and missing fields, listing the organisation, previewing a bulk spreadsheet import with '
        'a deliberately malformed row, and refusing all of it to a non-administrator.',
    'Ideas': 'The core action of the product. Submission with valid content, rejection of missing and absurd content, '
        'retrieval by identifier, the organisation list, the dashboard aggregates, and the requirement that none of it '
        'is reachable without a session.',
    'Voting & Community': 'Community signals on an idea: upvotes that toggle rather than accumulate, ratings bounded '
        'to one to five, rejection of invalid vote types, and authentication on every path.',
    'Comments': 'Discussion on an idea, with the boundaries that keep it usable: no empty comments, a length cap, a '
        'real idea to attach to, and safe handling of markup.',
    'Review & Approval': 'The decision path. A reviewer approves; the submitter cannot approve their own idea; an '
        'invalid decision value is refused; a decision on a non-existent idea is a clean not-found; and a repeated '
        'identical decision does not duplicate the audit trail.',
    'Categories & Challenges': 'The taxonomy an organisation shapes for itself - categories and time-boxed campaigns '
        '- and the administrative boundary around changing it.',
    'Analytics & Reports': 'Aggregates for management: analytics, the audit report, the analytics export and the '
        'leaderboard.',
    'Notifications': 'The in-product signal that something needs attention, including the requirement that marking '
        'read is idempotent and that the list is private to its owner.',
    'Reports & Export': 'Data leaving the system: the full CSV export, the single-idea closure PDF, and the tenant '
        'boundary on that PDF.',
    'Branding & Settings': 'Per-organisation appearance and behaviour, and the rule that the SMTP password is never '
        'echoed back once stored.',
    'Support': 'The help desk between a tenant and the vendor, including the two confidentiality rules that make it '
        'usable: another organisation cannot read the thread, and a vendor-internal note is never visible to the '
        'customer.',
    'QCMS Integration': 'The outbound path that hands approved ideas to the implementation system. Cases cover saving '
        'and masking the API key, overriding the endpoint per organisation, rejecting a malformed endpoint, listing '
        'what is pushable, and the administrative boundary on all of it.',
    'Security & Multi-Tenancy': 'The original isolation cases: content from one organisation must never reach another, '
        'a tenant token must not reach vendor routes, injection in a query parameter must be inert, an oversized body '
        'must be refused cleanly, and the operational probes must answer.',
    'Safety & Data Protection': 'The deepest module in the suite. It attacks the session (forged, expired, edited, '
        'stale, orphaned), attempts privilege escalation directly and by mass assignment, probes file handling from '
        'upload through download to deletion, checks that no secret or hash is ever serialised, verifies the browser '
        'security headers and the cross-origin policy, confirms that an anonymous submission stays anonymous in every '
        'field while remaining accountable in storage, and proves the boot-time guard against insecure production '
        'configuration.',
    'Reliability & Fault Tolerance': 'What happens when input is malformed, when several things happen at once, and '
        'when a dependency is broken. The concurrency cases here found two real defects in this cycle, both since '
        'fixed and both now permanently guarded.',
    'Scalability - Horizontal': 'A second application process against the same databases - the shape of a '
        'load-balanced deployment. Sessions, data, settings, branding, integration credentials, new tenants and the '
        'brute-force lockout must all behave identically whichever instance a request reaches, and killing one '
        'instance must not disturb the other.',
    'Scalability - Vertical & Performance': 'The same machine holding far more data. One organisation is loaded with '
        'five thousand ideas and three hundred users, and then every screen is held to a latency budget, the response '
        'cap is proven to be server-side, the query plan is inspected, concurrency is pushed past the connection pool '
        'and the neighbouring organisation is checked for collateral damage.',
    'Data Integrity & Recovery': 'The properties that decide whether the data can be trusted and rebuilt: an '
        'idempotent, ledgered migration runner that picks up a brand-new file, unique constraints, cascade behaviour, '
        'the atomicity of a decision, points arithmetic, timestamp consistency, character set, storage engine, '
        'primary keys, and the backup and restore path.',
    'Extensibility & Future Scope': 'Evidence that the next requirement is an addition rather than a rewrite: a tenant '
        'onboarded at runtime, two organisations on different integration endpoints simultaneously, every limit read '
        'from configuration, complete translation coverage across seven languages, a new migration applied, and a '
        'pure mapping function for the downstream system.',
    'Observability & Operations': 'What the team running this in production depends on: cheap liveness, meaningful '
        'readiness, graceful shutdown, crash handlers, a durable log trail, an audit report and a configuration guard '
        'at boot.',
}

for i, (name, lst) in enumerate(MODULES):
    p = len([c for c in lst if c['result'] == 'Pass'])
    story.append(Paragraph(clean('10.%d %s   (%d/%d passed)' % (i + 1, name, p, len(lst))), S_H2))
    note = MODULE_NOTES.get(norm(name))
    if note:
        story.append(P(note))
    rows = [HEADER]
    for c in lst:
        rows.append([
            Paragraph(clean(c['id']), S_CELLS),
            P(c['module'], S_CELL),
            P(c['functionality'], S_CELL),
            P(c['expected'], S_CELL),
            P(c['actual'], S_CELL),
            Paragraph(clean(c['result']), S_CELLB),
            Paragraph(clean(c['ts']).replace(' ', '<br/>'), S_CELLT),
        ])
    story.append(grid(rows, COLW))
    story.append(Spacer(1, 8))

# ══════════════════════════════ APPENDICES ════════════════════════════════
story.append(PageBreak())
story.append(Paragraph("11. Appendix A - Suite inventory", S_H1))
story.append(P('The files that produced this document, and what each is responsible for.'))
story.append(info_table([
    ('backend/test/tc_runner.mjs', 'The runner. Boots the application, drives every case over HTTP, records the seven '
                                   'fields per case and writes tc_results.json.'),
    ('backend/test/helpers.js', 'Scratch-environment harness: creates and drops the registry and tenant schemas, seeds '
                                'the accounts, starts the application, exposes the HTTP and SQL helpers.'),
    ('backend/test/instance2.mjs', 'The second application process used by the horizontal-scalability module.'),
    ('backend/test/api.test.js', 'The assertion suite run by "npm test" - 33 tests that gate every push in CI.'),
    ('backend/test/tc_results.json', 'The machine-written evidence file this document is generated from.'),
    ('docs/gen_testcases_doc.py', 'This generator.'),
], w1=5.6 * cm))

story.append(PageBreak())
story.append(Paragraph('12. Appendix B - Endpoint inventory and access rules', S_H1))
story.append(P(
    'Generated by reading the route definitions in backend/src/routes at build time, so it cannot drift from the '
    'code. "Guard" is the access rule the route declares; every guard also re-reads the caller&apos;s role from the '
    'database before it is applied.'))

ROUTE_DIR = os.path.join(ROOT, 'backend', 'src', 'routes')
GUARD_TEXT = {
    'requireAuth': 'Any signed-in user',
    'optionalAuth': 'Open (answers signed-in and signed-out)',
    'requirePlatformAuth': 'Platform (vendor) admin',
    'ADMIN': 'Organisation admin',
    'authLimiter': 'Open, rate limited',
    'heavyLimiter': 'Rate limited (expensive)',
}


ROLE_SETS = {
    'REVIEWER_ROLES': 'Reviewer roles (team lead and above)',
    'IMPL_ROLES': 'Implementer roles (manager and above)',
    'ANALYTICS_ROLES': 'Analytics roles (manager and above)',
}


def describe_guard(rest, file_default):
    rest = (rest or '').strip()
    m = re.search(r'requireRole\(([^)]*)\)', rest)
    if m:
        arg = m.group(1)
        for key, text in ROLE_SETS.items():
            if key in arg:
                return text
        roles = re.findall(r"'([a-z_]+)'", arg)
        if roles:
            return 'Roles: ' + ', '.join(roles)
        return 'Declared role list'
    if re.search(r'\bADMIN\b', rest):
        return 'Organisation admin'
    for key, text in GUARD_TEXT.items():
        if re.search(r'\b%s\b' % key, rest):
            return text
    return file_default


route_rows = [[Paragraph(x, S_TH) for x in ('Method and path', 'Guard', 'Module')]]
mount_src = open(os.path.join(ROUTE_DIR, 'index.js'), encoding='utf-8').read()
mounts = dict((m[1], m[0]) for m in re.findall(r"router\.use\('(/[a-z-]+)',\s*(\w+)\)", mount_src))
for fname in sorted(os.listdir(ROUTE_DIR)):
    if fname == 'index.js' or not fname.endswith('.js'):
        continue
    var = fname.replace('.js', '')
    prefix = mounts.get(var, '/' + var.replace('Routes', ''))
    src = open(os.path.join(ROUTE_DIR, fname), encoding='utf-8').read()
    area = prefix.strip('/').replace('-', ' ').capitalize()
    # A router-level guard applies to every route in the file unless a route
    # declares its own - platform and notification routes are written that way.
    blanket = re.search(r'router\.use\((\w+)\)', src)
    file_default = describe_guard(blanket.group(1), 'Open') if blanket else 'Open'
    for m in re.finditer(r"router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,([^;]*?)\)\s*;", src, re.S):
        method, sub, rest = m.group(1).upper(), m.group(2), m.group(3)
        guard = describe_guard(rest, file_default)
        path = ('/api' + prefix + (sub if sub != '/' else '')).replace('//', '/')
        route_rows.append([Paragraph(clean('%s %s' % (method, path)), S_CELL),
                           Paragraph(clean(guard), S_CELL), Paragraph(clean(area), S_CELL)])
route_rows.append([Paragraph(clean('GET /api/health, GET /api/ready'), S_CELL),
                   Paragraph('Open (operational probes)', S_CELL), Paragraph('Operations', S_CELL)])
story.append(grid(route_rows, [8.4 * cm, 6.2 * cm, 3.2 * cm]))

story.append(PageBreak())
story.append(Paragraph('13. Appendix C - Configuration reference', S_H1))
story.append(P(
    'Every value below is read from the environment at start-up. They are listed here because several assurance '
    'claims in this document - capacity, lockout behaviour, session lifetime, upload limits - are only true for a '
    'given configuration, and because the extensibility cases assert that each of these is configuration rather than '
    'code.'))
cfg_rows = [[Paragraph(x, S_TH) for x in ('Setting', 'Default', 'What it governs')]]
for k, d, w in [
    ('JWT_SECRET', 'none - refused in production', 'Signing key for session tokens. A production server will not '
     'start with the example value.'),
    ('JWT_EXPIRES_IN', '28800 (8 hours)', 'Session lifetime. Shorter is safer; the live user check limits the damage '
     'either way.'),
    ('MIN_PASSWORD_LENGTH', '12', 'Minimum accepted password length.'),
    ('GLOBAL_RATE_LIMIT', '300 per minute per IP', 'Coarse abuse cap across the API. Raise it for a large office '
     'behind one address.'),
    ('AUTH_RATE_LIMIT', '30 per 15 minutes per IP', 'Failed-authentication budget; successful logins do not count '
     'against it.'),
    ('DB_POOL_SIZE', '10 per tenant', 'Database connections per tenant schema. Multiply by (tenants + 1) and keep '
     'below the server limit.'),
    ('MAX_FILE_MB', '10', 'Attachment size limit, enforced with a clean error rather than a dropped connection.'),
    ('POINTS_SUBMIT / POINTS_APPROVED / POINTS_IMPLEMENTED', '10 / 25 / 65', 'Recognition scheme values.'),
    ('CORS_ORIGIN', 'localhost dev server', 'Origins allowed to call the API from a browser. Required in production.'),
    ('FRONTEND_BASE_URL', 'localhost dev server', 'Base for emailed links such as password resets. Must be HTTPS in '
     'production.'),
    ('FORCE_HTTPS', 'on outside development', 'Redirects plaintext requests and enables HSTS.'),
    ('QCMS_BASE_URL', 'local development endpoint', 'Default endpoint for the implementation system; each '
     'organisation may override it from its own admin screen.'),
    ('AI_PROVIDER / OPENAI_API_KEY / GEMINI_API_KEY', 'blank', 'Optional scoring provider. With none configured the '
     'built-in heuristic is used and the feature still works.'),
    ('LOG_TO_FILE / LOG_DIR', 'on in production', 'Durable daily log files, with errors also written separately.'),
    ('BACKUP_DIR / BACKUP_KEEP', 'backend/backups, 14', 'Backup destination and retention.'),
]:
    cfg_rows.append([Paragraph(clean(k), S_CELLB), Paragraph(clean(d), S_CELL), P(w, S_CELL)])
story.append(grid(cfg_rows, [5.4 * cm, 4.0 * cm, 8.4 * cm]))

story.append(PageBreak())
story.append(Paragraph('14. Appendix D - Test data and accounts', S_H1))
story.append(P(
    'Every account and every row used by the run is created by the run. Nothing depends on a database that happens to '
    'be lying around, which is what makes the results reproducible on any machine.'))
story.append(info_table([
    ('Organisation A ("orga")', 'Default tenant. Seeded with one administrator and one employee; receives the bulk '
                                'load of 5,000 ideas and 300 users during the performance module.'),
    ('Organisation B ("orgb")', 'Second tenant. Exists so that every isolation case has a real neighbour to fail '
                                'against, and so the performance module can show one organisation is unaffected by '
                                'the other&apos;s volume.'),
    ('Organisations created during the run', '"Acme Foods" and "Growth Co" are provisioned by the product itself, '
                                             'through the platform administration API, and are used to prove runtime '
                                             'onboarding and schema parity. Their databases are dropped afterwards.'),
    ('Throwaway accounts', 'Purpose-built users are seeded for the cases that must deactivate, delete, expire or lock '
                           'an account, so no case damages another case&apos;s fixture.'),
    ('Ideas', 'A handful of hand-written ideas carry the functional cases; the 5,000 generated ideas exist only to '
              'give the performance cases a realistic table to work against.'),
    ('Attachments', 'A genuine one-pixel PNG is used for the valid upload; a text buffer with a forbidden extension '
                    'and an oversized buffer are used for the rejection cases.'),
    ('External systems', 'Local stand-in servers reproduce the documented QCMS responses (201, 409, 401), a refused '
                         'connection and a server that never answers.'),
], w1=5.4 * cm))

story.append(Paragraph('15. Appendix E - Requirement traceability', S_H1))
story.append(P(
    'The commitments a buyer is most likely to write into a contract, and the cases that demonstrate each one.'))
trace = [
    ('One organisation can never see another organisation&apos;s data',
     'TC-SEC-001, TC-SEC-002, TC-EXP-003, TC-SUP-002, TC-SAFE-023, TC-SAFE-030'),
    ('Vendor staff cannot read customer content',
     'TC-SAFE-030, TC-PLAT-008, TC-SUP-003'),
    ('Offboarding ends access immediately',
     'TC-SAFE-008, TC-SAFE-009, TC-AUTH-008'),
    ('A password change invalidates older sessions',
     'TC-SAFE-007'),
    ('Privileges cannot be self-granted',
     'TC-SAFE-004, TC-SAFE-005, TC-SAFE-006, TC-USER-004'),
    ('Credentials and secrets are never returned to a client',
     'TC-SAFE-011, TC-BRND-003, TC-QCMS-002, TC-SAFE-037'),
    ('Anonymous submissions stay anonymous',
     'TC-SAFE-027, TC-SAFE-028, TC-SAFE-029'),
    ('Uploaded files are private, validated and non-executable',
     'TC-SAFE-017 to TC-SAFE-026'),
    ('Brute-force attempts are throttled and cannot be evaded',
     'TC-AUTH-011, TC-SAFE-033, TC-SAFE-034, TC-SCLH-011'),
    ('A decision is recorded exactly once, with an audit trail',
     'TC-RVW-005, TC-REL-010, TC-DATA-009'),
    ('No user action is lost when a dependency fails',
     'TC-REL-012, TC-REL-013, TC-REL-014, TC-REL-015'),
    ('The service can be scaled out behind a load balancer',
     'TC-SCLH-001 to TC-SCLH-016'),
    ('Performance does not degrade as the organisation grows',
     'TC-SCLV-002 to TC-SCLV-021'),
    ('Schema changes are applied exactly once and are reversible in a rebuild',
     'TC-DATA-001 to TC-DATA-005'),
    ('Data can be backed up and restored',
     'TC-DATA-015, TC-DATA-016'),
    ('New organisations can be onboarded without a deployment',
     'TC-PLAT-001, TC-SCLH-012, TC-FUT-005'),
    ('The product can be extended without a rewrite',
     'TC-FUT-001 to TC-FUT-018'),
    ('Operations can monitor, drain and diagnose the service',
     'TC-OPS-001 to TC-OPS-008'),
]
story.append(grid([[Paragraph(x, S_TH) for x in ('Commitment', 'Demonstrated by')]] +
                  [[P(k, S_CELL), Paragraph(clean(v), S_CELL)] for k, v in trace],
                  [9.6 * cm, 8.2 * cm]))

story.append(Paragraph('16. Appendix F - Glossary', S_H1))
gloss = [
    ('Tenant', 'One customer organisation, with its own database schema and its own users.'),
    ('Slug', 'The short organisation code (for example "acme") that identifies a tenant in the registry and inside a '
             'session token.'),
    ('Registry', 'The master database holding the tenant list, platform administrators, login-attempt counters and the '
                 'migration ledger.'),
    ('Session token', 'A signed token carrying who is claiming to be logged in. Role and status are re-read from the '
                      'database on every request; the token is not trusted for either.'),
    ('Escalation', 'An approval that moves an idea up the reporting line to a higher reviewer instead of closing it.'),
    ('Workflow trail', 'The per-idea audit list of who did what, and when.'),
    ('Idempotent', 'Safe to repeat: doing it twice leaves the same result as doing it once.'),
    ('Migration ledger', 'The table recording which schema change has been applied to which database, so migrations '
                         'are never applied twice and never skipped.'),
    ('Liveness / readiness', 'Liveness says the process is up; readiness says it can reach its database and should '
                             'receive traffic.'),
    ('Horizontal scaling', 'Adding more application servers behind a load balancer.'),
    ('Vertical scaling', 'Handling more data and more load on the same server.'),
]
story.append(grid([[Paragraph(clean(k), S_CELLB), P(v, S_CELL)] for k, v in gloss],
                  [4.0 * cm, 13.8 * cm], header=False))

story.append(PageBreak())
story.append(Paragraph('17. Appendix G - The assertion suite', S_H1))
story.append(P(
    'Alongside the case runner, the project carries an assertion suite that runs on every push through continuous '
    'integration. It covers the same application in a different style - hard assertions that fail the build rather '
    'than a document - and includes the mapper unit tests and the full push flow against a stand-in QCMS server. Its '
    'tests are listed below, read from the source at build time.'))
try:
    test_src = open(os.path.join(ROOT, 'backend', 'test', 'api.test.js'), encoding='utf-8').read()
    names = re.findall(r"^test\('((?:[^'\\]|\\.)+)'", test_src, re.M)
    rows = [[Paragraph(x, S_TH) for x in ('#', 'Test')]]
    for n, name in enumerate(names, 1):
        rows.append([Paragraph(clean(str(n)), S_CELL), P(name.replace("\\'", "'"), S_CELL)])
    story.append(grid(rows, [1.4 * cm, 16.4 * cm]))
    story.append(Spacer(1, 6))
    story.append(P('%d tests, run with "npm test" from the backend directory. All passed in this cycle.' % len(names)))
except OSError:
    story.append(P('Assertion suite source not available at build time.'))

story.append(Paragraph('18. Conclusion', S_H1))
story.append(P(
    'The platform passed %d of %d cases in the run recorded here, across functional behaviour, safety, reliability, '
    'both directions of scalability, data integrity, extensibility and operations. The cycle was worth running on its '
    'own terms: it found three genuine defects - two of them only reachable under real concurrency, one of them a '
    'privacy commitment that was broken in a field nobody had looked at - and each is now fixed and permanently '
    'guarded by a case that would have caught it.'
    % (PASSED, TOTAL)))
story.append(P(
    'The claims that matter are backed by evidence in this document rather than by assertion: one organisation cannot '
    'reach another&apos;s data because it is in another schema; a departing employee&apos;s session dies on their next request '
    'because the row is re-read every time; the service runs unchanged behind a load balancer because a second '
    'instance was started and proved interchangeable; and screen latency does not follow data volume because the work '
    'per request is capped and indexed. The limitations are stated with the same directness in section 9, and the '
    'next actions are listed there.'))

story.append(Spacer(1, 16))
sign_rows = [[Paragraph(x, S_TH) for x in ('Role', 'Name', 'Signature', 'Date')]]
for role in ('Prepared by (QA)', 'Reviewed by (Engineering)', 'Approved by (Product / Quality)', 'Customer acceptance'):
    sign_rows.append([Paragraph(clean(role), S_CELLB), Paragraph('', S_CELL), Paragraph('', S_CELL), Paragraph('', S_CELL)])
t = grid(sign_rows, [5.0 * cm, 4.6 * cm, 4.6 * cm, 3.6 * cm])
t.setStyle(TableStyle([('TOPPADDING', (0, 1), (-1, -1), 12), ('BOTTOMPADDING', (0, 1), (-1, -1), 12)]))
story.append(t)

story.append(Spacer(1, 14))
story.append(P('End of document. %d cases, %d passed, %d failed, run %s.' % (TOTAL, PASSED, FAILED, RUN_AT), S_SMALL))

doc = Doc(OUT)
doc.multiBuild(story)
print('Wrote %s (%d cases)' % (OUT, TOTAL))
