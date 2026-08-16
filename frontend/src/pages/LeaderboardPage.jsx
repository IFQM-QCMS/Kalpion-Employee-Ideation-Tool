import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLang } from '../context/LangContext';
import { leaderboardApi } from '../services/api';
import { scoreBadgeClass, engagementIndex } from '../utils/helpers';
import InfoDot from '../components/InfoDot';
import { drawPersonalCard, drawPodiumCard, canvasToBlob, shareImage } from '../utils/shareCard';

const PERIODS = [
  { val:'all',       label:'lb.all' },
  { val:'weekly',    label:'lb.weekly' },
  { val:'monthly',   label:'lb.monthly' },
  { val:'quarterly', label:'lb.quarterly' },
  { val:'yearly',    label:'lb.yearly' },
];

function EngBadge({ aiScore, avgRating, voteCount, t }) {
  const ei = engagementIndex(aiScore, avgRating, voteCount);
  if (!aiScore && !voteCount) return null;
  const tier = ei >= 70 ? { bg:'#bbf7d0',color:'#065f46',lbl:t('eng.high') }
             : ei >= 40 ? { bg:'#fef3c7',color:'#92400e',lbl:t('eng.med')  }
             : { bg:'#fee2e2',color:'#991b1b',lbl:t('eng.low') };
  return (
    <span style={{ fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:20,background:tier.bg,color:tier.color,border:`1px solid ${tier.bg}`,display:'inline-block' }}>
      EI:{ei} {tier.lbl}
    </span>
  );
}

/* Rank numerals for the top three. Emoji medals were removed from every
   dashboard: they render differently on each platform, carry no meaning to a
   screen reader, and read as decoration on a screen about people's work. */
const MEDAL = ['1st', '2nd', '3rd'];

/**
 * Podium for the top three, ordered 2 – 1 – 3 so the winner stands centre and
 * tallest, the way a real podium reads. Below ~640px it collapses to a single
 * column in rank order, since three narrow columns turn the names into ellipses.
 */
