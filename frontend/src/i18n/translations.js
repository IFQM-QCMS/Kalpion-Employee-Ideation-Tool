import en from './en';
import hi from './hi';
import mr from './mr';
import kn from './kn';
import te from './te';
import ta from './ta';
import ml from './ml';

export const SUPPORTED_LANGS = ['en','hi','mr','kn','te','ta','ml'];
export const LANG_LABELS = { en:'EN', hi:'हि', mr:'म', kn:'ಕ', te:'తె', ta:'த', ml:'മ' };
export const LANG_NAMES  = {
  en:'English', hi:'हिंदी', mr:'मराठी', kn:'ಕನ್ನಡ',
  te:'తెలుగు', ta:'தமிழ்', ml:'മലയാളം',
};

export const TRANSLATIONS = { en, hi, mr, kn, te, ta, ml };

// Values stored in the DB are English; these map them onto translation keys so
// status/impact/area/role columns render in the active language too.
export const STATUS_KEYS = {
  'Submitted':'status.submitted',
  'Under Review':'status.review',
  'Approved':'status.approved',
  'Rejected':'status.rejected',
  'Implemented':'status.implemented',
  'Draft':'status.draft',
  'Escalated':'status.escalated',
  'Comment':'status.comment',
};
export const IMPACT_KEYS = {
  'Low':'impact.low', 'Medium':'impact.medium',
  'High':'impact.high', 'Critical':'impact.critical',
};
// Organisations now own their own category list, so this map cannot be exhaustive - it
// covers the seeded defaults plus the seven areas that shipped hard-coded before them, so
// existing ideas keep translating.
export const AREA_KEYS = {
  'Safety':'area.safety',
  'Quality':'area.quality',
  'Productivity':'area.productivity',
  'Delivery':'area.delivery',
  'Sustenance':'area.sustenance',
  'Cost Reduction':'area.cost_reduction',
  'Waste Reduction':'area.waste_reduction',
  'Innovation':'area.innovation',
  'Simplification':'area.simplification',
  'Infrastructure':'area.infrastructure',
  // Retired from the default list, kept so ideas submitted under them still
  // show a translated name rather than raw English.
  'Quality Improvement':'area.quality_improvement',
  'Customer Satisfaction':'area.customer_satisfaction',
  'Process Efficiency':'area.process_efficiency',
};
export const ROLE_KEYS = {
  trainee:'role.trainee', employee:'role.employee', team_lead:'role.team_lead',
  project_lead:'role.project_lead', manager:'role.manager',
  department_manager:'role.department_manager',
  senior_manager:'role.senior_manager', plant_head:'role.plant_head',
  executive:'role.executive',
  admin:'role.admin', super_admin:'role.super_admin', platform_admin:'role.platform_admin',
};

// Substitute {name} placeholders: t('msg.pts_earned', { n: 10 })
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

const warned = new Set();

export function getT(lang) {
  const dict = TRANSLATIONS[lang] || en;
  return (key, vars) => {
    let s = dict[key];
    if (s === undefined) {
      s = en[key];
      if (import.meta.env.DEV && !warned.has(lang + key)) {
        warned.add(lang + key);
        console.warn(
          s === undefined
            ? `[i18n] Key "${key}" is missing from every locale - the raw key will render on screen.`
            : `[i18n] Key "${key}" is missing from "${lang}" - falling back to English.`
        );
      }
    }
    // Last resort: show the key rather than "undefined".
    return interpolate(s ?? key, vars);
  };
}

// Dev-only completeness audit. A locale that drifts from `en` used to fail silently as
// half-English UI; now it is reported the moment the app boots.
if (import.meta.env.DEV) {
  const enKeys = Object.keys(en);
  for (const lang of SUPPORTED_LANGS) {
    if (lang === 'en') continue;
    const dict = TRANSLATIONS[lang];
    const missing = enKeys.filter(k => dict[k] === undefined);
    const extra   = Object.keys(dict).filter(k => en[k] === undefined);
    if (missing.length) console.warn(`[i18n] "${lang}" is missing ${missing.length}/${enKeys.length} keys:`, missing);
    if (extra.length)   console.warn(`[i18n] "${lang}" has ${extra.length} keys not present in en:`, extra);
  }
}
