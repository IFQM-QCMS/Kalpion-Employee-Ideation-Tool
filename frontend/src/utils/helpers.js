import { STATUS_KEYS, IMPACT_KEYS, AREA_KEYS, ROLE_KEYS } from '../i18n/translations';

export function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

export function fmtDate(dateStr) {
  if (!dateStr) return '–';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});
  } catch { return dateStr; }
}

/* Submission time matters as much as the date - two ideas filed on the same day
   are ordered by the clock, and people want to see that. Used everywhere an idea
   or a decision is stamped. */
export function fmtDateTime(dateStr) {
  if (!dateStr) return '–';
  try {
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return dateStr; }
}

export function timeAgo(dateStr, t) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (!t) return `${mins}m ago`;
  if (mins < 2)  return t('time.just_now');
  if (mins < 60) return t('time.min_ago', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return t('time.hr_ago', { n: hrs });
  return t('time.day_ago', { n: Math.floor(hrs / 24) });
}

export function statusBadge(status) {
  const map = {
    'Submitted':'badge-submitted',
    'Under Review':'badge-review',
    'Approved':'badge-approved',
    'Rejected':'badge-rejected',
    'Implemented':'badge-implemented',
    'Draft':'badge-draft',
  };
  return map[status] || 'badge-draft';
}

export function impactBadge(level) {
  const map = { Low:'badge-low', Medium:'badge-medium', High:'badge-high' };
  return map[level] || 'badge-draft';
}

export function scoreBadgeClass(score) {
  const s = parseInt(score) || 0;
  if (s >= 75) return 'score-badge score-high';
  if (s >= 50) return 'score-badge score-med';
  if (s > 0)   return 'score-badge score-low';
  return 'score-badge score-none';
}

export function actionLabel(action) {
  const m = {
    'Submitted':'S','Approved':'A','Rejected':'R','Under Review':'U',
    'Implemented':'I','Escalated':'E','Comment':'C','Draft':'D',
  };
  return m[action] || action?.[0] || '?';
}

export function translateStatus(status, t) {
  if (!t || !status) return status || '';
  return STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status;
}

export function translateImpact(level, t) {
  if (!t || !level) return level || '';
  return IMPACT_KEYS[level] ? t(IMPACT_KEYS[level]) : level;
}

// impact_areas is stored as a comma-separated string of English area names.
export function translateAreas(areas, t) {
  if (!areas) return '';
  const list = Array.isArray(areas) ? areas : String(areas).split(',');
  return list
    .map(a => a.trim())
    .filter(Boolean)
    .map(a => (t && AREA_KEYS[a] ? t(AREA_KEYS[a]) : a))
    .join(', ');
}

export function translateArea(area, t) {
  if (!area) return '';
  const a = String(area).trim();
  return t && AREA_KEYS[a] ? t(AREA_KEYS[a]) : a;
}

export function formatRole(role, t) {
  if (!role) return '';
  if (t && ROLE_KEYS[role]) return t(ROLE_KEYS[role]);
  return role.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function engagementIndex(ai_score, avg_rating, vote_count) {
  const a = (parseFloat(avg_rating) || 0) * 20;
  const v = Math.min(parseInt(vote_count) || 0, 20) / 20 * 100;
  return Math.round(a * 0.4 + v * 0.3 + (parseInt(ai_score) || 0) * 0.3);
}

export function communityScore(aiScore, upvotes, downvotes) {
  const net = (parseInt(upvotes) || 0) - (parseInt(downvotes) || 0);
  const adj = Math.max(-20, Math.min(20, net * 3));
  return Math.max(0, Math.min(100, (parseInt(aiScore) || 0) + adj));
}

export function animateCounter(el, target, duration = 900) {
  if (!el) return;
  const start = performance.now();
  const from = parseInt(el.textContent) || 0;
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * ease);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target;
  }
  requestAnimationFrame(step);
}

export const ROLE_PRIV = ['team_lead','project_lead','manager','department_manager','senior_manager','plant_head','executive','admin','super_admin'];
export function isPrivileged(role) { return ROLE_PRIV.includes(role); }
export function isAdmin(role) { return role === 'admin'; }
export function isSuperAdmin(role) { return role === 'super_admin'; }
export function isPlatformAdmin(role) { return role === 'platform_admin'; }
