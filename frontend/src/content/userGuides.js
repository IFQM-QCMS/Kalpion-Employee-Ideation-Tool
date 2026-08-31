/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  The user manuals, as data.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These were three PDFs behind a download button. A download is a bad way to
 * ship a manual for this product: it leaves the app, it cannot be searched from
 * inside the app, it is a second thing to keep in step with the software, and
 * on a shop-floor phone — which is most of this audience — opening a PDF is a
 * chore that ends with pinch-zooming a page laid out for A4.
 *
 * So the same content lives here and renders as a page. The wording is the
 * PDFs' own, section for section.
 *
 * ── Where this deliberately differs from the PDF ──────────────────────────
 *
 * A manual that describes a screen the reader is not looking at is worse than
 * no manual, so where the product has moved since the PDFs were written, this
 * follows the product. Everything else is the PDFs' own wording.
 *
 * What differs, and why:
 *
 *   Date of birth / password rule   the field is gone and the formula is now
 *                                   username + phone (MOM 24/08 §6).
 *   Approval Path                   was "Escalation preview"; the "only for
 *                                   large companies" note is gone (§9).
 *   Ideas Sent to QC                one name for what was "forwarded" and
 *                                   "pushed" (§11).
 *   Leaderboard                     gained a PDF export and forwarding to HR
 *                                   (§1, §8), so both are described.
 *   User Guide                      this page exists, so it is in the menus it
 *                                   lists.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 *   { id, title, blocks: [...] }
 *
 *   { p: '...' }                      a paragraph
 *   { note: '...' }                   the PDF's boxed asides
 *   { steps: ['...'] }                a numbered list
 *   { bullets: [...] }                a bulleted list; an item may be
 *                                     { term, text } for the PDF's lead-in bold
 *   { table: { head: [...], rows: [[...]] } }
 *
 * Bold in the PDF is written as **like this** and rendered as <strong>. It is
 * the only inline markup used, deliberately — this is a manual, not a CMS, and
 * a second syntax would be a parser to maintain.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Employee
// ─────────────────────────────────────────────────────────────────────────────

