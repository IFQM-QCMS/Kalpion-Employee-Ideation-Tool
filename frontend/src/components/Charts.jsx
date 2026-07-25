/**
 * Small, dependency-free chart primitives for the analytics dashboards.
 *
 * Colours follow the validated categorical palette (fixed order, never cycled
 * past 8 — fold the rest into "Other"): blue, orange, aqua, yellow, magenta,
 * green, violet, red. Status colours are kept separate and reserved.
 */

// Categorical hues in fixed order (light-mode values; each clears CVD checks).
export const CHART_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
];

// Reserved status colours (semantic — never reused as "series N").
export const STATUS_COLORS = {
  Submitted: '#2a78d6', 'Under Review': '#eda100', Approved: '#1baf7a',
  Rejected: '#e34948', Implemented: '#4a3aa7', Draft: '#94a3b8',
  active: '#1baf7a', suspended: '#e34948', pending: '#eda100',
};

export const colorAt = (i) => CHART_COLORS[i % CHART_COLORS.length];

/**
 * A donut/ring chart. `data` = [{ label, value, color }].
 * Renders a segmented ring with a small gap between slices and an optional
 * centred figure. Static (no animation) — reads clearly in print and screenshots.
 */
export function Donut({ data = [], size = 168, thickness = 26, centerValue, centerLabel }) {
  const clean = data.filter((d) => Number(d.value) > 0);
  const total = clean.reduce((s, d) => s + Number(d.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  // A small gap between slices. Only when there are ≥2 slices, and never bigger
  // than a fraction of the smallest slice. Caps are BUTT — round caps on a thick
  // ring extend ~thickness/2 past each arc and make neighbours overlap.
  const GAP = clean.length > 1 ? 2 : 0;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="donut chart">
      {/* track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity="0.35" />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total > 0 && clean.map((d, i) => {
          const frac = Number(d.value) / total;
          const len = Math.max(frac * c - GAP, 0.5);
          const seg = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += frac * c;
          return seg;
        })}
      </g>
      {centerValue !== undefined && (
        <>
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
            fontSize={size * 0.22} fontWeight="800" fill="var(--heading)">{centerValue}</text>
          {centerLabel && (
            <text x="50%" y="66%" textAnchor="middle"
              fontSize={size * 0.085} fill="var(--subtle)"
              style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{centerLabel}</text>
          )}
        </>
      )}
    </svg>
  );
}

/** A legend for a donut/series. `items` = [{ label, value, color }]. */
export function Legend({ items = [], showValue = true }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text)', flex: 1 }}>{it.label}</span>
          {showValue && <strong style={{ color: 'var(--heading)' }}>{it.value}</strong>}
        </div>
      ))}
    </div>
  );
}

// Catmull-Rom → cubic-bezier smoothing for a flowing line.
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 2) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x},${p2.y}`;
  }
  return d;
}

let _uid = 0;

/**
 * A smooth gradient area/line chart. `data` = [{ label, value }].
 * Scales uniformly to its container width; dots carry a native hover tooltip.
 */
export function AreaChart({ data = [], color = '#2a78d6', height = 190 }) {
  const W = 580, H = height, padL = 10, padR = 10, padT = 18, padB = 26;
  const id = `ac${++_uid}`;
  const n = data.length;
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xAt = (i) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yAt = (v) => padT + (1 - (Number(v) || 0) / max) * plotH;
  const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(d.value) }));
  const line = smoothPath(pts);
  const base = padT + plotH;
  const area = pts.length ? `${line} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z` : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: 'auto', display: 'block' }} role="img" aria-label="trend chart">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.42" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* faint baseline */}
      <line x1={padL} y1={base} x2={W - padR} y2={base} stroke="var(--border)" strokeWidth="1" />
      {area && <path d={area} fill={`url(#${id})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4.2" fill="var(--surface)" stroke={color} strokeWidth="2.4">
          <title>{`${data[i].label}: ${data[i].value}`}</title>
        </circle>
      ))}
      {data.map((d, i) => (
        <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--subtle)">{d.label}</text>
      ))}
    </svg>
  );
}

/** A circular progress gauge (0..max). Colour by caller (e.g. score band). */
export function Gauge({ value = 0, max = 100, size = 132, thickness = 13, color = '#2a78d6', label }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, (Number(value) || 0) / max));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="gauge">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity="0.45" />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeLinecap="round" strokeDasharray={`${frac * c} ${c}`} />
      </g>
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight="800" fill="var(--heading)">{value}</text>
      {label && <text x="50%" y="65%" textAnchor="middle" fontSize={size * 0.1} fill="var(--subtle)"
        style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</text>}
    </svg>
  );
}

export default { CHART_COLORS, STATUS_COLORS, colorAt, Donut, Legend, AreaChart, Gauge };
