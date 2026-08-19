import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { isPrivileged, isAdmin } from '../utils/helpers';
import { exportApi } from '../services/api';
import { useToast } from '../context/ToastContext';

/*
 * Help, written for the person using the product rather than the person who
 * built it.
 *
 * Every question here came from something a real user had to ask somebody:
 * where their idea went, why they can only see part of a colleague's, what the
 * score means, why they were asked to change their password. A support ticket
 * for a question the software could have answered on screen is a failure of the
 * screen.
 *
 * Grouped rather than listed alphabetically, and filtered by who is reading —
 * a trainee has no use for the approval-chain answers.
 */

const RESPONSE_PROMISE = {
  title: 'How quickly we reply',
  lines: [
    ['Any support ticket', 'Within 1 working day'],
    ['Anything marked urgent', 'Within 4 working hours'],
    ['Support hours', 'Monday to Saturday, 9am – 6pm IST'],
  ],
  note: 'Raise a ticket from the Support page and we can already see which organisation is asking, '
      + 'so you do not have to explain that first. If your organisation’s access has paused over '
      + 'payment, Support stays open — that is exactly when you need it.',
};

const SECTIONS = [
  {
    id: 'submitting',
    title: 'Submitting an idea',
    audience: 'all',
    faqs: [
      ['What makes a good idea to submit?',
       'Something you have actually seen, described plainly. "The tool crib is 90 metres from press 3, '
       + 'so operators walk four times a shift" is worth more than "improve efficiency". You do not need '
       + 'a finished solution — a clearly stated problem is a real contribution, and the review chain '
       + 'exists to work out the rest.'],
      ['Do I have to fill in every field?',
       'Only the ones marked with a red star. The rest — benefits, investment, timing, attachments — help '
       + 'a reviewer judge it faster, but an idea with just a title, a problem and a proposal is a valid '
       + 'submission.'],
      ['Can I save an idea and finish it later?',
       'Yes. Save it as a draft. A draft is private to you: nobody else can see it and it has not entered '
       + 'the review process. Nothing happens until you submit it.'],
      ['What can I attach?',
       'PDFs, Word and Excel files, and photographs. Your organisation sets the size limit for each file '
       + '— the note under the file box tells you what yours is. A phone photograph of the problem is '
       + 'often the single most useful thing you can attach.'],
      ['Can I submit an idea with a colleague?',
       'Yes — add them as co-suggesters. They are credited alongside you, can read the full write-up, and '
       + 'appear on the idea wherever it is shown.'],
    ],
  },
  {
    id: 'after',
    title: 'What happens next',
    audience: 'all',
    faqs: [
      ['Where does my idea go?',
       'Up your reporting line, one step at a time, or to a committee if your organisation routes it that '
       + 'way. You can see exactly where it has reached: open the idea and the line at the top says who '
       + 'currently has it.'],
      ['How long should it take?',
       'Your organisation sets the number of days a reviewer is expected to respond in — usually around '
       + 'seven. Past that the idea is marked as overdue so somebody chases it, and past a longer limit '
       + 'it moves up to the next person automatically.'],
      ['What does the score out of 100 mean?',
       'An automatic first read of how complete and well-argued the submission is, across six areas. It '
       + 'is a sorting aid so well-formed ideas surface first — not a decision. A reviewer can approve a '
       + 'low-scoring idea and turn down a high-scoring one, and often does.'],
      ['My idea was rejected. Is that the end of it?',
       'Not necessarily. The reason is recorded on the idea itself — open it and read the history. Most '
       + 'rejections are about timing, cost or something already under way, and a resubmission that '
       + 'answers the objection is welcome.'],
      ['Do I get anything for submitting?',
       'Points, which build your standing on the leaderboard: some for submitting, more when an idea is '
       + 'approved, more again when it is actually implemented. Whether your organisation attaches '
       + 'anything else to that is up to them.'],
    ],
  },
  {
    id: 'visibility',
    title: 'Who can see what',
    audience: 'all',
    faqs: [
      ['Why can I only see part of a colleague’s idea?',
       'Because it is not yours and you are not reviewing it. You see the title, the status and a one-line '
       + 'summary. Your organisation decides how much more colleagues see — some open the problem '
       + 'statement and the benefits, some show nothing beyond the title. It is not personal and it is not '
       + 'a fault.'],
      ['Who can read my idea in full?',
       'You, always. The colleagues you credited as co-suggesters. Whoever is reviewing it. And your '
       + 'organisation’s administrators. Nobody at IFQM can read the content of an idea.'],
      ['Can I download an idea?',
       'Yes — any idea you can open. If it is yours or you are reviewing it, you get the full record. If '
       + 'not, you get a one-page summary with the same information you can see on screen.'],
      ['Why can I not take a screenshot on some pages?',
       'Pages showing ideas hide their content when the window loses focus, and stamp your name across '
       + 'them. It is a deterrent against ideas leaving the company before they have been assessed. It '
       + 'cannot stop a camera and does not claim to.'],
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    audience: 'all',
    faqs: [
      ['I was asked to change my password the first time I signed in.',
       'Accounts created from a staff spreadsheet start with a temporary password worked out from your '
       + 'name and birth year — which any colleague could guess. Until you replace it, the only thing '
       + 'your account can do is replace it.'],
      ['I have forgotten my password.',
       'Use "Forgot password" on the sign-in page. The link is valid for one hour and can be used once. '
       + 'If no email arrives, check that the address you typed is the one your organisation registered, '
       + 'then raise a support ticket.'],
      ['Why am I locked out after a few wrong attempts?',
       'Five wrong passwords locks the account for fifteen minutes. It is what stops somebody guessing '
       + 'their way in. The right password will not open it early — wait it out.'],
      ['Can I use the app in my own language?',
       'Yes. Seven languages: English, Hindi, Kannada, Tamil, Telugu, Marathi and Malayalam. Switch from '
       + 'the language button at the top of any screen; the choice is remembered.'],
    ],
  },
  {
    id: 'reviewing',
    title: 'Reviewing ideas',
    audience: 'reviewer',
    faqs: [
      ['What am I expected to do with an idea in my queue?',
       'Approve it, turn it down, or pass it up the chain — with a sentence saying why. The reason is the '
       + 'part that matters: it is shown to whoever submitted it, and a decision with no explanation is '
       + 'the fastest way to stop people submitting.'],
      ['Can I review my own idea?',
       'No. The software refuses it. If your own idea reaches your queue, it moves to the next person in '
       + 'the chain.'],
      ['What if an idea needs several people to agree?',
       'Route it to a committee. Everyone chosen sees it at once, and it counts as approved when the '
       + 'share your organisation has set — often all of them — has agreed.'],
    ],
  },
  {
    id: 'admin',
    title: 'Running it for your organisation',
    audience: 'admin',
    faqs: [
      ['How do I add our staff?',
       'Admin panel → User list → Bulk import. Download the template, fill it in, upload it. People are '
       + 'matched on employee number, so re-uploading an updated sheet edits existing people rather than '
       + 'duplicating them.'],
      ['How do I change who approves what?',
       'Admin panel → Hierarchy. You can follow the reporting structure, name the roles that review and '
       + 'the roles that give the final decision, or list named stages in order. The preview underneath '
       + 'reads the chain back to you in plain words — check it before saving.'],
      ['How do I control what colleagues see on each other’s ideas?',
       'Admin panel → System → "What colleagues can read on someone else’s idea". Tick the sections you '
       + 'want open. Authors and reviewers are never affected by it.'],
      ['What happens to old ideas?',
       'Archive them — All Ideas → Archive in bulk, by selection or by date. Archiving is not deleting: '
       + 'points, history and recorded savings all stay, and the same panel puts them back.'],
      ['What does our subscription cost and when does it renew?',
       'A banner tells you when the period is nearly up. For anything else about billing, raise a support '
       + 'ticket — IFQM sets plans and prices, not your organisation’s administrator.'],
    ],
  },
];

export default function HelpPage() {
  const { showToast } = useToast();
  const [guideBusy, setGuideBusy] = useState(false);

  /*
   * The guide is behind requireAuth, so it cannot be a plain link — the browser
   * would fetch it without the token and be handed a 401 instead of a file.
   */
  async function downloadGuide() {
    setGuideBusy(true);
    try {
      await exportApi.userGuide();
    } catch (e) {
      showToast(e?.response?.status === 404
        ? 'The user guide is not available on this deployment.'
        : 'The guide could not be downloaded just now.', 'danger');
    }
    setGuideBusy(false);
  }

  const { user } = useAuth();
  const { t } = useLang();
  const [query, setQuery] = useState('');

  const role = user?.role;
  const sections = SECTIONS.filter((s) => (
    s.audience === 'all'
    || (s.audience === 'reviewer' && isPrivileged(role))
    || (s.audience === 'admin' && isAdmin(role))
  ));

  const q = query.trim().toLowerCase();
  const shown = sections
    .map((s) => ({
      ...s,
      faqs: q ? s.faqs.filter(([a, b]) => (a + b).toLowerCase().includes(q)) : s.faqs,
    }))
    .filter((s) => s.faqs.length);

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.5px' }}>
          Help
        </h1>
        <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4 }}>
          The questions people ask most, answered plainly.
        </div>
      </div>

      {/* The manual. It has existed in docs/ since it was written and nothing in
          the product pointed at it, so the only people who ever saw it were the
          ones sent a copy by hand. */}
      <div className="card" style={{ marginBottom: 18, display: 'flex', gap: 14,
        alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="card-title" style={{ margin: 0 }}>User guide</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Every screen, in order, with pictures. Worth handing to somebody on their
            first day rather than talking them through it.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={guideBusy} onClick={downloadGuide}>
          {guideBusy ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {/* The promise, stated rather than implied. */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">{RESPONSE_PROMISE.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
          {RESPONSE_PROMISE.lines.map(([label, value]) => (
            <div key={label} style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '11px 13px',
            }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--primary)' }}>{value}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          {RESPONSE_PROMISE.note}
        </div>
        <Link className="btn btn-primary btn-sm" to="/support" style={{ marginTop: 12, display: 'inline-block' }}>
          Raise a support ticket
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <input className="form-control" placeholder="Search the questions…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {!shown.length && (
        <div className="card">
          <div className="empty-state">
            Nothing matches “{query}”. If your question is not here, raise a support ticket — we answer
            within one working day, and questions asked often enough end up on this page.
          </div>
        </div>
      )}

      {shown.map((section) => (
        <div className="card" key={section.id} style={{ marginBottom: 18 }}>
          <div className="card-title">{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {section.faqs.map(([question, answer]) => (
              <details key={question} style={{
                background: 'var(--panel-bg)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 14px',
              }}>
                <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--heading)' }}>
                  {question}
                </summary>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65, margin: '8px 0 0' }}>
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      ))}

      <div className="card">
        <div className="card-title">Where to go next</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
          {[
            ['/submit', 'Submit an idea'],
            ['/my-ideas', 'My ideas'],
            ['/board', 'Idea board'],
            ['/leaderboard', 'Leaderboard'],
            ['/profile', 'My profile'],
            ['/support', 'Support'],
          ].map(([to, label]) => (
            <Link key={to} to={to} style={{
              textDecoration: 'none', fontSize: 13, fontWeight: 600, color: 'var(--primary)',
              background: 'var(--panel-bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 13px',
            }}>{label} →</Link>
          ))}
        </div>
      </div>
    </>
  );
}
