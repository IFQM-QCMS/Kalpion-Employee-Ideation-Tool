import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { challengesApi } from '../services/api';
import { isPrivileged, fmtDate, parseServerDate } from '../utils/helpers';

export default function ChallengesPage() {
  const { user }       = useAuth();
  const { t }          = useLang();
  const { showToast }  = useToast();
  const navigate       = useNavigate();
  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const isPriv = isPrivileged(user?.role);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await challengesApi.list();
      if (res.data.success) setList(res.data.challenges || []);
      else setError(res.data.error || t('challenges.load_failed'));
    } catch { setError(t('challenges.load_failed')); }
    setLoading(false);
  }

  async function handleCreate() {
    const title = prompt(t('challenges.prompt_title'));
    if (!title?.trim()) return;
    const desc     = prompt(t('challenges.prompt_desc')) || '';
    const deadline = prompt(t('challenges.prompt_deadline')) || null;
    try {
      const res = await challengesApi.create({ title: title.trim(), description: desc, deadline: deadline || null });
      if (res.data.success) { showToast(t('challenges.created'), 'success'); load(); }
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  async function handleClose(id) {
    if (!confirm(t('challenges.confirm_close'))) return;
    try {
      const res = await challengesApi.update({ id, status: 'closed' });
      if (res.data.success) { showToast(t('challenges.closed'), 'success'); load(); }
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <>
      <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:16 }}>
        {isPriv && (
          <button className="btn btn-primary btn-sm" id="btn-new-challenge" onClick={handleCreate}>
            {t('challenges.new')}
          </button>
        )}
      </div>

      {error   && <div className="alert alert-danger">{error}</div>}

      {/*
        One row per challenge.
        The deadline is the fact people come to this page for, and in a column
        it can be compared across challenges — which was impossible when it sat
        inline in a sentence whose length varied with the creator's name.

        Expiry was also computed three separate times inside the old card, once
        per thing that depended on it, each with its own copy of the rule. They
        could not disagree today, but the next edit to one of them is exactly
        how they would start to. It is decided once, per row, here.
      */}
      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('challenges.col_title')}</th>
              <th>{t('table.created_by')}</th>
              <th>{t('table.deadline')}</th>
              <th>{t('table.ideas')}</th>
              <th>{t('table.status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="challenges-list">
            {loading && <tr><td colSpan="6" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !error && !list.length && (
              <tr><td colSpan="6" className="text-center">{t('challenges.none')}</td></tr>
            )}
            {list.map(c => {
              // parseServerDate, not new Date: the API sends naive datetimes and
              // reading them as local time made a challenge look closed hours
              // before it was — or still open hours after it shut.
              const due     = parseServerDate(c.deadline);
              const expired = c.status === 'closed' || (due && due.getTime() < Date.now());
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight:600,color:'var(--heading)' }} title={c.title}>
                      <div className="cell-clamp" style={{ maxWidth:280 }}>{c.title}</div>
                    </div>
                    {c.description && (
                      <div className="cell-clamp" style={{ maxWidth:280,fontSize:12,color:'var(--text-muted)',marginTop:2 }}
                           title={c.description}>
                        {c.description}
                      </div>
                    )}
                  </td>
                  <td>{c.creator_name||'—'}</td>
                  <td style={{ whiteSpace:'nowrap' }}>
                    {c.deadline
                      ? <span className={`chip ${expired ? 'chip-danger' : ''}`}>{fmtDate(c.deadline)}</span>
                      : <span style={{ color:'var(--subtle)' }}>{t('challenges.no_deadline')}</span>}
                  </td>
                  <td>{c.idea_count||0}</td>
                  <td>
                    {/* chip-*, not badge-*: badge classes are per-status
                        (badge-approved, badge-rejected...) and a challenge has
                        no idea status. badge-success/badge-danger were never
                        defined in the stylesheet at all. */}
                    <span className={`chip ${expired ? 'chip-danger' : 'chip-success'}`}>
                      {expired ? t('challenges.status_closed') : t('challenges.status_active')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end' }}>
                      {!expired && (
                        <button className="btn btn-primary btn-sm" onClick={() => navigate('/submit')}>
                          {t('challenges.submit_for')}
                        </button>
                      )}
                      {isPriv && c.status === 'active' && (
                        <button className="btn btn-outline btn-sm" onClick={() => handleClose(c.id)}>
                          {t('challenges.close')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
