import { useState } from 'react';
import { Link } from 'react-router-dom';
import { registrationsApi } from '../services/api';
import InfoDot from '../components/InfoDot';

/*
  MSME self-registration.

  Three steps rather than one long form, because the fields come from three
  different places in the applicant's head: who they are, what the business is
  on paper (the Udyam certificate), and where it operates. Splitting it also
  means the corporate-email rule is enforced on step 1, before anyone has spent
  five minutes typing GST numbers they would have to retype after a rejection.

  Nothing here provisions anything. The application lands in a queue and a
  platform admin approves it — the form says so plainly rather than implying an
  instant account, because an unmet expectation at signup is a support ticket.

  Only company name, contact name and a work email are required. Everything else
  is optional on purpose: a half-filled application a reviewer can chase beats an
  abandoned one, and the reviewer sees exactly what was left blank.
*/

const ENTITY_TYPES = [
  ['proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership firm'],
  ['llp', 'LLP'],
  ['private_limited', 'Private limited company'],
  ['public_limited', 'Public limited company'],
  ['cooperative', 'Co-operative society'],
  ['trust', 'Trust'],
  ['society', 'Society'],
  ['other', 'Other'],
];

/* Micro / small / medium as an MSME self-declares them at Udyam. The limits are
   shown because most applicants know their numbers but not their bracket. */
const CATEGORIES = [
  ['micro', 'Micro', 'investment ≤ ₹2.5 cr · turnover ≤ ₹10 cr'],
  ['small', 'Small', 'investment ≤ ₹25 cr · turnover ≤ ₹100 cr'],
  ['medium', 'Medium', 'investment ≤ ₹125 cr · turnover ≤ ₹500 cr'],
];

const TURNOVER_BANDS = [
  ['under_50l', 'Under ₹50 lakh'],
  ['50l_2cr', '₹50 lakh – ₹2 crore'],
  ['2cr_10cr', '₹2 – 10 crore'],
  ['10cr_50cr', '₹10 – 50 crore'],
  ['50cr_250cr', '₹50 – 250 crore'],
  ['above_250cr', 'Above ₹250 crore'],
];

const SECTORS = [
  'Manufacturing', 'Engineering & fabrication', 'Automotive & components',
  'Textiles & apparel', 'Food processing', 'Pharmaceuticals & chemicals',
  'Electronics & electricals', 'Plastics & packaging', 'Construction & infrastructure',
  'Logistics & warehousing', 'IT & software services', 'Business services',
  'Retail & distribution', 'Healthcare services', 'Education & training', 'Other',
];

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Andaman & Nicobar Islands', 'Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh',
  'Lakshadweep', 'Puducherry',
];

const BLANK = {
  company_name: '', proposed_slug: '', website: '',
  contact_name: '', contact_designation: '', contact_email: '', contact_phone: '',
  udyam_number: '', gstin: '', pan: '', cin: '',
  entity_type: '', enterprise_category: '', sector: '', nic_code: '',
  employee_count: '', annual_turnover_band: '', year_established: '',
  address_line: '', city: '', state: '', pincode: '', country: 'India',
  accepted_terms: false,
};

const STEPS = ['Your details', 'Business profile', 'Location & review'];