const EMPLOYEE = {
  role: 'employee',
  title: 'User Manual — Employees',
  subtitle: 'Kalpion',
  sections: [
    {
      id: 'signing-in',
      title: '1. Signing In',
      blocks: [
        { p: "Go to your organisation's Kalpion web address. On the Sign In screen:" },
        {
          steps: [
            'Type your **Username**, **Email**, or **Phone number** — any one of the three works.',
            'Type your **Password**.',
            'Click **Sign In**.',
          ],
        },
        {
          p: 'First time signing in? Your admin gave you a temporary password — either emailed to you, '
            + 'or handed to you directly if your account has no email address. After you sign in with it, '
            + "you'll immediately be asked to **Choose a new password**:",
        },
        {
          steps: [
            'Enter the temporary password you just used.',
            'Enter a **New password** (at least 12 characters).',
            'Enter it again to **Confirm**.',
            'Click **Set my password**.',
          ],
        },
        { p: 'You cannot use any other part of the app until this is done.' },
        {
          p: 'Forgot your password? Click **Forgot your password?** on the Sign In screen, enter your '
            + 'registered email, and click **Send reset link**. Check your email for a link — it works for one hour.',
        },
        {
          note: 'Once you\'re past your first sign-in, there is no "change password" button anywhere in the app. '
            + 'If you ever forget your password again later, use **Forgot your password?** on the Sign In screen — '
            + 'that is the only way.',
        },
        {
          p: "Signing in with a code instead of a password: if your organisation has this turned on, you'll see a "
            + 'link **"Sign in with a code instead"**. Click it, enter your phone number, click **Send me a code**, '
            + 'then enter the 6-digit code sent to your phone and click **Verify and sign in**.',
        },
      ],
    },
    {
      id: 'getting-around',
      title: '2. Finding Your Way Around',
      blocks: [
        { p: "Once signed in, you'll see:" },
        {
          bullets: [
            { term: 'Left sidebar', text: 'your main menu: Dashboard, My Ideas, Submit Idea, Challenges, All Ideas, Rejected Ideas, Idea Board, Leaderboard, User Guide, Help, Support, My Profile.' },
            { term: 'Top bar', text: 'a menu icon to hide/show the sidebar, a Dark/Light switch, a language picker (7 languages available), a notification bell, your name and photo (click it to go to your profile), and a Logout button.' },
            { term: 'Notifications', text: 'click the bell icon any time to see updates on your ideas. Click any notification to jump straight to that idea.' },
          ],
        },
      ],
    },
    {
      id: 'submitting',
      title: '3. Submitting a New Idea',
      blocks: [
        { p: "Click **Submit Idea** in the sidebar. You'll go through 6 short steps:" },
        {
          steps: [
            '**Situation** — give your idea a short title and describe the current problem (at least 20 characters). If a similar idea already exists, you\'ll see a warning — worth a quick look before continuing.',
            '**Solution** — describe your proposed solution, optionally note the expected benefits, pick one or more categories, and choose an impact level (Low/Medium/High/Critical).',
            '**Business Case** (all optional) — if you know them, add estimated cost, feasibility, time to implement, and what support you\'d need. You can skip this step entirely if you don\'t have this information yet.',
            '**Attachments** (optional) — attach any supporting files (PDF, Word, Excel, or images).',
            '**Co-Suggesters** (optional) — search for and add any colleagues who helped come up with the idea.',
            '**Review & Submit** — check everything, tick the box if you think the idea might be worth patenting, then click either **Submit New Idea** to send it for review, or **Save Draft** to keep working on it later (drafts are private — only you can see them).',
          ],
        },
        { p: 'Use **Back** and **Next** to move between steps.' },
      ],
    },
    {
      id: 'tracking',
      title: '4. Tracking Your Ideas',
      blocks: [
        { p: "Click **My Ideas** to see everything you've submitted, including drafts. Each idea shows its status:" },
        {
          table: {
            head: ['Status', 'Meaning'],
            rows: [
              ['Draft', 'Saved but not yet submitted'],
              ['Submitted / Under Review', 'Being reviewed by your manager or reviewer'],
              ['Approved', 'Accepted'],
              ['Implemented', 'Approved and now put into practice'],
              ['Rejected', "Not accepted — click View to see the reviewer's reason"],
            ],
          },
        },
        {
          p: 'Click **View** on any idea to see full details, including its review timeline, any attachments, '
            + 'and its AI-generated quality score.',
        },
        { p: "Ideas you don't have to act on can also be found in:" },
        {
          bullets: [
            { term: 'All Ideas', text: 'every idea submitted across your organisation (you may see a shortened summary for ideas outside your own team, depending on your organisation\'s privacy settings).' },
            { term: 'Rejected Ideas', text: "a filtered list of everything that wasn't accepted, useful to check before submitting a similar idea." },
          ],
        },
      ],
    },
    {
      id: 'board',
      title: '5. The Idea Board and Voting',
      blocks: [
        {
          p: 'Click **Idea Board** to see ideas laid out for everyone to browse and vote on. Use the up and down '
            + "arrows to upvote or downvote an idea (you can't vote on your own). You can also give a 1–5 star "
            + "rating from inside an idea's details.",
        },
      ],
    },
    {
      id: 'challenges',
      title: '6. Challenges',
      blocks: [
        {
          p: 'Click **Challenges** to see any active campaigns your organisation has set up asking for ideas on a '
            + 'specific topic. Click **Submit Idea for This Challenge** on an active challenge to jump straight into '
            + 'the submission wizard, linked to that challenge.',
        },
      ],
    },
    {
      id: 'leaderboard',
      title: '7. Leaderboard',
      blocks: [
        {
          p: 'Click **Leaderboard** to see how you and your colleagues rank by points earned from submitting and '
            + 'having ideas approved. You can filter by All Time, Monthly, Quarterly, or Yearly, and share your rank '
            + 'or the top 5 using the share buttons at the top.',
        },
        {
          p: '**Download PDF** saves the whole ranking for the period you are looking at as a document, with your '
            + 'organisation\'s name and the date on it.',
        },
      ],
    },
    {
      id: 'help',
      title: '8. Getting Help',
      blocks: [
        {
          bullets: [
            { term: 'User Guide', text: 'this page — the full manual for your role, always current with the app you are using.' },
            { term: 'Help', text: 'a searchable list of frequently asked questions.' },
            { term: 'Support', text: 'click **+ Raise a Ticket** to send a question or problem directly to the IFQM support team. Fill in a subject, category, priority, and your message, then click Send. You\'ll get a ticket number and can track replies and add follow-up messages from the same page.' },
          ],
        },
      ],
    },
    {
      id: 'profile',
      title: '9. Your Profile',
      blocks: [
        {
          p: 'Click **My Profile** (or your name in the top bar) to view your details. Click **Edit details** to '
            + 'update your Department, Business Unit, or Location.',
        },
        {
          p: 'To change your registered phone number, click **Change** next to the Phone field, enter the new number, '
            + 'click **Send code**, then enter the code you receive and click **Confirm**.',
        },
        { p: "Your Email, Reporting To, and Role are set by your organisation's admin and cannot be changed here." },
      ],
    },
    {
      id: 'signing-out',
      title: '10. Signing Out',
      blocks: [{ p: 'Click **Logout** in the top bar, from anywhere in the app.' }],
    },
    {
      id: 'quick-reference',
      title: 'Quick Reference',
      blocks: [
        {
          table: {
            head: ['I want to...', 'Go to'],
            rows: [
              ['Submit a new idea', 'Submit Idea'],
              ['Check the status of my idea', 'My Ideas'],
              ['See why an idea was rejected', 'Rejected Ideas → View'],
              ["Vote on a colleague's idea", 'Idea Board'],
              ["See who's leading the rankings", 'Leaderboard'],
              ['Save the rankings as a PDF', 'Leaderboard → Download PDF'],
              ['Ask IFQM for help', 'Support → + Raise a Ticket'],
              ['Update my contact details', 'My Profile'],
              ['Change my forgotten password', 'Sign Out → Forgot your password?'],
            ],
          },
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Organisation Admin
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ADMIN = {
  role: 'admin',
  title: 'User Manual — Organisation Admin',
  subtitle: 'Kalpion',
  sections: [
    {
      id: 'signing-in',
      title: '1. Signing In',
      blocks: [
        {
          p: "Go to your organisation's Kalpion web address and sign in with your **Username**, **Email**, or "
            + '**Phone**, plus your password, then click **Sign In**.',
        },
        {
          p: "If your account was just created for you, you'll be asked to set a permanent password the first time "
            + 'you sign in — enter the temporary one you were given, then choose and confirm a new one.',
        },
        {
          p: 'Forgot your password? Use the **Forgot your password?** link on the Sign In screen — it emails you a '
            + 'reset link valid for one hour.',
        },
        {
          note: 'There is no "change password" option anywhere else in the app once you\'re past your first sign-in. '
            + "If you forget your password later, the Sign In screen's reset link is the only way back in.",
        },
      ],
    },
    {
      id: 'getting-around',
      title: '2. Finding Your Way Around',
      blocks: [
        {
          p: 'The sidebar and top bar work the same as they do for every employee (Dashboard, notifications, dark '
            + 'mode, language, logout). As an admin, you additionally see:',
        },
        {
          bullets: [
            { term: 'An Admin Panel section in the sidebar', text: 'this is your main workspace, covered below.' },
            { term: 'A Billing page', text: "for your organisation's own subscription." },
          ],
        },
      ],
    },
    {
      id: 'dashboard',
      title: '3. Dashboard',
      blocks: [
        {
          p: "Your landing page after signing in. It shows your organisation's overall idea pipeline: totals, how "
            + 'many are under review, approved, and implemented, plus a status chart and a recent activity feed. '
            + 'This page is for viewing only — nothing to configure here.',
        },
      ],
    },
    {
      id: 'employees',
      title: '4. Managing Employees',
      blocks: [
        { p: 'Go to **Admin Panel → User List**.' },
        { p: 'To add one employee:' },
        {
          steps: [
            'Click **+ Add User**.',
            'Fill in **Full Name**, **Employee ID**, **Phone** (required — used to send codes), and either a **Username** or **Email** (at least one is needed to sign in).',
            'Choose their **Role**, **Manager**, **Department**, **Business Unit**, and **Location**. The role list '
            + 'includes every stage your approval path can use — Team Lead, Project Lead, Manager, Department Manager, '
            + 'Senior Manager, Plant Head and Executive — so make sure somebody actually holds each role your chain relies on.',
            'Click **Save User**.',
          ],
        },
        {
          p: 'What happens next depends on whether you gave them an email address, and the form tells you which '
            + 'before you save:',
        },
        {
          bullets: [
            { term: 'With an email address', text: 'a temporary password is generated and emailed to them directly. You never see it and have nothing to pass on — just tell them to check their inbox.' },
            { term: 'Without an email address', text: 'the temporary password is the first 4 letters of their name plus the last 4 digits of their phone number — "Yashas" on 7975495881 becomes yash5881. Anything that is not a letter is skipped, so "R. Kumar" gives rkum. It is shown to you once, on screen, because you have to pass it on yourself (in person, by phone, or however your organisation shares this kind of information — avoid sending it in an unprotected email).' },
          ],
        },
        {
          note: 'A password built from a username and a phone number can be worked out by any colleague who knows both. '
            + 'It only lasts until the employee signs in — they are forced to replace it before they can use '
            + 'anything else — but ask them to do that promptly.',
        },
        {
          note: 'You cannot create another Admin account yourself — only IFQM\'s built-in super-admin account can '
            + 'promote someone to Admin.',
        },
        { p: 'To add many employees at once:' },
        {
          steps: [
            'Click **Bulk Import**.',
            'Click **Download Excel template**, fill it in (one row per employee), and save it.',
            'Upload the filled sheet. The system checks it first without creating anything yet, and shows you how many rows will be created vs. skipped (with reasons for anything skipped).',
            'Click **Create {n} employees** to finish. This runs in the background — you can close the window and it will keep going. Existing employees are never changed by an import, only new ones are added.',
          ],
        },
        {
          p: 'The preview table shows the temporary password for every row without an email address, and says '
            + '"Emailed to them" for every row that has one. Rows with an address are emailed automatically when '
            + 'the import finishes.',
        },
        {
          note: 'The template no longer has a date-of-birth column. If you are still using an older sheet that has '
            + 'one, you do not need to delete it — the column is simply ignored.',
        },
        {
          p: "To edit or remove someone: find them in the User List and click **Edit** or **Remove**. If they've "
            + "never submitted an idea, removing deletes their account outright; if they have, they're deactivated "
            + 'instead so their history is kept.',
        },
      ],
    },
    {
      id: 'workflow',
      title: '5. Setting Up the Approval Workflow',
      blocks: [
        {
          p: "Go to **Admin Panel → Hierarchy**. This controls the order an idea moves through before it's approved "
            + 'or rejected, for your whole organisation.',
        },
        {
          bullets: [
            { term: 'The first step, Originator', text: "is fixed and can't be removed — it represents whoever submitted the idea." },
            { term: 'Use + Add a stage', text: 'to add an approval step (Immediate Manager, Team Lead, Project Lead, Department Manager, Senior Manager, Plant Head, Executive), and the up/down arrows to reorder them.' },
            { term: 'The last stage in your list', text: 'makes the final decision.' },
            { term: 'Click Save Workflow', text: "when you're happy with it, or **Reset to Platform Defaults** to go back to the standard chain." },
            { term: 'Approval Path', text: 'below the list, reads the chain back to you as a single line — the order an idea will actually travel. If it does not say what you expected, the list above is wrong.' },
          ],
        },
        {
          note: 'Only the roles in this list can approve or reject anything. A role you leave out has no say in the '
            + 'process — if your chain starts at Department Manager, a Team Lead will not see ideas in their review '
            + 'queue and will be refused if they try to act on one.',
        },
        { p: 'The same screen also has:' },
        {
          bullets: [
            { term: 'Who reports to whom', text: 'a quick lookup: type a name to see their full manager chain.' },
            { term: 'Reporting Structure', text: "your organisation's chart. Click a person's manager name to reassign them to someone else; it saves immediately. The system won't let you create a reporting loop." },
          ],
        },
      ],
    },
    {
      id: 'categories',
      title: '6. Idea Categories',
      blocks: [
        {
          p: 'Go to **Admin Panel → Categories**. Type a name and click **+ Add Category** to create a new one; '
            + 'click **Remove** next to any category to delete it (you must always keep at least one). Removing a '
            + "category doesn't affect ideas that already used it.",
        },
      ],
    },
    {
      id: 'settings',
      title: '7. Organisation Settings & Branding',
      blocks: [
        { p: 'Go to **Admin Panel → System**. This is where you control organisation-wide behaviour:' },
        {
          bullets: [
            { term: 'Review SLA Days / Escalation Days', text: 'how long a reviewer has before an idea is flagged as overdue.' },
            { term: 'Who can read the full solution / AI assessment', text: "control how much of an idea's content is visible to colleagues outside the review chain." },
            { term: "What colleagues can read on someone else's idea", text: 'tick which sections (Problem, Solution, Benefits, Attachments, etc.) are visible more broadly.' },
            { term: 'Largest attachment size and Problem preview length', text: '' },
            { term: 'Protect ideas on screen and Discourage copying of idea text', text: 'both on by default; these deter casual screenshotting/copying (they cannot stop someone taking a photo of their screen).' },
            { term: 'Feature Flags', text: 'turn Anonymous Submissions, the Public Idea Board, Challenges, or Email Notifications on or off for your organisation.' },
          ],
        },
        { p: 'Click **Save Settings** when done.' },
        { p: 'Separately on the same tab:' },
        {
          bullets: [
            { term: 'Organization Branding', text: "set your organisation's display name and upload a logo (PNG only, up to 1MB). This is what your employees see across the app in place of the default IFQM branding." },
            { term: 'Rescore All Ideas', text: 're-runs the AI quality scoring across every idea in your organisation, useful after changing scoring-related settings.' },
          ],
        },
      ],
    },
    {
      id: 'reviewing',
      title: "8. Reviewing Ideas — What You Can and Can't Do",
      blocks: [
        {
          p: '**Important:** as an organisation admin, you are **not** allowed to approve, reject, or decide on '
            + 'ideas yourself. This is by design, to keep review decisions independent of administration. '
            + "You'll see a banner reminding you of this on the Review Queue screen.",
        },
        {
          bullets: [
            { term: 'Go to Review Queue', text: 'to look at what\'s pending — use the **View** button only.' },
            { term: 'Go to All Ideas', text: 'to browse, search, and export every idea in your organisation (Export CSV or Export PDF), or to archive old ideas in bulk (Bulk Archive).' },
            { term: 'Go to Admin Panel → Approved Ideas', text: "to send approved ideas to IFQM's external quality system (QCMS), if your organisation uses one. Ideas that have gone across are counted on the Analytics page as **Ideas Sent to QC**. Click **Push all to QCMS**, or push individual ideas with the Push button per row. Set up the connection first under **Admin Panel → API & Integration** (enable it, paste your QCMS API key, and click Save)." },
          ],
        },
      ],
    },
    {
      id: 'leaderboard',
      title: '9. Leaderboard and Rewards & Recognition',
      blocks: [
        {
          p: 'Go to **Leaderboard** to see how employees and departments rank by points earned from submitting '
            + 'ideas and having them approved. Filter by All Time, Monthly, Quarterly, or Yearly.',
        },
        {
          bullets: [
            { term: 'Download PDF', text: 'saves the ranking for the period you are viewing as a document, with the organisation name, the period and the date printed on it. This is the one to file or attach.' },
            { term: 'Send to HR', text: 'emails that PDF directly to an address you choose, with an optional note. Use this to hand the ranking to whoever runs Rewards & Recognition — they receive the full ranking as an attachment, not a summary.' },
          ],
        },
        {
          note: 'Send to HR is available to managers and administrators only. It sends mail from IFQM\'s own '
            + 'address, so it is deliberately not open to everyone.',
        },
        {
          p: 'For an actual reward cycle, use **Rewards & Recognition** instead. The Leaderboard screen is a '
            + 'ranking; this is the document you hand to HR, and it answers the questions they will ask back.',
        },
        {
          bullets: [
            { term: 'Pick a period', text: 'Weekly, Fortnightly, Monthly, Quarterly, Half-yearly or Yearly — or your own dates. It opens on the LAST COMPLETE period rather than the one in progress, because you decide March\'s award in April and a half-finished month is a list that is still going to change.' },
            { term: 'Everyone, not a top ten', text: 'every person who submitted in that period appears, in order, and the count is printed above the table. The Leaderboard screen stops at twenty; a reward list that quietly cuts off at twenty is how the twenty-first person never finds out they were close.' },
            { term: 'Scored on the period', text: 'points EARNED in that window, not a lifetime total. Each row shows the two halves — points for submitting, points for what those ideas went on to achieve — so a score somebody queries can be checked on sight.' },
            { term: 'Download Excel', text: 'five sheets: a summary, the full leaderboard, every idea in full, the approval trail one row per decision, and the attachments. This is the one to sort, filter and paste into a payroll sheet.' },
            { term: 'Download PDF', text: 'the same figures as a document to file, circulate or produce two years later. It carries each idea complete — the situation, the proposal, the benefits — then who approved it, in what capacity, and on what date.' },
          ],
        },
        {
          note: 'An idea counts in the period it was SUBMITTED in, even where its approval came later. That '
            + 'credits the effort to when the work was done; the alternative would move an idea between '
            + 'periods depending on how long its approval chain took, which is not the author\'s doing. Every '
            + 'idea in the pack carries its own dates, so you can always see both.',
        },
        {
          note: 'Anonymous ideas are listed without their author, here as everywhere else. Attachments are '
            + 'named and dated in the pack but the files themselves are not embedded — download those from '
            + 'the idea if HR needs them.',
        },
      ],
    },
    {
      id: 'analytics',
      title: '10. Analytics',
      blocks: [
        {
          p: "Go to **Analytics** to see your organisation's overall performance: total ideas, approval and "
            + 'implementation rates, average AI score, submission trends over the last 12 months, and '
            + 'category/impact breakdowns. This page is for viewing only.',
        },
      ],
    },
    {
      id: 'billing',
      title: '11. Billing',
      blocks: [
        {
          p: "Go to **Billing** to see your organisation's current plan, amount due, and next due date. If online "
            + 'payment is enabled for your organisation, choose how many periods to pay for and click '
            + '**Pay {amount}** — this opens a secure payment window. Your payment history is listed further down '
            + 'the page.',
        },
      ],
    },
    {
      id: 'profile',
      title: '12. Your Profile',
      blocks: [
        {
          p: 'Click **My Profile** to view and edit your own Department, Business Unit, and Location, and to change '
            + 'your registered phone number (click **Change**, verify the new number with a code, then confirm). '
            + 'Your Email, Reporting To, and Role are fixed and shown for reference only.',
        },
      ],
    },
    {
      id: 'help',
      title: '13. Getting Help',
      blocks: [
        {
          p: 'Go to **Help** for frequently asked questions, or **Support** to raise a ticket directly with the '
            + "IFQM team — as an admin, you'll see every ticket raised across your organisation, not just your own.",
        },
      ],
    },
    {
      id: 'signing-out',
      title: '14. Signing Out',
      blocks: [{ p: 'Click **Logout** in the top bar, from anywhere in the app.' }],
    },
    {
      id: 'quick-reference',
      title: 'Quick Reference',
      blocks: [
        {
          table: {
            head: ['I want to...', 'Go to'],
            rows: [
              ['Add a new employee', 'Admin Panel → User List → + Add User'],
              ['Add many employees at once', 'Admin Panel → User List → Bulk Import'],
              ['Change the approval steps', 'Admin Panel → Hierarchy'],
              ["Reassign someone's manager", 'Admin Panel → Hierarchy → Reporting Structure'],
              ['Add/remove an idea category', 'Admin Panel → Categories'],
              ['Change who can see idea details', 'Admin Panel → System'],
              ['Set our logo/name', 'Admin Panel → System → Organization Branding'],
              ['Send approved ideas to QCMS', 'Admin Panel → Approved Ideas'],
              ['See how the organisation is performing', 'Analytics'],
              ['Send the leaderboard to HR for R&R', 'Leaderboard → Send to HR'],
              ['Save the leaderboard as a document', 'Leaderboard → Download PDF'],
              ['Pay our subscription', 'Billing'],
              ['Change my forgotten password', 'Sign Out → Forgot your password?'],
            ],
          },
        },
      ],
    },
    {
      id: 'remember',
      title: 'A Few Things to Remember',
      blocks: [
        {
          bullets: [
            "You cannot approve or reject ideas — that's kept separate from administration on purpose.",
            'You cannot promote anyone directly to Admin — only IFQM can do that.',
            'There\'s no "change password" screen after your first login — use the Sign In page\'s reset link if you ever forget it.',
          ],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Platform Console (Superadmin)
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_ADMIN = {
  role: 'platform_admin',
  title: 'User Manual — IFQM Platform Console (Superadmin)',
  subtitle: 'Kalpion',
  sections: [
    {
      id: 'signing-in',
      title: '1. Signing In',
      blocks: [
        {
          p: "Go to the platform's web address and sign in on the same Sign In screen everyone uses — there is no "
            + 'separate platform-admin login page. Enter your email or mobile number and your password, then click '
            + "**Sign In**. Once signed in, you're taken straight to the platform console and kept there — you "
            + "cannot browse into any individual organisation's screens.",
        },
        {
          p: 'Your account is created for you by another platform admin (see §9.6). Use **Forgot your password?** '
            + 'on the Sign In screen if you ever forget it — it emails you a reset link.',
        },
      ],
    },
    {
      id: 'getting-around',
      title: '2. Finding Your Way Around',
      blocks: [
        {
          p: 'The left sidebar shows **Organisations, Registrations, Support Tickets, Plans, Billing, Login '
            + 'Activity, Settings** — this is your entire console. The top bar shows dark mode, language, '
            + 'notifications, and a chip reading "Superadmin signed in as {your name}", plus Logout.',
        },
        {
          note: "Clicking your name chip doesn't do anything useful for this account — ignore it. There's no "
            + 'personal profile page for platform admins.',
        },
        {
          p: "Everywhere in this console you'll see a quiet reminder: you cannot see individual employees, idea "
            + 'content, or files from any organisation. You only ever see counts and aggregates. The one exception '
            + "is Support Tickets, where a customer's own words appear because they chose to write to you directly.",
        },
      ],
    },
    {
      id: 'organisations',
      title: '3. Organisations (your home screen)',
      blocks: [
        {
          p: 'Click **Organisations** to see every customer on the platform: totals across the top (active, on '
            + 'hold, total users, ideas submitted/implemented, sent to QCMS, gone quiet, never signed in), then a '
            + 'searchable, filterable table of every organisation.',
        },
        {
          p: 'To create a new organisation directly (skipping the self-service application process): click '
            + "**+ New Organisation**, fill in the organisation name, its code (auto-fills, but you can edit it), "
            + "and the first admin's name/email/password, then click **Create Organisation**. You'll get a one-time "
            + "confirmation popup with the assigned code and admin email — there's no way to retrieve this again, "
            + 'so note it down.',
        },
        { p: 'To act on an existing organisation, click the menu on its row:' },
        {
          bullets: [
            { term: 'View overview', text: 'opens the full detail page for that organisation (§5).' },
            { term: 'Put on hold / Activate', text: 'toggles their access immediately, no confirmation. "On Hold" is what your team calls suspension.' },
            { term: 'Manage / delete', text: "also opens the detail page; deletion itself requires typing the org's code, so it's not a one-click action from here." },
          ],
        },
        { p: 'Click **CSV** to export the currently filtered list.' },
      ],
    },
    {
      id: 'registrations',
      title: '4. Registrations',
      blocks: [
        {
          p: 'Click **Registrations** to review applications from organisations that applied for a workspace '
            + 'themselves. This is the approval queue for the public sign-up form.',
        },
        {
          p: 'Each pending application shows a **Details** toggle with everything they submitted (company info, '
            + 'statutory details, business profile, address, applicant contact). Two buttons appear on a pending row:',
        },
        {
          bullets: [
            { term: 'Reject', text: 'asks for a reason (optional), then rejects. Nothing is provisioned.' },
            { term: 'Approve', text: "opens a dialog to confirm the organisation code, pick a plan (or decide later), set a trial length, and add an internal note, then click **Approve and create workspace**. This is the moment the organisation and its first admin account actually get created — nothing exists before this. You'll get a one-time banner showing the new admin's temporary password; copy it down, it won't be shown again." },
          ],
        },
        {
          p: '**Personal email exceptions** — normally an application needs a real company email domain. If a '
            + 'legitimate small business only has a Gmail-style address, click **Manage** at the top of the page to '
            + 'add an exception — either one exact address, or a whole domain (which reopens that provider for '
            + 'everyone, so use it sparingly). Always add a reason; it stays on record.',
        },
      ],
    },
    {
      id: 'one-org',
      title: '5. Managing One Organisation',
      blocks: [
        {
          p: 'Reached via **View overview / Manage** from the Organisations list. Everything about one customer '
            + 'lives here:',
        },
        {
          bullets: [
            { term: 'Subscription and billing', text: 'assign or change their plan, set trial length, and record a payment (extends their paid period and lifts a hold if they were suspended for non-payment). Each of these three is its own separate button on purpose, so fixing a typo can\'t accidentally also record a payment.' },
            { term: 'Usage', text: 'employees, ideas, approvals, implementations, QCMS pushes, storage — counts only.' },
            { term: 'Organisation Admin Contacts', text: 'your support contacts for this org. Click **Reset Password** next to any admin to issue them a new temporary password immediately (no confirmation) — it\'s shown once, copy it down, and it signs out their existing sessions.' },
            { term: 'Manage Organisation', text: 'rename the org or change its code (this breaks existing login links and signs everyone out — warn them first), and suspend/reactivate.' },
            { term: 'Danger Zone', text: 'deleting an organisation. Type the organisation\'s exact code to confirm, optionally tick "Also permanently delete the database and all of its data," then click **Delete Organisation**.' },
          ],
        },
        {
          note: 'This is the single most destructive action in the whole console — there is no further confirmation '
            + 'beyond typing the code correctly, and it cannot be undone.',
        },
      ],
    },
    {
      id: 'tickets',
      title: '6. Support Tickets',
      blocks: [
        {
          p: 'Click **Support Tickets** to see every request raised by any organisation, platform-wide. Click a '
            + 'ticket to open its thread — you can reply to the customer, or tick **"Internal note — IFQM staff '
            + 'only"** to leave a note nobody outside IFQM sees (these appear with a clearly different, dashed '
            + 'border so they\'re never confused with a customer-visible reply). Status and Priority dropdowns save '
            + 'automatically as you change them.',
        },
        {
          p: "Click **+ New Ticket** to open a ticket on an organisation's behalf yourself (maintenance notices, "
            + 'incident follow-ups) — pick the organisation, write a subject and message, and send.',
        },
        {
          p: 'Use the bulk-archive panel to tidy away many resolved/closed tickets at once — archiving is '
            + 'reversible, nothing is deleted.',
        },
      ],
    },
    {
      id: 'plans',
      title: '7. Plans',
      blocks: [
        {
          p: 'Click **Plans** to manage the catalogue every organisation can be assigned to — this affects the '
            + 'whole platform going forward, but editing or retiring a plan never changes what an existing customer '
            + 'is already paying.',
        },
        {
          p: 'Click **+ New Plan** for a 4-step wizard: Info (name, code, tier, description) → Pricing (amount, '
            + 'billing cycle including a genuine non-expiring Lifetime option, GST handling) → Limits (max users, '
            + 'storage, monthly request allowance — a "Use suggested" button fills in a sensible number for you) → '
            + 'Review, where you must explicitly confirm the price before **Save plan configuration** unlocks.',
        },
        {
          p: 'Click **Delete** next to an active plan to retire it — a confirmation explains plainly that this only '
            + 'removes it from future selection; every organisation already on it keeps their price and access '
            + 'exactly as-is.',
        },
      ],
    },
    {
      id: 'billing',
      title: '8. Billing (platform-wide)',
      blocks: [
        {
          p: "Click **Billing** to see every organisation's payment status in one table — distinct from any single "
            + "organisation's own billing screen. Summary tiles up top flag organisations with no plan set, expiring "
            + 'soon, or already lapsed.',
        },
        {
          p: 'Click **Manage** on any row to assign/change their plan, set trial length, or record a payment — same '
            + 'three independent actions as the organisation detail page.',
        },
        { p: 'Two buttons matter here:' },
        {
          bullets: [
            { term: 'Preview lapses', text: 'a safe dry run. Shows what would happen, changes nothing.' },
            { term: 'Run sweep', text: 'the real thing. Actually marks organisations lapsed and puts them on hold per the billing rules, with no confirmation dialog.' },
          ],
        },
        { note: 'Always click **Preview** before you click **Run**. Run sweep has no undo and no "are you sure."' },
        { p: '**Send Monthly Invoices** sends the recurring invoice email to eligible paying organisations.' },
      ],
    },
    {
      id: 'settings',
      title: '9. Settings',
      blocks: [
        { p: 'Click **Settings** for six tabs:' },
        { p: '**9.1 New-Tenant Defaults**' },
        {
          p: 'The starting configuration every future organisation gets (SLA days, feature flags, the default '
            + 'approval chain). Changing this never touches organisations that already exist.',
        },
        { p: '**9.2 Organisation Settings**' },
        {
          p: "Look up and edit one organisation's own settings on their behalf — SLA, feature flags, and their SMTP "
            + 'mail settings — without signing in as them.',
        },
        { p: '**9.3 Messaging & ZeptoMail**' },
        {
          p: 'Genuinely platform-wide. Configure the SMS/DLT gateway (for one-time-code delivery), the OTP sign-in '
            + 'policy (code length, lifetime, retry limits), and the ZeptoMail email provider — used for welcome '
            + "emails to newly onboarded employees, and as a fallback when a tenant hasn't set up their own mail. "
            + 'Use **Send test message / Send test email** to prove a setting actually works before anyone depends '
            + 'on it — a test SMS costs a real message credit.',
        },
        { p: '**9.4 Maintenance**' },
        {
          p: 'The platform-wide kill switch. Turning it on locks out every organisation immediately — sessions '
            + 'already open stop working on their next request; your own platform-admin access is unaffected so you '
            + 'can turn it back off. Turning it on asks you to confirm; turning it off does not. You can also edit '
            + 'the notice shown to locked-out users.',
        },
        { p: '**9.5 Payments**' },
        {
          p: "The shared Razorpay merchant account used by every organisation's own Pay button. Save your keys, "
            + 'click **Test keys**, then **Turn payments on**.',
        },
        { p: '**9.6 Platform Admins**' },
        {
          p: 'Manage who can access this console. **Add Platform Admin** to create a new account (minimum '
            + '12-character password) — remember, every account here can reach every organisation. Use '
            + '**Change My Password** to update your own.',
        },
      ],
    },
    {
      id: 'login-activity',
      title: '10. Login Activity',
      blocks: [
        {
          p: 'Click **Login Activity** to see sign-in history for IFQM staff only — not your customers\' own '
            + 'employees signing into their organisations. Filter by outcome (signed in / wrong password / locked '
            + 'out), search by name or address, and export to CSV. Data here is kept for 180 days.',
        },
      ],
    },
    {
      id: 'signing-out',
      title: '11. Signing Out',
      blocks: [{ p: 'Click **Logout**, top-right, from anywhere. No confirmation, immediate.' }],
    },
    {
      id: 'quick-reference',
      title: 'Quick Reference',
      blocks: [
        {
          table: {
            head: ['I want to...', 'Go to'],
            rows: [
              ['Create a new organisation directly', 'Organisations → + New Organisation'],
              ['Approve or reject a workspace application', 'Registrations'],
              ['Suspend or reactivate an organisation', "Organisations → row menu, or the org's own detail page"],
              ['Delete an organisation', 'Organisation detail → Danger Zone'],
              ["Reset an org admin's password", 'Organisation detail → Organisation Admin Contacts'],
              ["Reply to a customer's support request", 'Support Tickets'],
              ['Add or edit a sellable plan', 'Plans'],
              ["Check who's about to lapse", 'Billing → Preview lapses'],
              ['Turn the whole platform off for maintenance', 'Settings → Maintenance'],
              ['Configure the SMS/OTP or email provider', 'Settings → Messaging & ZeptoMail'],
              ['Add another platform admin', 'Settings → Platform Admins'],
              ['See who signed into this console', 'Login Activity'],
            ],
          },
        },
      ],
    },
    {
      id: 'remember',
      title: 'A Few Things to Remember',
      blocks: [
        {
          bullets: [
            'You genuinely cannot see individual employees, idea content, or files belonging to any organisation — only counts. The one exception is what a customer writes into a support ticket.',
            "Deleting an organisation cannot be undone. It's gated only by typing the org's exact code correctly.",
            'Run sweep on the Billing page has no confirmation — always click Preview lapses first.',
            "Turning Maintenance Mode ON asks you to confirm. Turning it off does not — it's treated as always safe.",
            'Editing New-Tenant Defaults only affects organisations created after the change, never existing ones.',
            'Retiring a plan never affects organisations already on it.',
          ],
        },
      ],
    },
  ],
};

/*
 * Which manual a person gets.
 *
 * Keyed on the same role strings the rest of the app uses. Anyone who is not a
 * platform admin or an org admin is an employee as far as the manual is
 * concerned — a team lead and a plant head do the same things in this product,
 * and three manuals is already two more than most people will read.
 */
export function guideForRole(role) {
  if (role === 'platform_admin') return PLATFORM_ADMIN;
  if (role === 'admin' || role === 'super_admin') return ORG_ADMIN;
  return EMPLOYEE;
}

export { EMPLOYEE, ORG_ADMIN, PLATFORM_ADMIN };
