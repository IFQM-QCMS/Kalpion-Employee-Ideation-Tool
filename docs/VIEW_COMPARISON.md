# All Ideas vs the Idea Board

MOM 29 Jul 2026 §11.3 — "Compare an 'All Ideas' view against an 'Idea
Board'/leaderboard view."

Two screens showing the same underlying ideas, which naturally raises the
question of whether both are needed. The answer is yes, but they were closer
together than they should have been, and comparing them found a bug.

---

## What each is for

**All Ideas** is a working list. It is a table: sortable, filterable by status
and impact, searchable, exportable. It answers "where is everything, and what
needs attention". Its audience is anyone tracking the pipeline — a reviewer
looking for their queue, an admin running a monthly review, a manager checking
their department.

**The Idea Board** is a noticeboard. It is a card wall sorted by votes, recency
or score, and it exists to be browsed rather than searched. It answers "what is
everyone else thinking about, and what do I want to back". Its audience is the
general employee population, most of whom will never open All Ideas.

The distinction is participation versus administration. The board is where
somebody votes on a colleague's idea because it caught their eye; the list is
where somebody goes to find a specific thing.

---

## Side by side

| | All Ideas | Idea Board |
|---|---|---|
| Shape | Table | Cards |
| Default order | Recently updated | Most upvoted |
| Sorting | By column | Votes, recent, score |
| Filters | Status, impact, search, archived | None — sort only |
| Export | CSV and PDF | None |
| Voting | Inline, up/down | Inline, up/down |
| Scope | Role-scoped: employees see their own plus titles, managers see their reports', admins see all | Everything submitted and beyond, minus drafts and archived |
| Can be switched off | No | Yes — `public_board_enabled` |
| Drafts | Never shown | Never shown |
| Archived ideas | Optional filter | Never shown |

---

## What the comparison found

**The board was leaking the full text of every idea.**

The solution-privacy work (§11.4, §13.1) fixed this for All Ideas: the list
endpoint stops sending `proposed_solution` entirely and sends a one-line summary
instead. The board is served by a different module — `votingService` rather than
`ideaService` — and was never brought along. It kept selecting the full
`present_situation` and `proposed_solution` for all 100 cards and shipping them
to every employee.

The screen only ever rendered two clamped lines, which is exactly why nobody
noticed: the text was sitting in the response the whole time, readable by anyone
who opened the browser's network tab. The visual truncation was doing the work
that the server should have been doing.

Fixed. The board now goes through the same redaction, honours the same
organisation setting, and — separately — no longer shows archived ideas, which
it also had no filter for.

This is the concrete value of the comparison the minutes asked for. The two
views looked equivalent on screen and were not equivalent underneath.

---

## Should they be merged?

No. They serve different readers and different questions, and the board is the
one that drives participation — the thing an ideation scheme lives or dies on.
Collapsing it into a filtered table would make the product tidier and the scheme
quieter.

Two things are worth doing instead, neither urgent:

1. **The board has no filters at all.** Sorting by votes is fine for a
   noticeboard, but a large organisation will want at least a department or
   category filter before the wall becomes unusable. It is a card wall of 100
   items today; at 2,000 ideas it is not browsable.

2. **They should stay behind one data path.** This bug happened because two
   screens showing the same rows were served by two modules with two ideas of
   what was safe to send. Whatever is added next — a filter, a field, a new
   card — should go through the same redaction, or the next divergence will be
   found the same way this one was.

---

## Where the leaderboard sits

The leaderboard is not a third view of the same thing and does not belong in
this comparison. It ranks **people**, not ideas: contributors by points, then
departments, with a top-scored-ideas panel as a footnote. Its purpose is
recognition. It shares no query and no privacy question with either screen
above, beyond naming ideas that are already public.
