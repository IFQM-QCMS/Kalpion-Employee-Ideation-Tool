import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { usersApi } from '../services/api';
import { isPrivileged, translateStatus, translateArea } from '../utils/helpers';
import { Donut, Legend, AreaChart, Gauge, STATUS_COLORS, colorAt } from '../components/Charts';

// Distinct accent per KPI card — colourful but each hue is validated.
const KPI_ACCENTS = ['#2a78d6', '#1baf7a', '#4a3aa7', '#eda100'];

export default function AnalyticsPage() {
  const { user }   = useAuth();
  const { t }      = useLang();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    if (!isPrivileged(user?.role)) {
      setError(t('msg.analytics_restricted'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await usersApi.analytics();
      if (res.data.success) setData(res.data);
      else setError(res.data.error || t('msg.fail_analytics'));
    } catch { setError(t('msg.fail_analytics')); }
    setLoading(false);
  }

  // Animate KPI counters + bar widths once data lands.
  useEffect(() => {
    if (!data) return;
    document.querySelectorAll('#analytics-kpis .kpi-val[data-target]').forEach(el => {
      const suffix = el.dataset.suffix || '';
      const target = parseInt(el.dataset.target);
      const start  = performance.now();
      (function step(now) {
        const p    = Math.min((now - start) / 900, 1);
        const ease = 1 - Math.pow(1-p, 3);
        el.textContent = Math.round(target * ease) + suffix;
        if (p < 1) requestAnimationFrame(step);
      })(start);
    });
    setTimeout(() => {
      document.querySelectorAll('.analytics-bars .bar-fill[data-w]').forEach((bar, i) => {
        setTimeout(() => {
          bar.style.transition = 'width .7s cubic-bezier(.4,0,.2,1)';
          bar.style.width = bar.dataset.w + '%';
        }, i * 70);
      });
    }, 150);
  }, [data]);

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  if (error)   return <div className="alert alert-warning">{error}</div>;
  if (!data)   return null;

  const counts  = {};
  (data.status_summary||[]).forEach(s => { counts[s.status] = s.cnt; });
  const total   = Object.values(counts).reduce((a,b)=>a+b,0);
  const approved = (counts['Approved']||0) + (counts['Implemented']||0);
  // counts['Implemented'] is deliberately NOT read here any more: MOM 22
  // defines both implementation metrics against ideas forwarded to QC, and
  // leaving the old variable in place is how the wrong number finds its way
  // back into a label.
  const ss       = data.score_stats || {};
  const hq = parseInt(ss.high_quality||0);
  const mq = parseInt(ss.medium_quality||0);
  const lq = parseInt(ss.low_quality||0);
  const maxQ = Math.max(hq,mq,lq,1);
  const trend = [...(data.trend||[])].reverse();
  const maxTrend = Math.max(...trend.map(x=>x.total), 1);
  const impDist  = Object.entries(data.impact_distribution||{});
  const maxImp   = Math.max(...impDist.map(([,v])=>v), 1);

  // Donut data for the status split.
  const statusDonut = (data.status_summary||[])
    .map(s => ({ label: translateStatus(s.status, t), value: Number(s.cnt), color: STATUS_COLORS[s.status] || '#94a3b8' }))
    .filter(d => d.value > 0);

  /*
   * MOM §22 defines both of these against ideas FORWARDED TO QC, not against
   * the status column.
   *
   * They are different populations and the difference is not cosmetic. An idea
   * reaches the QC tool when it is pushed and QCMS accepts it; its status may
   * sit at Approved for weeks afterwards while the work is scheduled. This used
   * to report `counts['Implemented']` under the label "Ideas forwarded to QC",
   * which was a label over the wrong number — the figure moved when somebody
   * marked an idea implemented, not when it actually went across.
   *
   *   Implementation Rate      what share of all ideas reached QC
   *   Implementation Velocity  how many reached it in the last 30 days
   *
   * Velocity is a COUNT, not a percentage: "18 ideas pushed this month" is a
   * pace, which is what velocity means, and a percentage of a moving total is
   * not.
   */
  const qcms = data.qcms || {};
  const pushed = Number(qcms.pushed) || 0;
  const pushed30 = Number(qcms.pushed_30d) || 0;

  const kpis = [
    [t('dash.total'), total, '', paletteIcon('bulb'), 'Total Ideas Submitted'],
    [t('analytics.approval_rate'), total ? Math.round(approved/total*100) : 0, '%', paletteIcon('check'), 'Approved & Implemented Rate'],
    [t('analytics.impl_rate'), total ? Math.round(pushed/total*100) : 0, '%', paletteIcon('rocket'), t('analytics.impl_rate_sub')],
    [t('analytics.impl_velocity'), pushed30, '', paletteIcon('rocket'), t('analytics.impl_velocity_sub')],
    [t('analytics.avg_score'), ss.overall_avg||0, '', paletteIcon('star'), t('analytics.avg_score_sub')],
  ];

  return (
    <>
      {/* Header Executive Banner */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:24,fontWeight:800,color:'var(--heading)',margin:0,letterSpacing:'-.4px' }}>
            {t('analytics.title') || 'Executive Analytics Dashboard'}
          </h1>
          <div style={{ fontSize:13,color:'var(--subtle)',marginTop:3 }}>
            Real-time innovation pipeline performance, quality metrics, and category distribution.
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid" id="analytics-kpis">
        {kpis.map(([label, val, suffix, icon, hint], i) => {
          const c = KPI_ACCENTS[i % KPI_ACCENTS.length];
          return (
            <div key={label} className="card" style={{ padding: '16px 18px', borderTop: `4px solid ${c}`, borderRadius: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 125 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ background: tint(c), color: c, borderRadius: 10, padding: '8px 10px', display: 'inline-flex', alignItems: 'center' }}>{icon}</div>
                <span style={{ fontSize: 10.5, fontWeight: 700, background: tint(c), color: c, padding: '3px 10px', borderRadius: 12 }}>
                  {hint}
                </span>
              </div>
              <div>
                <div className="kpi-val" data-target={val} data-suffix={suffix} style={{ color: c, fontSize: 30, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.1 }}>0{suffix}</div>
                <div style={{ fontWeight: 650, fontSize: 13, color: 'var(--heading)', marginTop: 6 }}>{label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="analytics-bars" style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginTop:20 }}>
        {/* Status Distribution — donut */}
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('analytics.status_dist')}</div>
            <span style={{ fontSize:11,color:'var(--subtle)',fontWeight:600 }}>{total} Total Ideas</span>
          </div>
          {total === 0
            ? <div className="empty-state">{t('analytics.no_trend')}</div>
            : (
              <div style={{ display:'flex',alignItems:'center',gap:22,flexWrap:'wrap',padding:'10px 0' }}>
                <Donut data={statusDonut} centerValue={total} centerLabel={t('dash.total')} />
                <div style={{ flex:1,minWidth:150 }}><Legend items={statusDonut} /></div>
              </div>
            )
          }
        </div>

        {/* Impact Distribution — colourful bars */}
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('analytics.impact_dist')}</div>
            <span style={{ fontSize:11,color:'var(--subtle)',fontWeight:600 }}>{t('anl.categories_split')}</span>
          </div>
          <div className="bar-chart" id="analytics-impact">
            {impDist.length
              ? impDist.map(([k,v], i) => (
                <div className="bar-row" key={k} style={{ marginBottom: 10 }}>
                  <span className="bar-label" style={{ fontWeight: 600 }}>{translateArea(k, t)}</span>
                  <div className="bar-track" style={{ height: 8, borderRadius: 999, background: 'var(--border)' }}>
                    <div className="bar-fill" style={{ width:'0%',height:'100%',borderRadius:999,background:grad(colorAt(i)) }} data-w={Math.round(v/maxImp*100)}></div>
                  </div>
                  <span className="bar-val" style={{ fontWeight: 700, minWidth: 28, textAlign: 'right' }}>{v}</span>
                </div>
              ))
              : <div className="empty-state">{t('analytics.no_trend')}</div>
            }
          </div>
        </div>

        {/* Monthly Trend — smooth gradient area chart */}
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('analytics.monthly_trend')}</div>
            <span style={{ fontSize:11,color:'var(--primary)',fontWeight:700 }}>12-Month Progression</span>
          </div>
          {trend.length
            ? <AreaChart data={trend.map(r => ({ label: r.month.slice(5), value: r.total }))} color="#2a78d6" />
            : <div className="empty-state">{t('analytics.no_trend')}</div>
          }
        </div>

        {/* Score Distribution — gauge + quality split */}
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('analytics.score_dist')}</div>
            <span style={{ fontSize:11,color:'var(--success)',fontWeight:700 }}>{t('anl.ai_breakdown')}</span>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:20,flexWrap:'wrap' }}>
            <div style={{ textAlign:'center' }}>
              <Gauge value={Math.round(ss.overall_avg||0)} color={scoreColor(ss.overall_avg||0)} label="/ 100" />
            </div>
            <div className="bar-chart" style={{ flex:1,minWidth:170 }}>
              <div className="bar-row" style={{ marginBottom: 10 }}>
                <span className="bar-label" style={{ fontWeight: 600 }}>{t('analytics.high')}</span>
                <div className="bar-track" style={{ height: 8, borderRadius: 999 }}><div className="bar-fill" style={{ width:'0%',height:'100%',borderRadius:999,background:grad('#1baf7a') }} data-w={Math.round(hq/maxQ*100)}></div></div>
                <span className="bar-val" style={{ fontWeight: 700 }}>{hq}</span>
              </div>
              <div className="bar-row" style={{ marginBottom: 10 }}>
                <span className="bar-label" style={{ fontWeight: 600 }}>{t('analytics.med')}</span>
                <div className="bar-track" style={{ height: 8, borderRadius: 999 }}><div className="bar-fill" style={{ width:'0%',height:'100%',borderRadius:999,background:grad('#eda100') }} data-w={Math.round(mq/maxQ*100)}></div></div>
                <span className="bar-val" style={{ fontWeight: 700 }}>{mq}</span>
              </div>
              <div className="bar-row">
                <span className="bar-label" style={{ fontWeight: 600 }}>{t('analytics.low_score')}</span>
                <div className="bar-track" style={{ height: 8, borderRadius: 999 }}><div className="bar-fill" style={{ width:'0%',height:'100%',borderRadius:999,background:grad('#e34948') }} data-w={Math.round(lq/maxQ*100)}></div></div>
                <span className="bar-val" style={{ fontWeight: 700 }}>{lq}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// A 12%-opacity tint of a hex colour, for the icon chip background.
function tint(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},0.14)`;
}
// A subtle same-hue gradient for a bar fill (lighter → base).
function grad(hex) { return `linear-gradient(90deg,${hex}cc,${hex})`; }
// Gauge colour by quality-score band (green / amber / red; grey when unscored).
function scoreColor(v) { const n = Number(v) || 0; return n <= 0 ? '#94a3b8' : n >= 75 ? '#1baf7a' : n >= 50 ? '#eda100' : '#e34948'; }

function paletteIcon(name) {
  const common = { viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round', width:22, height:22 };
  if (name === 'bulb')   return <svg {...common}><path d="M9 21h6M12 3a6 6 0 016 6c0 2.2-1.1 3.8-2.5 5L15 16H9l-.5-2C7 12.8 6 11.2 6 9a6 6 0 016-6z"/></svg>;
  if (name === 'check')  return <svg {...common}><polyline points="20 6 9 17 4 12"/></svg>;
  if (name === 'rocket') return <svg {...common}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>;
  return <svg {...common}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>;
}
