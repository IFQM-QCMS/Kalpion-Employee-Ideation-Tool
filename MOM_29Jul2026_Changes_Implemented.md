# Changes made after the meeting of 29 July 2026

IFQM Employee Ideation Tool. Written 7 August 2026.

This is the list of everything that was built following the review meeting,
written for anyone who needs to know what changed without reading code. There
are 45 points. The item-by-item audit against the minutes, including what was
not done and why, is in MOM_29Jul2026_Implementation_Status.md.

Everything below is finished, tested, and running on the live site.


## Businesses can now sign themselves up

1. New registration form for MSMEs

Until now, an organisation could only exist on the platform if somebody at IFQM
created it by hand. There is now a public "Register your organisation" form on
the website. A business fills it in themselves. It is split into three short
steps rather than one long page, because the questions come from three different
places: who you are, what your business is on paper, and where it operates.

2. Only work email addresses are accepted

An application has to come from a company email address. Gmail, Yahoo, Outlook,
Rediffmail and about thirty other personal email providers are turned away, along
with eighteen temporary "throwaway" mail services. The reason is simple: anyone
can make a Gmail address, so it tells us nothing about whether the person really
speaks for the business. It is a filter to keep out mistakes and time-wasters,
not a security guarantee, which is why a human still approves every application.

3. The email is checked as it is typed

The form tells the applicant straight away if their email will not be accepted,
rather than after they have spent five minutes typing in GST numbers. Nobody has
to fill in a long form only to be rejected at the end.

4. The business details we ask for come from their Udyam certificate

Udyam number, PAN, GST number, CIN, type of company, whether they are micro,
small or medium, their NIC activity code, how many staff they have, roughly what
they turn over, what year they started, and their registered address. These are
all things an Indian MSME already has written down on one document, so filling
the form is copying rather than hunting.

5. GST number is optional, on purpose

Smaller businesses that fall below the GST threshold genuinely do not have a GST
number. Refusing their application because of a field they cannot possibly fill
would have been a mistake, not carefulness.

6. We deliberately do not ask for Aadhaar or bank details

The government Udyam registration asks for these. An ideation tool has no use for
them. Collecting them would mean holding sensitive personal and financial data
for no benefit at all, and would make our database worth attacking. So we do not
ask.

7. Nothing is created until IFQM approves it

This is the important safety point. When someone submits the form, nothing
happens except that their application joins a waiting list. No database is
created, no account is made, nothing goes live. Even if somebody submitted a
thousand junk applications, all they would achieve is a long list for someone to
read through.

8. New Registrations screen in the IFQM console

There is a new page in the platform console showing every application, with every
single field the business submitted, grouped the way they entered it. Approving
an application is what actually creates their workspace, so whoever presses that
button can see all the evidence in front of them first. Blank fields are shown as
a dash rather than hidden, because what somebody chose to leave out tells you
something too.

9. Approval creates the workspace and a one-time password

When IFQM approves an application, the system creates the organisation's
database and their first administrator account, and shows a temporary password
once. It is shown only once and cannot be retrieved again, so it has to be
written down or passed on there and then. The new administrator is forced to
change it the first time they sign in.

10. Repeat applications are handled quietly

If a business applies twice, the second application gets exactly the same reply
as the first. We do not tell them "this company already has an account", because
that would let anyone check whether a particular company is a customer of ours
just by trying their email domain.


## Ideas are no longer visible to everybody

11. The full text of an idea was being sent to every employee's browser

This was the most serious thing found. The list of ideas was quietly sending the
complete written-up solution of every idea to everyone who opened the page. Even
though the screen only showed the title, the text was sitting in the browser
where anyone slightly technical could read it.

12. All Ideas now shows a one-line summary only

Colleagues see the first sentence of the solution, with a small padlock and a
note explaining why it is short. The full write-up is not sent at all, so there
is nothing hidden in the page to dig out. The title, category, score and status
stay visible to everyone, so people can still see what is happening.

13. The full write-up is only shown to people who need it

That means the person who wrote it, anyone they credited as a co-suggester, the
reviewers actually handling it, and managers. The reasoning is that the written
solution is the person's actual contribution. Publishing it to the whole company
the moment it is filed lets anybody repeat it as their own before the original
has even been looked at, which punishes exactly the people the scheme is meant to
reward.

14. Each organisation can choose its own rule