function Podium({ rows, meId, t }) {
  if (!rows.length) return null;
  // Visual order (2nd, 1st, 3rd) with the true rank carried on each entry.
  const order = [1, 0, 2].filter((i) => rows[i]);
  const HEIGHT = { 0: 108, 1: 78, 2: 60 };
  const TINT = {
    0: { from: '#fbbf24', to: '#f59e0b', ring: 'rgba(245,158,11,.45)' },
    1: { from: '#cbd5e1', to: '#94a3b8', ring: 'rgba(148,163,184,.40)' },
    2: { from: '#d8a47f', to: '#b87333', ring: 'rgba(184,115,51,.38)' },
  };

  return (
    <div className="lb-podium">
      <style>{`
        .lb-podium{display:flex;align-items:flex-end;justify-content:center;gap:18px;
          padding:26px 10px 6px;flex-wrap:nowrap}
        .lb-podium .pod{display:flex;flex-direction:column;align-items:center;flex:1 1 0;max-width:210px;min-width:0}
        .lb-podium .crown{font-size:26px;line-height:1;margin-bottom:6px;
          filter:drop-shadow(0 4px 10px rgba(0,0,0,.18))}
        .lb-podium .pod-avatar{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;
          justify-content:center;font-weight:800;font-size:20px;color:#fff;margin-bottom:9px;
          border:3px solid var(--surface)}
        .lb-podium .pod-name{font-size:13.5px;font-weight:750;color:var(--heading);text-align:center;
          max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lb-podium .pod-dept{font-size:11px;color:var(--text-muted);margin-top:2px;text-align:center;
          max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lb-podium .pod-pts{font-size:16px;font-weight:820;color:var(--heading);margin-top:7px;
          font-variant-numeric:tabular-nums}
        .lb-podium .pod-pts small{font-size:10.5px;font-weight:600;color:var(--text-muted);margin-left:3px}
        .lb-podium .pod-block{width:100%;border-radius:12px 12px 0 0;margin-top:11px;
          display:flex;align-items:flex-start;justify-content:center;padding-top:9px;
          font-size:19px;font-weight:850;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.22)}
        .lb-podium .you{font-size:10px;font-weight:700;color:#b45309;background:#fef3c7;
          border-radius:999px;padding:1px 7px;margin-top:4px}
        @media (max-width:640px){
          .lb-podium{flex-direction:column;align-items:stretch;gap:10px}
          .lb-podium .pod{flex-direction:row;gap:12px;max-width:none;align-items:center;
            background:var(--panel-bg);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
          .lb-podium .pod-block{display:none}
          .lb-podium .crown{margin:0;font-size:22px}
          .lb-podium .pod-avatar{margin:0;width:44px;height:44px;font-size:16px}
          .lb-podium .pod-name,.lb-podium .pod-dept{text-align:left}
          .lb-podium .pod-body{flex:1;min-width:0}
          .lb-podium .pod-pts{margin:0}
        }
      `}</style>
      {order.map((idx) => {
        const u = rows[idx];
        const tint = TINT[idx];
        return (
          <div className="pod" key={u.id}>
            <div className="crown" aria-hidden="true">{MEDAL[idx]}</div>
            <div className="pod-avatar"
              style={{ background:`linear-gradient(140deg,${tint.from},${tint.to})`,
                       boxShadow:`0 8px 22px -6px ${tint.ring}` }}>
              {u.avatar_initials || u.name?.[0] || '?'}
            </div>
            <div className="pod-body">
              <div className="pod-name" title={u.name}>{u.name}</div>
              <div className="pod-dept">{u.department || '–'}</div>
              {String(u.id) === String(meId) && <div className="you">{t('lb.you')}</div>}
            </div>
            <div className="pod-pts">{u.points}<small>{t('unit.pts')}</small></div>
            <div className="pod-block"
              style={{ height:HEIGHT[idx], background:`linear-gradient(180deg,${tint.from},${tint.to})` }}>
              {idx + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LeaderboardPage() {
  const { user }  = useAuth();
  const { t }     = useLang();
  const { showToast } = useToast();
  const [period,  setPeriod]  = useState('all');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => { load(); }, [period]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await leaderboardApi.get({ period });
      setData(res.data);
    } catch { setError(t('msg.fail_leaderboard')); }
    setLoading(false);
  }

  // Animate bars after data
  useEffect(() => {
    if (!data) return;
    setTimeout(() => {
      document.querySelectorAll('.progress-fill[data-w], #lb-departments .bar-fill[data-w]').forEach((bar, i) => {
        setTimeout(() => {
          bar.style.transition = 'width .8s cubic-bezier(.4,0,.2,1)';
          bar.style.width = bar.dataset.w + '%';
        }, i * 80);
      });
    }, 200);
  }, [data]);

  /*
   * Sharing produces a picture, not a line of text. Nobody posts a paste of
   * "1. Priya - 240 pts"; people do post a card with their name and rank on it.
   *
   * The card is drawn on a canvas in the browser: no library, no upload, and
   * nothing about any idea on it - names, points and idea counts only. On a
   * phone it goes straight into the native share sheet; on a desktop, where
   * browsers cannot share files, it downloads so it can be attached anywhere.
   */
  const shareRef = useRef(null);

  const periodLabel = () =>
    t(PERIODS.find((p) => p.val === period)?.label || 'lb.all');

  async function shareCard(kind) {
    const rows = data?.individuals || [];
    if (!rows.length) return;
    const canvas = shareRef.current;
    if (!canvas) return;

    const orgName = user?.org_name || 'IFQM';
    let filename;
    let text;

    if (kind === 'personal') {
      const idx = rows.findIndex((r) => Number(r.id) === Number(user?.id));
      const me = idx >= 0 ? rows[idx] : null;
      if (!me) { showToast(t('lb.share_no_rank'), 'info'); return; }
      drawPersonalCard(canvas, {
        orgName, name: me.name, rank: idx + 1,
        points: me.points, ideas: me.ideas_count ?? me.idea_count ?? 0,
        periodLabel: periodLabel(),
      });
      filename = 'my-idea-score.png';
      text = `${me.name} — #${idx + 1} on the ${orgName} idea leaderboard, ${me.points} ${t('unit.pts')}.`;
    } else {
      drawPodiumCard(canvas, { orgName, rows, periodLabel: periodLabel() });
      filename = 'idea-leaderboard.png';
      text = `${t('lb.share_title')} — ${orgName}`;
    }

    try {
      const blob = await canvasToBlob(canvas);
      if (!blob) { showToast(t('msg.error'), 'danger'); return; }
      const how = await shareImage(blob, filename, text);
      showToast(how === 'shared' ? t('lb.share_ok') : t('lb.share_saved'), 'success');
    } catch (e) {
      // AbortError is the user closing the share sheet — not a failure.
      if (e?.name !== 'AbortError') showToast(t('msg.error'), 'danger');
    }
  }

  /* Text remains available for anyone who wants to paste it into a chat. */
  async function shareLeaderboardText() {
    const rows = (data?.individuals || []).slice(0, 5);
    if (!rows.length) return;
    const medals = ['1.', '2.', '3.', '4.', '5.'];
    const text = [
      `${t('lb.share_title')} — ${user?.org_name || 'IFQM'}`,
      ...rows.map((u, i) => `${medals[i]} ${u.name} — ${u.points} ${t('unit.pts')}`),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      showToast(t('lb.share_copied'), 'success');
    } catch { showToast(t('msg.error'), 'danger'); }
  }

  const activeIndivs = (data?.individuals || []).filter(u => Number(u.points) > 0 || Number(u.idea_count || u.ideas_count || 0) > 0);
  const indivs = activeIndivs;
  const depts  = data?.departments || [];
  const top    = data?.top_ideas   || [];
  const maxPts = Math.max(...indivs.map(u => u.points), 1);
  const maxDpt = Math.max(...depts.map(d => d.dept_points||0), 1);

  return (
    <>
      {/* Period chips + share. */}
      <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:20 }}>
      <div className="chip-filter" style={{ marginBottom:0 }}>
        {PERIODS.map(p => (
          <div
            key={p.val}
            className={`chip${period===p.val?' active':''}`}
            data-val={p.val}
            onClick={() => setPeriod(p.val)}
          >
            {t(p.label)}
          </div>
        ))}
      </div>
        <div style={{ display:'flex',gap:8,marginLeft:'auto',flexWrap:'wrap' }}>
          <button className="btn btn-primary btn-sm"
            onClick={() => shareCard('personal')} disabled={!indivs.length}>
            {t('lb.share_mine')}
          </button>
          <button className="btn btn-outline btn-sm"
            onClick={() => shareCard('podium')} disabled={!indivs.length}>
            {t('lb.share_top5')}
          </button>
          <button className="btn btn-outline btn-sm"
            onClick={shareLeaderboardText} disabled={!indivs.length}>
            {t('lb.share_text')}
          </button>
        </div>
      </div>

      {/* Off-screen scratch surface the share cards are painted on. */}
      <canvas ref={shareRef} style={{ display:'none' }} aria-hidden="true" />

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && (
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20 }}>
          {/* Individuals */}
          <div className="card" style={{ gridColumn:'1/3' }}>
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14,color:'var(--heading)' }}>{t('lb.top_employees')}<InfoDot term="engagement_index" /></div>

            {!indivs.length ? (
              <div className="empty-state">{t('msg.no_leaderboard')}</div>
            ) : (
              <>
                <Podium rows={indivs.slice(0, 3)} meId={user?.id} t={t} />

                <div id="lb-individuals">
                  {indivs.slice(3).map((u, iOffset) => {
                    const i = iOffset + 3;
                    const ei = engagementIndex(u.avg_score, u.avg_community_rating, u.total_votes_received);
                    return (
                      <div className="lb-row" key={u.id}>
                        <div className={`lb-rank ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-n'}`}>{i+1}</div>
                        <div className="avatar">{u.avatar_initials||u.name?.[0]||'?'}</div>
                        <div style={{ flex:1 }}>
                          <div className="lb-name">
                            {u.name}
                            {u.id == user?.id && <span style={{ fontSize:11,color:'#f59e0b',marginLeft:4 }}>{t('lb.you')}</span>}
                          </div>
                          <div className="lb-dept">{u.department||'–'}</div>
                          <div className="progress-bar" style={{ marginTop:8 }}>
                            <div className="progress-fill" style={{ width:'0%' }} data-w={Math.round(u.points/maxPts*100)}></div>
                          </div>
                          {(u.avg_community_rating > 0 || u.total_votes_received > 0) && (
                            <div style={{ marginTop:4,fontSize:11,color:'var(--subtle)',display:'flex',gap:6 }}>
                              {u.avg_community_rating > 0 && <span>{parseFloat(u.avg_community_rating).toFixed(1)} avg rating</span>}
                              {u.total_votes_received > 0 && <span>{u.total_votes_received} votes</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div className="lb-points">{u.points} {t('unit.pts')}</div>
                          <div className="lb-ideas">{u.idea_count||0} {t('unit.ideas')}</div>
                          {u.avg_score > 0 && (
                            <span className={`${scoreBadgeClass(u.avg_score)}`} style={{ marginTop:2,display:'inline-block' }}>
                              {t('lb.avg_score')}: {u.avg_score}
                            </span>
                          )}
                          <div style={{ marginTop:4 }}>
                            <EngBadge aiScore={u.avg_score} avgRating={u.avg_community_rating} voteCount={u.total_votes_received} t={t} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Department bar chart */}
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14,color:'var(--heading)' }}>{t('lb.by_dept')}</div>
            <div id="lb-departments">
              <div className="bar-chart">
                {depts.map(dep => (
                  <div className="bar-row" key={dep.department||'–'}>
                    <span className="bar-label">{(dep.department||'–').substring(0,12)}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width:'0%',background:'linear-gradient(90deg,#374151,#6b7280)' }}
                        data-w={Math.round((dep.dept_points||0)/maxDpt*100)}></div>
                    </div>
                    <span className="bar-val">{dep.dept_points||0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Scored Ideas */}
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14,color:'var(--heading)' }}>{t('lb.top_ideas')}</div>
            <div id="lb-top-ideas">
              {!top.length
                ? <div className="empty-state">{t('msg.no_leaderboard')}</div>
                : top.map((idea, idx) => (
                  <div className="top-idea-row" key={idea.id||idx}>
                    <div className="top-idea-rank">#{idx+1}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13,fontWeight:600,color:'var(--heading)' }}>{idea.title}</div>
                      <div style={{ fontSize:11,color:'var(--subtle)' }}>{idea.idea_code} · {idea.submitter_name} · {idea.department||'–'}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <span className={scoreBadgeClass(idea.ai_score)}>{idea.ai_score}/100</span>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </>
  );
}
