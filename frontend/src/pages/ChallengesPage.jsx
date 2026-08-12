import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { challengesApi } from '../services/api';
import { isPrivileged, fmtDate } from '../utils/helpers';

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

      {loading && <div className="empty-state"><div className="spinner"></div> {t('msg.loading')}</div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && !list.length && (
        <div className="empty-state">{t('challenges.none')}</div>
      )}

      <div id="challenges-list">
        {list.map(c => (
          <div key={c.id} className="card" style={{ marginBottom:12 }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:15,fontWeight:600,color:'var(--heading)' }}>{c.title}</div>
                <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>
                  {t('challenges.by')} {c.creator_name||'—'} · {c.deadline ? `${t('challenges.deadline')} ${fmtDate(c.deadline)}` : t('challenges.no_deadline')} · {c.idea_count||0} {t('unit.ideas')}
                </div>
              </div>
              {(() => {
                const expired = c.status === 'closed' || (c.deadline && new Date(c.deadline).getTime() < Date.now());
                return (
                  <span style={{
                    padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,
                    background:!expired ? '#bbf7d0' : '#fee2e2',
                    color:!expired ? '#065f46' : '#991b1b',
                    border:`1px solid ${!expired ? '#bbf7d0' : '#fecaca'}`
                  }}>{!expired ? t('challenges.status_active') : t('challenges.status_closed')}</span>
                );
              })()}
            </div>
            {c.description && (
              <div style={{ marginTop:10,fontSize:13,color:'var(--text)' }}>{c.description}</div>
            )}
            <div style={{ marginTop:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
              {(() => {
                const isExpired = c.status === 'closed' || (c.deadline && new Date(c.deadline).getTime() < Date.now());
                if (!isExpired) {
                  return (
                    <button className="btn btn-primary btn-sm" onClick={() => navigate('/submit')}>
                      {t('challenges.submit_for')}
                    </button>
                  );
                }
                return (
                  <span style={{ padding:'4px 12px',borderRadius:20,fontSize:11.5,fontWeight:700,background:'var(--danger-light)',color:'var(--danger)',border:'1px solid var(--danger-light)' }}>
                    ⏳ Deadline Passed (Closed)
                  </span>
                );
              })()}
              {isPriv && c.status === 'active' && (
                <button className="btn btn-outline btn-sm" onClick={() => handleClose(c.id)}>
                  {t('challenges.close')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