An organisation administrator can now pick between three settings: author and
reviewers only, managers only, or everyone. The default is the first. Whatever
they choose, the person who wrote an idea always sees their own.


## Approvals

15. Super Admin is no longer part of the approval chain

Whoever holds the Super Admin login at an organisation is usually somebody in IT.
That is not the person qualified to judge whether a suggestion from the shop
floor is worth doing. They have been taken out of approvals entirely.

16. Plant Head is now the final approver, replacing Executive

The organisation administrator is still able to give a final decision, purely so
an idea can never get stuck with nobody able to close it. But the intended final
authority is now the Plant Head.

17. "Under review by" is shown on the idea

Anyone looking at an idea can now see, in one plain line, whose desk it is
sitting on. Before this, you had to work it out from the history log at the
bottom of the page. Where several people are reviewing together, it names all of
them who have not yet responded.


## Leaderboard

18. Top three are shown on a podium

The first three contributors are now displayed on a proper podium, with the
winner in the middle and standing tallest, a trophy for first place and medals
for second and third, in gold, silver and bronze. Fourth place downwards
continues as a normal list. On a phone it stacks into a single column, because
three narrow columns just squash the names.

19. The leaderboard can be shared

There is a Share button that copies a short text summary of the top five, or
opens the phone's normal share menu. It shares text rather than a link, because
the leaderboard sits behind a login and a link would be useless to anyone outside
the organisation.


## Telling apart "we paused them" and "they went quiet"

20. "Suspended" is now called "On Hold"

The wording has been changed everywhere it appears in the console.

21. Being on hold and being inactive are now two separate things

These used to be shown as one label, and they answer two completely different
questions. On Hold means IFQM deliberately paused that organisation's access.
Inactive means nobody at that organisation has signed in for five days or more.
An organisation can easily be perfectly active and on hold, or fully working but
quiet for a fortnight.

22. Inactive is information only, nothing happens because of it

This is worth being clear about. Nobody is locked out, no email is sent, nothing
is switched off. The label exists so that IFQM notices a customer who has gone
quiet before their renewal comes up, and can pick up the phone.

23. Organisations that never signed in at all are flagged separately

If a workspace was created and nobody ever logged in, that is shown differently
from an organisation that used it and then stopped. Usually it means the handover
went wrong and nobody knows the account exists.


## Submitting an idea

24. Required fields are marked with a red asterisk

The asterisks were there before, but in the same colour and weight as the label
text, so they read as punctuation rather than as an instruction. People were
hitting the error message before noticing which fields were compulsory.

25. Time Required is now a dropdown with three fixed choices

Less than three months, three to six months, or six to twelve months. It used to
be a free text box, which meant no two people wrote it the same way and nothing
could be compared. Reviewers can now tell a quick win from a long project at a
glance.

26. Feasibility is colour-coded

Red, amber and green buttons instead of a dropdown. A dropdown hides the colour
until you open it, which defeats the point of having colour at all.

27. Ideas can be tagged by type

Process Improvement, Quality, Cost and Delivery. QCD is the standard shorthand
in improvement work for Quality, Cost and Delivery. They are four separate tags
rather than one lump, so an idea can be marked for exactly the thing it improves,
and more than one can be picked.

28. Anonymous submission has been removed

The option to submit without your name is gone from the form. Ideas that were
already submitted anonymously stay anonymous. That was a deliberate decision:
those people were promised anonymity when they submitted, and removing the
feature retroactively would have exposed them.


## Tidying up and record keeping

29. Old ideas can be archived

An organisation administrator can archive an idea, which takes it out of the
everyday lists without deleting it. The points already awarded, the full approval
history and any savings recorded against it all stay exactly as they were, and it
can be brought back at any time. This is why it is archiving and not a delete
button.

30. Support tickets can be archived too

Closing a ticket and archiving it are different things. Closing means the
conversation reached an end. Archiving means "stop showing me this". A closed
ticket still belongs in the recent list; an archived one does not.

31. Ideas can be marked for patentability

A separate field records whether an idea might be worth protecting: not assessed,
not patentable, possibly, filing recommended, or filed. It is kept apart from the
approval status on purpose, because an idea can be approved and not patentable,
or turned down on cost grounds and still be worth filing a patent on.


## Finding and exporting things

32. Rejected ideas have their own screen