export default function SignupPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (error) setError('');
  };

  /* Check the work-email rule against the server as soon as the field loses
     focus, so "we don't accept gmail" arrives before step 2 rather than after
     the whole form is filled in. The server re-checks on submit regardless. */
  async function validateEmail() {
    const email = form.contact_email.trim();
    setEmailNote('');
    if (!email) return;
    try {
      const res = await registrationsApi.checkEmail(email);
      if (!res.data.acceptable) setEmailNote(res.data.reason || 'Use your work email address.');
      else if (!form.proposed_slug && res.data.domain) {
        // Pre-fill the org code from the domain — one less thing to invent.
        setForm((f) => ({ ...f, proposed_slug: res.data.domain.split('.')[0].replace(/[^a-z0-9_-]/g, '') }));
      }
    } catch { /* advisory only; submit is the authority */ }
  }

  function next() {
    if (step === 0) {
      if (!form.company_name.trim()) return setError('Enter your registered company name.');
      if (!form.contact_name.trim()) return setError('Enter your full name.');
      if (!form.contact_email.trim()) return setError('Enter your work email address.');
      if (emailNote) return setError(emailNote);
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.accepted_terms) return setError('Please confirm you are authorised to register this organisation.');
    setBusy(true);
    setError('');
    try {
      const res = await registrationsApi.submit(form);
      if (res.data.success) setDone(res.data);
      else setError(res.data.error || 'Could not submit your application.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit your application. Please try again.');
    }
    setBusy(false);
  }

  return (
    <div className="ifqm-signup">
      <style>{`
        .ifqm-signup{min-height:100vh;background:var(--bg);color:var(--text);padding:32px 20px 56px;
          font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif}
        .ifqm-signup *{box-sizing:border-box}
        .ifqm-signup .wrap{max-width:720px;margin:0 auto}
        .ifqm-signup a{text-decoration:none}
        .ifqm-signup .brand{display:flex;align-items:center;justify-content:center;gap:11px;margin-bottom:24px}
        .ifqm-signup .brand img{height:42px;background:#fff;border-radius:11px;padding:6px 10px;object-fit:contain;
          box-shadow:0 8px 26px rgba(79,70,229,.18)}
        .ifqm-signup .brand b{font-size:17px;font-weight:800;color:var(--heading);letter-spacing:-.02em}
        .ifqm-signup .brand small{display:block;font-size:10.5px;font-weight:500;color:var(--text-muted)}

        .ifqm-signup h1{font-size:25px;font-weight:820;color:var(--heading);letter-spacing:-.025em;margin:0 0 8px}
        .ifqm-signup .lede{font-size:14px;color:var(--text-muted);line-height:1.6;margin:0 0 22px}

        .ifqm-signup .steps{display:flex;gap:8px;margin-bottom:22px}
        .ifqm-signup .stp{flex:1;font-size:11.5px;font-weight:650;color:var(--text-muted);
          padding-top:9px;border-top:3px solid var(--border);transition:color .18s,border-color .18s}
        .ifqm-signup .stp.on{color:var(--primary);border-top-color:var(--primary)}
        .ifqm-signup .stp.done{color:var(--success);border-top-color:var(--success)}

        .ifqm-signup .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
          padding:24px;box-shadow:0 20px 46px -34px rgba(12,14,20,.34)}
        .ifqm-signup fieldset{border:none;padding:0;margin:0 0 20px}
        .ifqm-signup legend{font-size:11.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;
          color:var(--primary);padding:0;margin-bottom:12px}
        .ifqm-signup .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .ifqm-signup .full{grid-column:1/-1}
        .ifqm-signup label{display:block;font-size:12.5px;font-weight:650;color:var(--subtext);margin-bottom:5px}
        .ifqm-signup label .opt{font-weight:500;color:var(--subtle);margin-left:5px}
        .ifqm-signup input,.ifqm-signup select{width:100%;background:var(--input-bg);border:1px solid var(--input-border);
          border-radius:10px;padding:10px 12px;font-size:13.5px;color:var(--text);outline:none;
          transition:border-color .16s,box-shadow .16s;font-family:inherit}
        .ifqm-signup input:focus,.ifqm-signup select:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-dim)}
        .ifqm-signup .hint{font-size:11px;color:var(--subtle);margin-top:4px;line-height:1.45}
        .ifqm-signup .warn{font-size:11.5px;color:var(--danger);margin-top:5px}
        .ifqm-signup .err{background:var(--danger-light);color:var(--danger);border:1px solid var(--danger);
          border-radius:10px;padding:10px 13px;font-size:12.5px;margin-bottom:16px}
        .ifqm-signup .terms{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;color:var(--subtext);
          line-height:1.55;background:var(--panel-bg);border:1px solid var(--border);border-radius:11px;padding:13px}
        .ifqm-signup .terms input{width:16px;height:16px;flex:none;margin-top:1px}
        .ifqm-signup .row{display:flex;gap:10px;justify-content:space-between;margin-top:22px}
        .ifqm-signup .btn{border:none;border-radius:11px;padding:12px 20px;font-size:14px;font-weight:680;
          cursor:pointer;transition:filter .16s,transform .16s;font-family:inherit}
        .ifqm-signup .btn:disabled{opacity:.6;cursor:default}
        .ifqm-signup .primary{background:var(--primary);color:var(--on-primary)}
        .ifqm-signup .primary:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px)}
        .ifqm-signup .ghost{background:var(--surface);color:var(--text);border:1px solid var(--border)}
        .ifqm-signup .foot{text-align:center;font-size:12.5px;color:var(--text-muted);margin-top:18px}
        .ifqm-signup .foot a{color:var(--primary)}
        .ifqm-signup .review{font-size:12.5px;color:var(--subtext);background:var(--panel-bg);
          border:1px solid var(--border);border-radius:11px;padding:14px;line-height:1.7}
        .ifqm-signup .review b{color:var(--heading)}
        .ifqm-signup .ok{text-align:center;padding:14px 0}
        .ifqm-signup .ok .tick{width:56px;height:56px;border-radius:50%;background:var(--success-light);
          color:var(--success);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 16px}
        .ifqm-signup .ref{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          background:var(--chip-bg);border:1px solid var(--border);border-radius:8px;padding:5px 11px;
          font-size:13px;font-weight:700;color:var(--heading);margin:10px 0 4px}
        @media (max-width:560px){ .ifqm-signup .grid{grid-template-columns:1fr} .ifqm-signup .card{padding:18px} }
      `}</style>

      <div className="wrap">
        <Link to="/" className="brand">
          <img src="/assets/ifqm-logo.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <span><b>IFQM</b><small>Employee Ideation Tool</small></span>
        </Link>

        {done ? (
          <div className="card ok">
            <div className="tick" aria-hidden="true">✓</div>
            <h1>Application received</h1>
            <p className="lede" style={{ marginBottom: 0 }}>
              A platform administrator will review your details and set up your
              workspace. We will email <b>{form.contact_email}</b> either way.
            </p>
            <div className="ref">{done.reference}</div>
            <p className="hint">Quote this reference if you contact us about the application.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn ghost" to="/">Back to the overview</Link>
            </div>
          </div>
        ) : (
          <>
            <h1>Register your organisation</h1>
            <p className="lede">
              Tell us about your business and we will set up your workspace. Approval
              is manual — usually the same working day — and your team can be invited
              as soon as it is live. Only the first three fields are required.
            </p>

            <div className="steps">
              {STEPS.map((label, i) => (
                <div key={label} className={`stp${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}>
                  {i + 1}. {label}
                </div>
              ))}
            </div>

            <form className="card" onSubmit={submit}>
              {error && <div className="err">{error}</div>}

              {step === 0 && (
                <>
                  <fieldset>
                    <legend>Organisation</legend>
                    <div className="grid">
                      <div className="full">
                        <label htmlFor="company_name">Registered company name</label>
                        <input id="company_name" value={form.company_name} onChange={set('company_name')}
                          placeholder="Acme Precision Components Pvt Ltd" required />
                      </div>
                      <div>
                        <label htmlFor="proposed_slug">Preferred org code <span className="opt">optional</span><InfoDot term="org_code" /></label>
                        <input id="proposed_slug" value={form.proposed_slug} onChange={set('proposed_slug')}
                          placeholder="acme" />
                        <p className="hint">Short identifier for your workspace. We derive one from your email if you leave this blank.</p>
                      </div>
                      <div>
                        <label htmlFor="website">Website <span className="opt">optional</span></label>
                        <input id="website" type="url" value={form.website} onChange={set('website')}
                          placeholder="https://acme.co.in" />
                      </div>
                    </div>
                  </fieldset>

                  <fieldset style={{ marginBottom: 0 }}>
                    <legend>Who is applying</legend>
                    <div className="grid">
                      <div>
                        <label htmlFor="contact_name">Full name</label>
                        <input id="contact_name" value={form.contact_name} onChange={set('contact_name')}
                          placeholder="Priya Nair" required />
                      </div>
                      <div>
                        <label htmlFor="contact_designation">Designation <span className="opt">optional</span></label>
                        <input id="contact_designation" value={form.contact_designation}
                          onChange={set('contact_designation')} placeholder="Operations Head" />
                      </div>
                      <div className="full">
                        <label htmlFor="contact_email">Work email</label>
                        <input id="contact_email" type="email" value={form.contact_email}
                          onChange={set('contact_email')} onBlur={validateEmail}
                          placeholder="priya@acme.co.in" required />
                        {emailNote
                          ? <p className="warn">{emailNote}</p>
                          : <p className="hint">Must be your company domain — personal mailboxes such as Gmail or Outlook cannot be verified as belonging to your organisation. You become the first administrator of the workspace.</p>}
                      </div>
                      <div>
                        <label htmlFor="contact_phone">Phone <span className="opt">optional</span></label>
                        <input id="contact_phone" value={form.contact_phone} onChange={set('contact_phone')}
                          placeholder="+91 98765 43210" />
                      </div>
                    </div>
                  </fieldset>
                </>
              )}

              {step === 1 && (
                <>
                  <fieldset>
                    <legend>Statutory identity</legend>
                    <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
                      Straight off your Udyam certificate. All optional — supply what
                      you have and a reviewer will follow up if anything is needed.
                    </p>
                    <div className="grid">
                      <div>
                        <label htmlFor="udyam_number">Udyam registration number <span className="opt">optional</span><InfoDot term="udyam" /></label>
                        <input id="udyam_number" value={form.udyam_number} onChange={set('udyam_number')}
                          placeholder="UDYAM-KR-03-0012345" />
                      </div>
                      <div>
                        <label htmlFor="gstin">GSTIN <span className="opt">optional</span><InfoDot term="gstin" /></label>
                        <input id="gstin" value={form.gstin} onChange={set('gstin')} placeholder="29ABCDE1234F1Z5" />
                        <p className="hint">Leave blank if you are below the GST threshold.</p>
                      </div>
                      <div>
                        <label htmlFor="pan">Business PAN <span className="opt">optional</span></label>
                        <input id="pan" value={form.pan} onChange={set('pan')} placeholder="ABCDE1234F" />
                      </div>
                      <div>
                        <label htmlFor="cin">CIN <span className="opt">optional</span></label>
                        <input id="cin" value={form.cin} onChange={set('cin')} placeholder="U29100KA2015PTC012345" />
                        <p className="hint">Companies only.</p>
                      </div>
                      <div>
                        <label htmlFor="entity_type">Entity type <span className="opt">optional</span></label>
                        <select id="entity_type" value={form.entity_type} onChange={set('entity_type')}>
                          <option value="">Select…</option>
                          {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="enterprise_category">MSME category <span className="opt">optional</span></label>
                        <select id="enterprise_category" value={form.enterprise_category} onChange={set('enterprise_category')}>
                          <option value="">Select…</option>
                          {CATEGORIES.map(([v, l, hint]) => <option key={v} value={v}>{l} — {hint}</option>)}
                        </select>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset style={{ marginBottom: 0 }}>
                    <legend>Business profile</legend>
                    <div className="grid">
                      <div>
                        <label htmlFor="sector">Sector <span className="opt">optional</span></label>
                        <select id="sector" value={form.sector} onChange={set('sector')}>
                          <option value="">Select…</option>
                          {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="nic_code">NIC activity code <span className="opt">optional</span><InfoDot term="nic_code" /></label>
                        <input id="nic_code" value={form.nic_code} onChange={set('nic_code')} placeholder="25" />
                        <p className="hint">The 2-digit code from your Udyam certificate.</p>
                      </div>
                      <div>
                        <label htmlFor="employee_count">Number of employees <span className="opt">optional</span></label>
                        <input id="employee_count" type="number" min="1" max="100000"
                          value={form.employee_count} onChange={set('employee_count')} placeholder="85" />
                        <p className="hint">Helps us size your workspace and suggest a rollout plan.</p>
                      </div>
                      <div>
                        <label htmlFor="annual_turnover_band">Annual turnover <span className="opt">optional</span></label>
                        <select id="annual_turnover_band" value={form.annual_turnover_band} onChange={set('annual_turnover_band')}>
                          <option value="">Select…</option>
                          {TURNOVER_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="year_established">Year established <span className="opt">optional</span></label>
                        <input id="year_established" type="number" min="1850" max={new Date().getFullYear()}
                          value={form.year_established} onChange={set('year_established')} placeholder="2015" />
                      </div>
                    </div>
                  </fieldset>
                </>
              )}

              {step === 2 && (
                <>
                  <fieldset>
                    <legend>Registered address</legend>
                    <div className="grid">
                      <div className="full">
                        <label htmlFor="address_line">Address <span className="opt">optional</span></label>
                        <input id="address_line" value={form.address_line} onChange={set('address_line')}
                          placeholder="Plot 14, Phase II, Industrial Area" />
                      </div>
                      <div>
                        <label htmlFor="city">City / town <span className="opt">optional</span></label>
                        <input id="city" value={form.city} onChange={set('city')} placeholder="Bengaluru" />
                      </div>
                      <div>
                        <label htmlFor="state">State <span className="opt">optional</span></label>
                        <select id="state" value={form.state} onChange={set('state')}>
                          <option value="">Select…</option>
                          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="pincode">PIN code <span className="opt">optional</span></label>
                        <input id="pincode" value={form.pincode} onChange={set('pincode')} placeholder="560058" />
                      </div>
                      <div>
                        <label htmlFor="country">Country</label>
                        <input id="country" value={form.country} onChange={set('country')} />
                      </div>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Review</legend>
                    <div className="review">
                      <div><b>{form.company_name || '—'}</b>{form.sector ? ` · ${form.sector}` : ''}</div>
                      <div>{form.contact_name || '—'}{form.contact_designation ? `, ${form.contact_designation}` : ''} · {form.contact_email || '—'}</div>
                      <div>
                        Org code: <b>{form.proposed_slug || 'derived from your email'}</b>
                        {form.employee_count ? ` · ${form.employee_count} employees` : ''}
                        {form.enterprise_category ? ` · ${form.enterprise_category}` : ''}
                      </div>
                      {(form.city || form.state) && <div>{[form.city, form.state, form.pincode].filter(Boolean).join(', ')}</div>}
                    </div>
                  </fieldset>

                  <label className="terms" htmlFor="accepted_terms">
                    <input id="accepted_terms" type="checkbox" checked={form.accepted_terms} onChange={set('accepted_terms')} />
                    <span>
                      I am authorised to register this organisation, and the details
                      above are accurate to the best of my knowledge. I understand the
                      workspace is created only after review.
                    </span>
                  </label>
                </>
              )}

              <div className="row">
                {step > 0
                  ? <button type="button" className="btn ghost" onClick={() => setStep((s) => s - 1)}>Back</button>
                  : <Link className="btn ghost" to="/">Cancel</Link>}
                {step < STEPS.length - 1
                  ? <button type="button" className="btn primary" onClick={next}>Continue</button>
                  : <button type="submit" className="btn primary" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit application'}
                    </button>}
              </div>
            </form>

            <p className="foot">
              Already have a workspace? <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
