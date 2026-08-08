#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build "Software Architecture.docx" - the complete architecture and design
document for the IFQM Employee Ideation Tool.

    python docs/gen_architecture_doc.py

House rules, because they were asked for explicitly and are easy to break:

  * Everything is BLACK. Word's built-in Heading styles are blue by default, so
    every style used here has its colour forced to black. No accent colours, no
    shading beyond a light grey for table header rows.
  * No emoji, no icons, no decorative characters.
  * Diagrams are drawn with box characters in a monospace font. They print
    cleanly in black and white, cannot fail to load, and survive being pasted
    into email or another document - none of which is true of images.
  * Plain English. Where a technical term is unavoidable it is explained in the
    sentence that introduces it.

The content is generated from what the code actually does. Where a figure is
quoted (table counts, endpoint counts, test counts) it was read from the
repository, not estimated.
"""
import io
import os
import re
from datetime import date

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# ---------------------------------------------------------------------------
#  Document metadata
# ---------------------------------------------------------------------------
DOC_TITLE = "Software Architecture and Design Document"
PRODUCT = "IFQM Employee Ideation Tool (EIT)"
VERSION = "1.0"
STATUS = "First complete version - for review"
ISSUE_DATE = date.today().strftime("%d %B %Y")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Software Architecture.docx")

BLACK = RGBColor(0, 0, 0)
GREY = RGBColor(0x59, 0x59, 0x59)

BODY_FONT = "Calibri"
MONO_FONT = "Consolas"


# ---------------------------------------------------------------------------
#  Styling helpers
# ---------------------------------------------------------------------------
def setup_styles(doc):
    """Force every style black and set the base fonts."""
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = BLACK
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.12

    sizes = {"Title": 26, "Heading 1": 16, "Heading 2": 13, "Heading 3": 11.5, "Heading 4": 10.5}
    for name, size in sizes.items():
        try:
            st = doc.styles[name]
        except KeyError:
            continue
        st.font.name = BODY_FONT
        st.font.size = Pt(size)
        st.font.color.rgb = BLACK          # Word defaults these to blue
        st.font.bold = True
        st.font.italic = False
        pf = st.paragraph_format
        pf.space_before = Pt(14 if name == "Heading 1" else 10)
        pf.space_after = Pt(5)
        pf.keep_with_next = True

    for name in ("List Bullet", "List Number"):
        try:
            s = doc.styles[name]
            s.font.name = BODY_FONT
            s.font.size = Pt(10.5)
            s.font.color.rgb = BLACK
        except KeyError:
            pass


def blacken_all_styles(doc):
    """
    Strip colour from EVERY style definition in the document.

    Overriding the handful of styles this document uses is not enough. The
    template python-docx ships with defines about forty more - Heading 5 to 9,
    Subtitle, Caption, Intense Quote, the table styles - and every one of them
    carries a blue or red from the default Office theme. Nothing here uses them,
    so the document renders black either way, but the colours are still sitting
    in the file. Anyone who later applies one of those styles, or inspects the
    XML, would find colour in a document that was asked to have none.

    This removes the colour element from all of them, so "everything is black"
    is true of the file and not only of what happens to be on the page.
    """
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    removed = 0
    for style in doc.styles.element:
        for rpr in style.iter(ns + "rPr"):
            for col in list(rpr.findall(ns + "color")):
                val = (col.get(ns + "val") or "").upper()
                if val not in ("000000", "595959", "AUTO"):
                    rpr.remove(col)
                    removed += 1
    return removed


def shade(cell, hex_fill="EDEDED"):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), hex_fill)
    cell._tc.get_or_add_tcPr().append(el)


def h(doc, text, level=1, page_break=False):
    if page_break:
        doc.add_page_break()
    p = doc.add_heading(text, level=level)
    for r in p.runs:
        r.font.color.rgb = BLACK
    return p


def para(doc, text, italic=False, size=10.5, space_after=6, align=None, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = BODY_FONT
    run.font.size = Pt(size)
    run.font.color.rgb = GREY if italic else BLACK
    run.italic = italic
    run.bold = bold
    p.paragraph_format.space_after = Pt(space_after)
    if align:
        p.alignment = align
    return p


def bullets(doc, items, style="List Bullet"):
    for it in items:
        p = doc.add_paragraph(style=style)
        run = p.add_run(it)
        run.font.name = BODY_FONT
        run.font.size = Pt(10.5)
        run.font.color.rgb = BLACK
        p.paragraph_format.space_after = Pt(2)


def figure(doc, number, title, art, note=None, legend=None):
    """A titled monospace diagram with an optional legend and note."""
    cap = doc.add_paragraph()
    r = cap.add_run("%s  %s" % (number, title))
    r.bold = True
    r.font.name = BODY_FONT
    r.font.size = Pt(10)
    r.font.color.rgb = BLACK
    cap.paragraph_format.space_before = Pt(10)
    cap.paragraph_format.space_after = Pt(4)
    cap.paragraph_format.keep_with_next = True

    tbl = doc.add_table(rows=1, cols=1)
    tbl.style = "Table Grid"
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.rows[0].cells[0]
    cell.text = ""
    for i, line in enumerate(art.rstrip("\n").split("\n")):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        run = p.add_run(line)
        run.font.name = MONO_FONT
        run.font.size = Pt(7.6)
        run.font.color.rgb = BLACK
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0

    if legend:
        lp = doc.add_paragraph()
        lr = lp.add_run("Legend:  " + legend)
        lr.font.name = BODY_FONT
        lr.font.size = Pt(8.5)
        lr.font.color.rgb = GREY
        lp.paragraph_format.space_before = Pt(3)
        lp.paragraph_format.space_after = Pt(2)
    if note:
        np = doc.add_paragraph()
        nr = np.add_run(note)
        nr.font.name = BODY_FONT
        nr.font.size = Pt(8.5)
        nr.italic = True
        nr.font.color.rgb = GREY
        np.paragraph_format.space_after = Pt(10)


def table(doc, headers, rows, widths=None, font_size=9, caption=None):
    if caption:
        cp = doc.add_paragraph()
        cr = cp.add_run(caption)
        cr.bold = True
        cr.font.name = BODY_FONT
        cr.font.size = Pt(10)
        cr.font.color.rgb = BLACK
        cp.paragraph_format.space_before = Pt(10)
        cp.paragraph_format.space_after = Pt(4)
        cp.paragraph_format.keep_with_next = True

    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, htxt in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        r = p.add_run(htxt)
        r.bold = True
        r.font.name = BODY_FONT
        r.font.size = Pt(font_size)
        r.font.color.rgb = BLACK
        p.paragraph_format.space_after = Pt(1)
        shade(c)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            r = p.add_run(str(val))
            r.font.name = BODY_FONT
            r.font.size = Pt(font_size)
            r.font.color.rgb = BLACK
            p.paragraph_format.space_after = Pt(1)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def add_page_numbers(doc):
    """Page N in the footer of every section."""
    for section in doc.sections:
        p = section.footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run()
        run.font.name = BODY_FONT
        run.font.size = Pt(8.5)
        run.font.color.rgb = GREY
        for txt in ("Page ", None, " of ", None):
            if txt:
                r = p.add_run(txt)
                r.font.size = Pt(8.5)
                r.font.color.rgb = GREY
                r.font.name = BODY_FONT
            else:
                fld = OxmlElement("w:fldSimple")
                fld.set(qn("w:instr"), "PAGE" if txt is None and " of " not in p.text else "NUMPAGES")
                p._p.append(fld)


def footer_text(doc, text):
    for section in doc.sections:
        p = section.footer.paragraphs[0]
        p.text = ""
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text)
        r.font.name = BODY_FONT
        r.font.size = Pt(8)
        r.font.color.rgb = GREY


# ---------------------------------------------------------------------------
#  Front matter
# ---------------------------------------------------------------------------
def front_matter(doc):
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(DOC_TITLE)
    r.font.name = BODY_FONT
    r.font.size = Pt(24)
    r.bold = True
    r.font.color.rgb = BLACK
    t.paragraph_format.space_before = Pt(120)
    t.paragraph_format.space_after = Pt(6)

    s = doc.add_paragraph()
    s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = s.add_run(PRODUCT)
    r.font.name = BODY_FONT
    r.font.size = Pt(14)
    r.font.color.rgb = BLACK
    s.paragraph_format.space_after = Pt(40)

    table(doc, ["Field", "Detail"], [
        ["Document title", DOC_TITLE],
        ["Product", PRODUCT],
        ["Version", VERSION],
        ["Status", STATUS],
        ["Date of issue", ISSUE_DATE],
        ["Prepared by", "Development team"],
        ["Reviewed by", "(pending)"],
        ["Approved by", "(pending)"],
        ["Classification", "Internal - for IFQM and project stakeholders"],
    ], widths=[1.9, 4.3], font_size=10)

    doc.add_paragraph().paragraph_format.space_after = Pt(14)

    table(doc, ["Version", "Date", "Author", "Summary of change"], [
        ["1.0", ISSUE_DATE, "Development team",
         "First complete version. Covers all 25 requested deliverables and "
         "describes the system as built."],
    ], widths=[0.8, 1.2, 1.4, 3.0], font_size=9)

    doc.add_page_break()

    h(doc, "How to read this document", 1)
    para(doc, "This document describes how the IFQM Employee Ideation Tool is built. It is "
              "written for a mixed audience, so it avoids jargon wherever it can and explains "
              "it where it cannot. If you only need the shape of the system, sections 1 to 6 "
              "are enough. If you are going to work on it, read the whole thing.")

    h(doc, "The way it is organised", 2)
    table(doc, ["Part", "What it covers", "Who it is mainly for"], [
        ["A", "Overview and requirements (sections 1-2)", "Everybody"],
        ["B", "Architecture diagrams (sections 3-6) - what the system is made of and where each part runs",
         "Anyone reviewing the design"],
        ["C", "Detailed design diagrams (sections 7-14) - how it behaves, step by step",
         "Developers and testers"],
        ["D", "Running it (sections 15-23) - deployment, security, failure, monitoring, testing, release",
         "Operations and QA"],
        ["E", "Decisions and traceability (sections 24-25)", "Reviewers and auditors"],
    ], widths=[0.5, 4.2, 1.6], font_size=9)

    para(doc, "Parts B and C are kept apart deliberately, because they answer different "
              "questions. An architecture diagram shows the pieces and how they are arranged. "
              "A design diagram shows what actually happens when somebody presses a button. "
              "Mixing the two is the usual reason architecture documents become unreadable.")

    h(doc, "Conventions used in the diagrams", 2)
    bullets(doc, [
        "Diagrams are drawn with text and lines rather than pictures. They print in black "
        "and white, cannot fail to load, and can be pasted into an email without turning "
        "into a broken image.",
        "A solid box is something that exists. A solid arrow is something that happens now.",
        "Anything marked optional works only if that organisation has configured it. The "
        "product runs without any of them.",
        "Where a number is quoted - tables, endpoints, tests - it was counted from the code, "
        "not estimated.",
    ])

    h(doc, "Assumptions this document rests on", 2)
    table(doc, ["#", "Assumption", "If it turns out to be wrong"], [
        ["A1", "Customers are small and medium businesses, mostly manufacturing, of roughly "
               "20 to 500 staff.",
         "Scale figures in section 20 would need revisiting, though nothing structural changes."],
        ["A2", "Each customer wants their data kept physically separate from other customers.",
         "The separate-database design could be simplified, but this is a common condition of sale."],
        ["A3", "Ideas are typed by people. There is no bulk import of ideas and no machine feed.",
         "The submission path would need a different entry point."],
        ["A4", "Traffic is bursty and modest - busy at the start of a campaign, quiet between.",
         "Sustained heavy traffic would need the caching described in section 20."],
        ["A5", "IFQM operates the platform and holds the customer relationship.",
         "The platform console assumes exactly this separation."],
        ["A6", "Email and SMS are optional per customer. Many will run without either.",
         "Nothing breaks; the features they power simply stay off."],
        ["A7", "Idea text is commercially sensitive to the customer.",
         "The visibility rules in section 16 could be relaxed, and are already a setting."],
    ], widths=[0.4, 3.1, 2.8], font_size=9)

    h(doc, "What this document does not cover", 2)
    bullets(doc, [
        "Commercial terms, pricing and billing. Billing is recorded in the meeting minutes as "
        "future scope and has not been designed.",
        "Single sign-on with the QCMS, DWM and Skills tools. Agreed in principle, blocked on "
        "an Azure tenant that does not exist yet. See ADR-011.",
        "The manual test case catalogue, which is a separate document.",
    ])


# ---------------------------------------------------------------------------
#  Table of contents
# ---------------------------------------------------------------------------
def contents(doc):
    doc.add_page_break()
    h(doc, "Contents", 1)
    para(doc, "Word can generate a live table of contents with page numbers: place the cursor "
              "here and use References, then Table of Contents. The list below is the section "
              "order.", italic=True)

    rows = [
        ["Part A", "Overview and requirements", ""],
        ["", "1", "System Overview and Objectives"],
        ["", "2", "Functional and Non-Functional Requirements"],
        ["Part B", "Architecture diagrams", ""],
        ["", "3", "Overall System Architecture"],
        ["", "4", "Architecture Description"],
        ["", "5", "Technology Stack"],
        ["", "6", "Module and Component Structure"],
        ["Part C", "Detailed design diagrams", ""],
        ["", "7", "System Workflow"],
        ["", "8", "Data Flow"],
        ["", "9", "Database Design"],
        ["", "10", "API Architecture and Specification"],
        ["", "11", "Use Cases"],
        ["", "12", "Sequence Diagrams"],
        ["", "13", "Class and Module Structure"],
        ["", "14", "User Interface and Screen Flow"],
        ["Part D", "Running the system", ""],
        ["", "15", "Deployment Architecture"],
        ["", "16", "Security Architecture"],
        ["", "17", "Integration Architecture"],
        ["", "18", "Error Handling and Exception Flow"],
        ["", "19", "Logging and Monitoring"],
        ["", "20", "Performance and Scalability"],
        ["", "21", "Backup and Disaster Recovery"],
        ["", "22", "Testing Strategy"],
        ["", "23", "Deployment and Release Plan"],
        ["Part E", "Decisions and traceability", ""],
        ["", "24", "Architecture Decision Records"],
        ["", "25", "Requirements Traceability Matrix"],
    ]
    table(doc, ["Part", "No.", "Section"], rows, widths=[0.8, 0.5, 4.9], font_size=9)

    h(doc, "List of figures", 2)
    para(doc, "Architecture figures are numbered A-n and describe structure. Design figures are "
              "numbered D-n and describe behaviour.")
    table(doc, ["Figure", "Title", "Section"], [
        ["A-1", "System context", "3.1"],
        ["A-2", "Containers - what runs where", "3.2"],
        ["A-3", "Technology stack", "5"],
        ["A-4", "Modules and their dependencies", "6"],
        ["A-5", "Deployment", "15"],
        ["A-6", "Security layers", "16"],
        ["A-7", "Integrations", "17"],
        ["D-1", "Idea lifecycle", "7"],
        ["D-2", "Data flow, level 0", "8"],
        ["D-3", "Data flow, level 1", "8"],
        ["D-4", "Registry tables and relationships", "9.1"],
        ["D-5", "Per-organisation tables and relationships", "9.2"],
        ["D-6", "Use case overview", "11"],
        ["D-7", "Sign in with a password", "12.1"],
        ["D-8", "Submit an idea", "12.2"],
        ["D-9", "A decision, and what happens when nobody decides", "12.3"],
        ["D-10", "MSME registration and approval", "12.4"],
        ["D-11", "Push an approved idea to QCMS", "12.5"],
        ["D-12", "Service modules and their operations", "13"],
        ["D-13", "Screen flow", "14"],
        ["D-14", "Wireframes of the main screens", "14"],
        ["D-15", "How a failure is handled", "18"],
    ], widths=[0.7, 4.2, 0.8], font_size=9)


# ---------------------------------------------------------------------------
#  Assemble
# ---------------------------------------------------------------------------
def main():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import arch_sections_a, arch_sections_b, arch_sections_c
    import arch_sections_d, arch_sections_e

    doc = Document()
    setup_styles(doc)
    stripped = blacken_all_styles(doc)

    for section in doc.sections:
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.7)

    front_matter(doc)
    contents(doc)

    api = (h, para, bullets, table, figure, None)
    for mod in (arch_sections_a, arch_sections_b, arch_sections_c,
                arch_sections_d, arch_sections_e):
        mod.build(doc, *api)

    footer_text(doc, "%s  |  %s  |  Version %s  |  %s" % (PRODUCT, DOC_TITLE, VERSION, ISSUE_DATE))

    core = doc.core_properties
    core.title = DOC_TITLE
    core.subject = PRODUCT
    core.author = "Development team"
    core.comments = STATUS

    out = os.path.abspath(OUT)
    doc.save(out)

    paras = len(doc.paragraphs)
    tables = len(doc.tables)
    print("Written: %s" % out)
    print("  paragraphs : %d" % paras)
    print("  tables     : %d  (22 of these are diagrams)" % tables)
    print("  colour removed from %d unused style definitions" % stripped)


if __name__ == "__main__":
    main()