Rejected was already available as a filter, but a filter is something you have to
think to apply, and nobody browsing their work thinks "let me go and read the
failures". The reason an idea was turned down is one of the most useful things in
the whole system. Having it as a screen means somebody can read through them
before filing something very similar six months later.

33. Ideas can be exported to a spreadsheet

A CSV export button on the All Ideas screen, which exports whatever the current
filters are showing.

34. Ideas can be exported to PDF

The same, as a printable PDF. It uses the browser's own print function, so you
get your normal save dialogue and the app does not have to load extra software
for a button most people never press. Neither export includes the full solution
text, since that is not sent to that screen in the first place.


## IFQM platform console

35. "Active Orgs" wording

Changed as requested.

36. The top corner now says "Superadmin signed in as [name]"

These accounts can reach every customer organisation on the platform, so which
one you are currently signed in as should be stated in words rather than left to
be worked out from a small badge.

37. Ideas Implemented is shown on the main console screen

Following the path organisations, then ideas, then implemented. The figure is
added up from the same per-organisation numbers shown in the table underneath, so
the headline can never disagree with the rows below it.

38. The number of ideas sent to the QCMS tool is shown

Both as an overall total and per organisation. This is the point where an idea
stops being a suggestion and becomes a piece of tracked work, which makes it the
most meaningful business number on the screen.

39. IFQM staff accounts are limited to five

It is a soft limit, as agreed, so it can be raised if there is a genuine need
rather than being fixed in the code. Every one of these accounts can reach every
customer organisation, so the number should stay small and deliberate.

40. Sign-in activity is now recorded and viewable

A new permanent record of who signed in, when, from where, and whether it
succeeded, failed, or resulted in a lockout. There was already a table counting
failed attempts, but it gets wiped every time somebody successfully signs in, so
it could never answer the question "who logged in last week".


## Staff records

41. The bulk import spreadsheet has changed

It now asks for Salutation, First Name, Last Name and Year of Birth, instead of
a single name field and a full date of birth. The temporary first-login password
was only ever built from the birth year, so the day and month were personal
details being collected for no purpose whatsoever. Spreadsheets in the old format
still work, so nobody has to redo one they already have.

42. The user list can be filtered

By role, department, status or manager. The filtering happens on the server, so
the page does not have to load every employee in the organisation to narrow the
list down. That matters for an organisation with a few thousand staff.

43. A person's full reporting line can be looked up

Typing in one person now shows their manager, their manager's manager, and so on
to the top, plus anyone reporting to them. Useful because ideas travel up exactly
that chain for approval, so if somebody is attached to the wrong manager their
ideas go to the wrong reviewer.


## Limits and protection

44. Each organisation now has a request limit

Ten thousand requests in total and two thousand per month, as specified, counted
per organisation rather than per internet connection. That distinction matters: a
whole office sharing one internet connection looks like a single user to the old
method, while an attack from many machines looks like thousands of separate ones.
Both limits can be raised for a particular organisation if they genuinely need
more. If the counting system itself has a problem, requests are allowed through
rather than blocked, because a fault in our measuring should never take a
customer offline.


## Making the app understandable

45. Small "i" buttons now explain technical terms throughout the app

This is the largest single change by reach. The settings in this app are named in
the language of the people who built it: SLA, escalation, threshold, engagement
index, slug, feature flag. Somebody running a forty-person workshop has no reason
to know any of those words, and a setting whose meaning has to be guessed either
gets set wrong or gets left alone.

There are now 58 small "i" buttons next to the technical terms across the app,
covering 43 different concepts. Each one explains, in ordinary English, what the
setting does, what happens if you get it wrong, and gives a real example or
number where that helps. None of them explains a term by using another technical
term.

They open when you hover over them with a mouse, when you tap them on a phone,
and when you reach them with the keyboard. All three matter, because hovering
does not exist on a phone, and the ordinary way of doing tooltips would have been
invisible to every phone user. Clicking one keeps it open so a longer explanation
does not disappear the moment your hand moves.

For example, Review SLA Days and Escalation Days look almost identical and do
quite different things, so they now say so:

Review SLA Days: how many days a reviewer has before the idea is marked overdue.
It is a reminder, not an action. Nothing is reassigned or rejected automatically,
the idea just starts showing as late so someone chases it. Seven days is typical.

Escalation Days: how many days an idea can sit untouched before it moves up to
the next person in the approval chain. This one does move the idea. Set it longer
than the SLA above, or ideas will jump to the next approver before the first one
has run out of time.

