import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { ideasApi, challengesApi, uploadApi, usersApi, categoriesApi } from '../services/api';
import { translateStatus, translateImpact, translateArea } from '../utils/helpers';

const IMPACT_LEVELS = ['Low','Medium','High','Critical'];
const FEASIBILITY_LEVELS = ['Low','Medium','High'];

/*
 * Categories are per-organisation rows now, not a constant compiled into this
 * bundle. This list is only the last resort: if the request fails the employee
 * still gets a usable form instead of a step with nothing on it. It mirrors the
 * seed in migration 003.
 */
const FALLBACK_CATEGORIES = ['Safety','Quality','Productivity','Delivery','Sustenance'];

/**
 * Required-field marker. The asterisk used to be a plain character in the label
 * text, the same weight and colour as the label itself, so it read as
 * punctuation rather than an instruction — people reached the validation error
 * before they noticed which fields were mandatory.
 *
 * aria-hidden because it carries no meaning for a screen reader: the `required`
 * attribute on the input already announces the field as mandatory, and reading
 * out "star" on top of that is noise.
 */
const Req = () => (
  <span aria-hidden="true" style={{ color:'var(--danger)',fontWeight:800,marginLeft:2 }}>*</span>
);

export default function SubmitPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const navigate      = useNavigate();

  const [step,    setStep]    = useState(1);
  const [draftId, setDraftId] = useState(null);

  // Step 1 fields
  const [title,     setTitle]     = useState('');
  const [situation, setSituation] = useState('');
  const [dupWarning, setDupWarning] = useState([]);

  // Step 2 fields
  const [solution,    setSolution]    = useState('');
  const [tangible,    setTangible]    = useState('');
  const [intangible,  setIntangible]  = useState('');
  const [impactAreas, setImpactAreas] = useState([]);
  const [impactLevel, setImpactLevel] = useState('Medium');
  const [categories,  setCategories]  = useState(FALLBACK_CATEGORIES);

  // Step 3 business case
  const [investment,   setInvestment]   = useState('');
  const [feasibility,  setFeasibility]  = useState('');
  const [implDuration, setImplDuration] = useState('');
  const [implDate,     setImplDate]     = useState('');
  const [benefits,     setBenefits]     = useState('');
  const [support,      setSupport]      = useState('');

  // Step 4 files
  const [fileSit, setFileSit] = useState(null);
  const [fileSol, setFileSol] = useState(null);
  // Attached under the Support Required field on the business-case step.
  const [fileSup, setFileSup] = useState(null);
  // Attached under the Benefits Expected field on the business-case step.
  const [fileBen, setFileBen] = useState(null);

  // Step 5 co-suggesters — a dynamic list; add as many colleagues as needed.
  const [coSuggesters, setCoSuggesters] = useState([]); // [{ id, label }]
  const [coQuery, setCoQuery] = useState('');
  const [coResults, setCoResults] = useState([]);

  // Step 6 options
  const [anonymous,    setAnonymous]    = useState(false);
  const [templateType, setTemplateType] = useState('');
  const [challengeId,  setChallengeId]  = useState('');
  const [challenges,   setChallenges]   = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dupTimerRef = useRef(null);
  const searchTimers = useRef({});

  useEffect(() => { loadChallenges(); loadCategories(); }, []);

  async function loadChallenges() {
    try {
      const res = await challengesApi.list();
      if (res.data.success) setChallenges(res.data.challenges?.filter(c => c.status==='active') || []);
    } catch {}
  }

  // An organisation that has deleted every category cannot happen (the API
  // refuses the last delete), but an empty response still falls back rather
  // than rendering a step with no choices on it.
  async function loadCategories() {
    try {
      const res = await categoriesApi.list();
      const names = (res.data.categories || []).map(c => c.name).filter(Boolean);
      if (names.length) setCategories(names);
    } catch {}
  }

  async function checkDuplicate(titleVal) {
    clearTimeout(dupTimerRef.current);
    if (titleVal.length < 8) { setDupWarning([]); return; }
    dupTimerRef.current = setTimeout(async () => {
      try {
        const res = await ideasApi.checkDuplicate({ title: titleVal });
        setDupWarning(res.data.duplicates || []);
      } catch {}
    }, 600);
  }

  function searchCoSuggesters(query) {
    clearTimeout(searchTimers.current.co);
    if (query.length < 2) { setCoResults([]); return; }
    searchTimers.current.co = setTimeout(async () => {
      try {
        const res = await usersApi.list({ q: query });
        // Hide the submitter and anyone already added.
        const chosen = new Set(coSuggesters.map(c => c.id));
        setCoResults((res.data.users || []).filter(u => u.id !== user?.id && !chosen.has(u.id)));
      } catch {}
    }, 300);
  }

  function addCoSuggester(u) {
    setCoSuggesters(prev => prev.some(c => c.id === u.id) ? prev : [...prev, { id: u.id, label: `${u.name} (${u.employee_id})` }]);
    setCoQuery(''); setCoResults([]);
  }
  function removeCoSuggester(id) {
    setCoSuggesters(prev => prev.filter(c => c.id !== id));
  }

  function toggleImpact(area) {
    setImpactAreas(prev => prev.includes(area) ? prev.filter(a=>a!==area) : [...prev, area]);
  }

  function validateStep() {
    if (step === 1) {
      if (!title.trim() || situation.trim().length < 20) {
        setError(t('msg.fill_situation')); return false;
      }
    }
    if (step === 2 && !solution.trim()) {
      setError(t('msg.fill_solution')); return false;
    }
    setError('');
    return true;
  }

  function goStep(n) {
    if (n > step && !validateStep()) return;
    setStep(n);
    setError('');
  }

  function buildPayload() {
    return {
      title,
      present_situation:  situation,
      proposed_solution:  solution,
      impact_areas:       impactAreas.join(','),
      impact_level:       impactLevel,
      tangible_benefit:   tangible,
      intangible_benefit: intangible,
      // Business case — all optional; blanks are stored as NULL server-side.
      investment_required:          investment,
      feasibility:                  feasibility,
      implementation_duration:      implDuration,
      expected_implementation_date: implDate,
      benefits_expected:            benefits,
      support_required:             support,
      // Full co-suggester list (backend also mirrors the first two into the
      // legacy columns for older read paths).
      co_suggester_ids:   coSuggesters.map(c => c.id),
      is_anonymous:       anonymous ? 1 : 0,
      template_type:      templateType || null,
      challenge_id:       challengeId || null,
    };
  }

  async function handleSaveDraft() {
    const body = { ...buildPayload(), id: draftId };
    try {
      const res = await ideasApi.saveDraft(body);
      if (res.data.success) {
        setDraftId(res.data.idea_id);
        showToast(`${t('msg.draft_prefix')} ${res.data.idea_code}`, 'success');
      }
    } catch { showToast(t('msg.draft_failed'), 'danger'); }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    const body = { ...buildPayload(), id: draftId };
    try {
      const res = await ideasApi.submit(body);
      if (res.data.success) {
        // Upload files
        await uploadFiles(res.data.idea_id);
        const msg = t('msg.idea_ok', { code: res.data.idea_code });
        const pts = res.data.points_added > 0 ? ' · ' + t('msg.pts_earned', { n: res.data.points_added }) : '';
        showToast(msg + pts, 'success');
        // Reset form
        resetForm();
        navigate('/my-ideas');
      } else {
        setError(res.data.error || t('msg.submit_failed'));
      }
    } catch { setError(t('msg.server_error')); }
    setSubmitting(false);
  }

  async function uploadFiles(ideaId) {
    const uploads = [];
    if (fileSit) uploads.push({ file: fileSit, section: 'situation' });
    if (fileSol) uploads.push({ file: fileSol, section: 'solution' });
    if (fileSup) uploads.push({ file: fileSup, section: 'support' });
    if (fileBen) uploads.push({ file: fileBen, section: 'benefits' });
    for (const { file, section } of uploads) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('idea_id', ideaId);
      fd.append('section', section);
      try { await uploadApi.upload(fd); } catch {}
    }
  }

  function resetForm() {
    setTitle(''); setSituation(''); setSolution(''); setTangible(''); setIntangible('');
    setImpactAreas([]); setImpactLevel('Medium'); setFileSit(null); setFileSol(null); setFileSup(null); setFileBen(null);
    setInvestment(''); setFeasibility(''); setImplDuration(''); setImplDate('');
    setBenefits(''); setSupport('');
    setCoSuggesters([]); setCoQuery(''); setCoResults([]);
    setAnonymous(false); setTemplateType(''); setChallengeId('');
    setDraftId(null); setStep(1); setError(''); setDupWarning([]);
  }

  /*
   * The business case is a step of its own, third, straight after the solution
   * — the questions it asks (what will this cost, how long, what support) only
   * make sense once the solution has been described, and they belong before the
   * optional attachment/co-suggester steps rather than buried under them.
   *
   * The existing wizard.stepN keys keep their original meanings; the new step
   * has its own key rather than shifting every label by one.
   */
  const stepLabels = [
    t('wizard.step1'), t('wizard.step2'), t('wizard.business'),
    t('wizard.step3'), t('wizard.step4'), t('wizard.step5'),
  ];

  return (
    <>
      {/* Wizard Steps */}
      <div className="wizard-steps">
        {stepLabels.map((label, i) => (
          <div key={i} className={`w-step${step===i+1?' active':step>i+1?' done':''}`}>
            <div className="w-step-circle">{step > i+1 ? '✓' : i+1}</div>
            <div className="w-step-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Full-width: the wizard fills the content area rather than a narrow
          720px column, so long text and the two-column rows have room. */}
      <div className="card" style={{ marginTop:20 }}>
        {error && <div className="alert alert-danger" style={{ marginBottom:16 }}>{error}</div>}

        {/* Step 1: Situation */}
        {step === 1 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div className="form-group">
              <label>{t('form.title')}<Req /></label>
              <input className="form-control" value={title}
                onChange={e => { setTitle(e.target.value); checkDuplicate(e.target.value); }}
                placeholder={t('form.title_ph')} />
              {dupWarning.length > 0 && (
                <div id="duplicate-warning" className="alert alert-warning" style={{ marginTop:6 }}>
                  ⚠ {t('form.dup_warning')}
                  <ul style={{ margin:'4px 0 0 16px' }}>
                    {dupWarning.map(x => (
                      <li key={x.id}><strong>{x.idea_code}</strong>: {x.title} <span style={{ color:'var(--text-muted)' }}>({translateStatus(x.status, t)})</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>{t('form.situation')}<Req /> <span style={{ fontWeight:400,fontSize:11,color:'var(--subtle)' }}>{t('form.min_chars')}</span></label>
              <textarea className="form-control" rows="5" value={situation}
                onChange={e => setSituation(e.target.value)}
                placeholder={t('form.situation_ph')} />
            </div>
          </div>
        )}

        {/* Step 2: Solution & Impact */}
        {step === 2 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div className="form-group">
              <label>{t('form.solution')}<Req /></label>
              <textarea className="form-control" rows="5" value={solution}
                onChange={e => setSolution(e.target.value)}
                placeholder={t('form.solution_ph')} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('form.tangible')}</label>
                <textarea className="form-control" rows="3" value={tangible}
                  onChange={e => setTangible(e.target.value)}
                  placeholder={t('form.tangible_ph')} />
              </div>
              <div className="form-group">
                <label>{t('form.intangible')}</label>
                <textarea className="form-control" rows="3" value={intangible}
                  onChange={e => setIntangible(e.target.value)}
                  placeholder={t('form.intangible_ph')} />
              </div>
            </div>
            <div className="form-group">
              <label>{t('form.impact_areas')}</label>
              <div style={{ display:'flex',flexWrap:'wrap',gap:8,marginTop:4 }}>
                {categories.map(a => (
                  <div key={a} className={`impact-chip${impactAreas.includes(a)?' selected':''}`}
                    data-val={a} onClick={() => toggleImpact(a)}>{translateArea(a, t)}</div>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>{t('form.impact_level')}</label>
              <select className="form-control" value={impactLevel} onChange={e => setImpactLevel(e.target.value)}>
                {IMPACT_LEVELS.map(l => <option key={l} value={l}>{translateImpact(l, t)}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Business Case */}
        {step === 3 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div style={{ marginBottom:4,fontSize:13,fontWeight:600,color:'var(--heading)' }}>{t('form.bc_heading')}</div>
            <div style={{ marginBottom:16,fontSize:12,color:'var(--subtle)' }}>{t('form.bc_hint')}</div>

            <div className="form-row">
              <div className="form-group">
                <label>{t('form.investment')} <span style={{ fontWeight:400,fontSize:11,color:'var(--subtle)' }}>(₹ INR)</span></label>
                {/* Amounts are in INR by default — a fixed ₹ adornment sits in
                    front of the field so the currency is never ambiguous. */}
                <div style={{ display:'flex',alignItems:'stretch' }}>
                  <span style={{ display:'inline-flex',alignItems:'center',padding:'0 12px',background:'var(--panel-bg)',border:'1px solid var(--border)',borderRight:'none',borderRadius:'6px 0 0 6px',fontWeight:600,color:'var(--heading)' }}>₹</span>
                  <input className="form-control" style={{ borderRadius:'0 6px 6px 0' }} value={investment} maxLength={255} inputMode="decimal"
                    onChange={e => setInvestment(e.target.value)}
                    placeholder={t('form.investment_ph')} />
                </div>
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('form.amount_inr')}</div>
              </div>
              <div className="form-group">
                <label>{t('form.feasibility')}</label>
                <select className="form-control" value={feasibility} onChange={e => setFeasibility(e.target.value)}>
                  <option value="">{t('form.feas_none')}</option>
                  {FEASIBILITY_LEVELS.map(l => <option key={l} value={l}>{translateImpact(l, t)}</option>)}
                </select>
              </div>
            </div>

            {/* "date or duration" — either answer is valid, so both are offered
                and neither is required. */}
            <div className="form-group">
              <label>{t('form.impl_time')}</label>
              <div className="form-row" style={{ marginTop:4 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <input className="form-control" value={implDuration} maxLength={120}
                    onChange={e => setImplDuration(e.target.value)}
                    placeholder={t('form.impl_duration_ph')} aria-label={t('form.impl_duration')} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <input className="form-control" type="date" value={implDate}
                    onChange={e => setImplDate(e.target.value)} aria-label={t('form.impl_date')} />
                </div>
              </div>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>
                {t('form.impl_duration')} · {t('form.impl_date')}
              </div>
            </div>

            <div className="form-group">
              <label>{t('form.benefits')}</label>
              <textarea className="form-control" rows="3" value={benefits}
                onChange={e => setBenefits(e.target.value)}
                placeholder={t('form.benefits_ph')} />
              {/* Supporting document for the expected benefits (a costing sheet,
                  projection, before/after data) attaches under this field. */}
              <label style={{ marginTop:10,display:'block' }}>{t('form.attach_benefits')}</label>
              <input type="file" className="form-control" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={e => setFileBen(e.target.files[0]||null)} />
              {fileBen && <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>{fileBen.name}</div>}
            </div>
            <div className="form-group">
              <label>{t('form.support')}</label>
              <textarea className="form-control" rows="3" value={support}
                onChange={e => setSupport(e.target.value)}
                placeholder={t('form.support_ph')} />
              {/* Documents backing up the requested support (a quote, spec,
                  approval note) attach right here, under the field they relate
                  to. Uploaded after the idea is created — see uploadFiles(). */}
              <label style={{ marginTop:10,display:'block' }}>{t('form.attach_support')}</label>
              <input type="file" className="form-control" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={e => setFileSup(e.target.files[0]||null)} />
              {fileSup && <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>{fileSup.name}</div>}
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('form.attach_note')}</div>
            </div>
          </div>
        )}

        {/* Step 4: Attachments */}
        {step === 4 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div className="form-group">
              <label>{t('form.attach_situation')}</label>
              <input type="file" className="form-control" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={e => setFileSit(e.target.files[0]||null)} />
              {fileSit && <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>{fileSit.name}</div>}
            </div>
            <div className="form-group">
              <label>{t('form.attach_solution')}</label>
              <input type="file" className="form-control" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={e => setFileSol(e.target.files[0]||null)} />
              {fileSol && <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>{fileSol.name}</div>}
            </div>
            <div style={{ fontSize:12,color:'var(--subtle)' }}>{t('form.attach_note')}</div>
          </div>
        )}

        {/* Step 5: Co-Suggesters — add as many colleagues as you like */}
        {step === 5 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div className="form-group">
              <label>{t('form.co_suggesters')}</label>
              <div className="pos-rel">
                <input className="form-control" value={coQuery}
                  onChange={e => { setCoQuery(e.target.value); searchCoSuggesters(e.target.value); }}
                  placeholder={t('form.co_search_ph')} />
                {coResults.length > 0 && (
                  <div className="user-search-results" style={{ display:'block' }}>
                    {coResults.map(u => (
                      <div key={u.id} className="uitem" onClick={() => addCoSuggester(u)}>
                        {u.name} · {u.employee_id} · {u.department||'–'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('form.co_hint')}</div>
            </div>

            {coSuggesters.length > 0 && (
              <div style={{ display:'flex',flexWrap:'wrap',gap:8,marginTop:6 }}>
                {coSuggesters.map(c => (
                  <span key={c.id} className="chip" style={{ display:'inline-flex',alignItems:'center',gap:6 }}>
                    {c.label}
                    <button type="button" onClick={() => removeCoSuggester(c.id)}
                      aria-label={t('btn.remove')}
                      style={{ border:'none',background:'none',cursor:'pointer',color:'var(--danger)',fontSize:14,lineHeight:1,padding:0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Review & Submit */}
        {step === 6 && (
          <div style={{ animation:'fadeInUp .25s cubic-bezier(.4,0,.2,1)' }}>
            <div style={{ marginBottom:16,fontSize:13,fontWeight:600,color:'var(--heading)' }}>{t('form.review_heading')}</div>

            <div className="form-group">
              <label>{t('preview.title_label')}</label>
              <div className="form-control" style={{ background:'var(--panel-bg)' }}>{title}</div>
            </div>
            <div className="form-group">
              <label>{t('preview.situation')}</label>
              <div className="form-control" style={{ background:'var(--panel-bg)',height:'auto',minHeight:60 }}>{situation}</div>
            </div>
            <div className="form-group">
              <label>{t('preview.solution')}</label>
              <div className="form-control" style={{ background:'var(--panel-bg)',height:'auto',minHeight:60 }}>{solution}</div>
            </div>
            <div className="form-row">
              <div>
                <label>{t('preview.impact_areas')}</label>
                <div className="form-control" style={{ background:'var(--panel-bg)' }}>
                  {impactAreas.map(a => translateArea(a, t)).join(', ') || t('preview.none_selected')}
                </div>
              </div>
              <div>
                <label>{t('preview.impact_level')}</label>
                <div className="form-control" style={{ background:'var(--panel-bg)' }}>{translateImpact(impactLevel, t)}</div>
              </div>
            </div>
            {/* Business case — only the answers that were actually given, so a
                lightly-filled form does not review as a wall of blanks. */}
            {[[t('form.investment'), investment ? `₹ ${investment}` : ''],
              [t('form.feasibility'), feasibility ? translateImpact(feasibility, t) : ''],
              [t('form.impl_time'), [implDuration, implDate].filter(Boolean).join(' · ')],
              [t('form.benefits'), benefits],
              [t('form.support'), support],
            ].filter(([, v]) => v).map(([label, v]) => (
              <div className="form-group" key={label}>
                <label>{label}</label>
                <div className="form-control" style={{ background:'var(--panel-bg)',height:'auto',minHeight:38 }}>{v}</div>
              </div>
            ))}

            {coSuggesters.length > 0 && (
              <div className="form-group">
                <label>{t('preview.co_suggesters')}</label>
                <div className="form-control" style={{ background:'var(--panel-bg)' }}>{coSuggesters.map(c => c.label).join(', ')}</div>
              </div>
            )}

            <div className="form-row" style={{ marginTop:16,gap:20 }}>
              <div className="form-group">
                <label>{t('form.template')}</label>
                <select className="form-control" value={templateType} onChange={e => setTemplateType(e.target.value)}>
                  <option value="">{t('form.no_template')}</option>
                  <option value="cost">{t('form.tpl_cost')}</option>
                  <option value="quality">{t('form.tpl_quality')}</option>
                  <option value="safety">{t('form.tpl_safety')}</option>
                  <option value="process">{t('form.tpl_process')}</option>
                </select>
              </div>
              {challenges.length > 0 && (
                <div className="form-group">
                  <label>{t('form.challenge')}</label>
                  <select className="form-control" id="idea-challenge" value={challengeId} onChange={e => setChallengeId(e.target.value)}>
                    <option value="">{t('form.no_challenge')}</option>
                    {challenges.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              )}
            </div>

            <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,marginTop:8 }}>
              <input type="checkbox" id="idea-anonymous" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} style={{ accentColor:'var(--primary)' }} />
              {t('form.anonymous')}
            </label>

            <div id="wizard-submit-row" style={{ display:'flex',gap:10,marginTop:24 }}>
              <button className="btn btn-success" disabled={submitting} onClick={handleSubmit}>
                {submitting ? t('msg.loading') : t('form.submit_idea')}
              </button>
              <button className="btn btn-outline" disabled={submitting} onClick={handleSaveDraft}>
                {t('form.save_draft')}
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        {step < 6 && (
          <div id="wizard-nav" style={{ display:'flex',justifyContent:'space-between',marginTop:24 }}>
            <button className="btn btn-outline" style={{ visibility:step>1?'visible':'hidden' }} onClick={() => goStep(step-1)}>
              ← {t('btn.back')}
            </button>
            <button className="btn btn-primary" onClick={() => goStep(step+1)}>
              {step === 5 ? t('btn.review') : t('btn.next')} →
            </button>
          </div>
        )}

        {step === 6 && (
          <div style={{ marginTop:12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => goStep(step-1)}>← {t('btn.back')}</button>
          </div>
        )}
      </div>
    </>
  );
}