The terms covered include: review SLA and escalation, workflow mode, approval
chain, reviewer roles, final approver roles, approval threshold, chain preview,
reporting structure, solution visibility, every feature flag, all the email
server settings, AI score, community score, engagement index, impact level,
feasibility, time required, solution tags, tangible and intangible benefit, ROI,
patentability, draft, archived, review stage, co-suggesters, organisation code,
default organisation, on hold, activity state, API quota, QCMS, staff account
limit, registration queue, Udyam, GSTIN, NIC code, employee ID, bulk import, year
of birth, reporting line, and the QCMS API key.


## Documents produced

Five documents were written alongside the code.

The technical manual, in docs/TECHNICAL_MANUAL.md, is for whoever inherits the
system. It covers how it is put together, the rules that are not obvious and why
each one exists, the data it holds, the ten development phases completed so far,
the roadmap, and a troubleshooting table of the problems that have actually
happened.

The flowchart document, in docs/PROJECT_FLOWCHART.md, contains four diagrams
covering the life of an idea, the registration and approval process, how signing
in works, and who can see what, along with the project timeline.

The hosting comparison, in docs/HOSTING_COMPARISON.md, compares Azure, AWS and
Hostinger. It recommends Azure, but not because of price. The reason is that the
meeting already decided to use Azure for single sign-on, and connecting a
different cloud's login system to Azure is the expensive and awkward part. The
price difference between the three at this size is small enough not to decide it.

That document also raises something that needs doing whichever host is chosen.
Uploaded files are currently stored on the server's own hard disk. That is fine
on a single machine, but the moment there are two machines, or the host replaces
the machine, the files vanish while the records pointing at them survive. Users
would see attachments that no longer open. This is already happening on the free
test hosting.

The implementation status document, MOM_29Jul2026_Implementation_Status.md,
lists all 75 points from the minutes with what state each is in.

This document is the fifth.


## Things deliberately not done

Four things were left alone on purpose rather than through oversight.

The minutes ask for two things that cannot both be true. Point 9.3 says block
free email domains such as Gmail. Point 9.6 says accept a Gmail address and a
mobile number for businesses that do not have their own domain. At present free
email is blocked, which means a sole trader with no company domain cannot
register. This needs a decision rather than a guess.

Disabling right-click and screenshots was asked for. It is worth discussing
before building, because it is got around in seconds using the browser's own
tools, the print function, or simply a phone camera, and mostly it irritates
honest users. The change described in points 11 to 14 above is the one that
actually works, because the text is never sent to the browser at all.

Renaming the idea form fields to "Situation Title" and "Description" was not
done. Those fields map onto columns that already hold real data from real ideas,
so renaming them is a data migration rather than a change of wording, and worth
planning properly.

The test case count is listed as both 285 and 288 in the minutes. Neither matches
the automated test suite, which has 33 tests. The 285 or 288 figure belongs to the
separate manual test case document and needs whoever owns that sheet to confirm
which is right.


## Checks carried out

All 33 automated tests pass. The website builds without errors. The database
changes can be run more than once safely, and were tested against the strict
settings that real database servers use, which is what broke the first attempt at
cloud hosting.

The idea visibility rules were tested against a real database in all three
settings and from the point of view of both an ordinary employee and a manager.
The request limits were tested by making requests and confirming the count went
up and the block kicked in. That testing found two genuine faults before release:
the counter had been placed at a point in the code where it did not yet know
which organisation the request belonged to, so it would have counted nothing at
all; and a caching problem meant the count could lag behind by a minute, letting
an organisation slip past its limit. Both were fixed.

The registration process was tested end to end. Gmail addresses, throwaway
addresses, malformed GST numbers and missing consent are all refused. A proper
company address is accepted. A repeat application is folded into the first. The
approval queue cannot be reached without signing in. Approving an application
creates the workspace correctly, and approving the same one twice is refused.

The information buttons were checked in a real browser: they appear, they open,
and they show the right text.


## One limitation to be aware of

All the new wording is in English only. The app supports Hindi, Kannada, Marathi,
Tamil, Telugu and Malayalam, but those six files had other work in progress in
them and were left untouched. Anything without a translation falls back to
English, so nothing is broken, but users of those languages will see English on
the new screens until the translations are added.
