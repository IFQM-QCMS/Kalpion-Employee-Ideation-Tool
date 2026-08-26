/*
 * Draws the leaderboard as a picture people can actually post.
 *
 * A line of text pasted into WhatsApp is not something anybody shares. An image
 * is. This paints one on a canvas — no library, no server round trip, nothing
 * to install — and hands back a PNG blob.
 *
 * Two cards:
 *   personal   one person's own standing, for "look where I finished"
 *   podium     the organisation's top five, for an internal announcement
 *
 * Nothing confidential goes on either. Names, points and idea counts only:
 * never an idea's title, its text, or anything about a proposal. Somebody who
 * posts one of these on LinkedIn has not leaked their employer's ideas.
 */

const W = 1080;
const H = 1080;

const INK = {
  bg1: '#0b2545', bg2: '#123157',
  gold: '#fbbf24', silver: '#cbd5e1', bronze: '#d97706',
  // Drawn on a <canvas>, which cannot read CSS variables — the palette is
  // duplicated here on purpose and has to be updated with the brand.
  text: '#f8fafc', dim: '#94a3b8', accent: '#c9a961',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsis(ctx, text, maxWidth) {
  let s = String(text ?? '');
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

function background(ctx, orgName) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, INK.bg1);
  g.addColorStop(1, INK.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // A few soft rings, so the card is not a flat rectangle of colour.
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = INK.accent;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(W - 60, 120, 120 + i * 70, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = INK.dim;
  ctx.font = '600 26px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(orgName || 'IFQM').toUpperCase().slice(0, 40), 72, 96);

  ctx.strokeStyle = 'rgba(129,140,248,.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(72, 122);
  ctx.lineTo(260, 122);
  ctx.stroke();
}

function footer(ctx, periodLabel) {
  ctx.fillStyle = INK.dim;
  ctx.font = '500 22px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(periodLabel || '', 72, H - 72);
  ctx.textAlign = 'right';
  ctx.fillText('IFQM Employee Ideation Tool', W - 72, H - 72);
}

function medalColour(rank) {
  return rank === 1 ? INK.gold : rank === 2 ? INK.silver : rank === 3 ? INK.bronze : INK.accent;
}

/** One person's own standing. */
export function drawPersonalCard(canvas, { orgName, name, rank, points, ideas, periodLabel }) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  background(ctx, orgName);

  ctx.textAlign = 'center';

  ctx.fillStyle = INK.text;
  ctx.font = '800 46px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Idea Leaderboard', W / 2, 250);

  // The medal disc, or a plain ring past third place.
  const cx = W / 2, cy = 470, r = 118;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = medalColour(rank);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = medalColour(rank);
  ctx.font = '800 92px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText(rank > 0 ? `#${rank}` : '—', cx, cy + 32);

  ctx.fillStyle = INK.text;
  ctx.font = '700 54px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText(ellipsis(ctx, name || '', W - 200), W / 2, 680);

  ctx.fillStyle = INK.dim;
  ctx.font = '500 28px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText(rank === 1 ? 'Top contributor this period' : 'Contributor', W / 2, 726);

  // Two figures side by side.
  const stats = [['Points', points ?? 0], ['Ideas', ideas ?? 0]];
  stats.forEach(([label, value], i) => {
    const x = W / 2 + (i === 0 ? -190 : 190);
    roundRect(ctx, x - 150, 780, 300, 150, 24);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();
    ctx.fillStyle = INK.text;
    ctx.font = '800 58px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText(String(value), x, 858);
    ctx.fillStyle = INK.dim;
    ctx.font = '600 24px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText(label, x, 900);
  });

  footer(ctx, periodLabel);
  return canvas;
}

/** The organisation's top five. */
export function drawPodiumCard(canvas, { orgName, rows, periodLabel }) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  background(ctx, orgName);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK.text;
  ctx.font = '800 50px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Top Contributors', W / 2, 230);

  ctx.fillStyle = INK.dim;
  ctx.font = '500 26px Inter, system-ui, "Segoe UI", sans-serif';
  ctx.fillText(periodLabel || '', W / 2, 274);

  const list = (rows || []).slice(0, 5);
  const top = Math.max(...list.map((r) => Number(r.points) || 0), 1);

  list.forEach((row, i) => {
    const y = 340 + i * 122;
    roundRect(ctx, 72, y, W - 144, 100, 20);
    ctx.fillStyle = i === 0 ? 'rgba(251,191,36,.12)' : 'rgba(255,255,255,.05)';
    ctx.fill();

    // Rank disc
    ctx.beginPath();
    ctx.arc(140, y + 50, 32, 0, Math.PI * 2);
    ctx.fillStyle = medalColour(i + 1);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 30px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 140, y + 61);

    ctx.textAlign = 'left';
    ctx.fillStyle = INK.text;
    ctx.font = '700 34px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText(ellipsis(ctx, row.name || '', 520), 196, y + 46);

    ctx.fillStyle = INK.dim;
    ctx.font = '500 22px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText(`${row.ideas_count ?? row.idea_count ?? 0} ideas`, 196, y + 78);

    // Points, right-aligned, with a small bar underneath for proportion.
    ctx.textAlign = 'right';
    ctx.fillStyle = medalColour(i + 1);
    ctx.font = '800 38px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText(String(row.points ?? 0), W - 110, y + 50);
    ctx.fillStyle = INK.dim;
    ctx.font = '500 20px Inter, system-ui, "Segoe UI", sans-serif';
    ctx.fillText('points', W - 110, y + 78);

    const barW = ((Number(row.points) || 0) / top) * (W - 340);
    roundRect(ctx, 196, y + 88, Math.max(barW, 6), 6, 3);
    ctx.fillStyle = medalColour(i + 1);
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  footer(ctx, '');
  return canvas;
}

/** Canvas to PNG blob. */
export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

/**
 * Hand the image to whatever the device offers.
 *
 * A phone gets its native share sheet with the picture attached (Web Share
 * Level 2). A desktop browser that cannot share files gets the file downloaded
 * instead, which is what somebody there would do with it anyway.
 *
 * @returns {'shared'|'downloaded'} what actually happened, so the caller can
 *          tell the user the truth rather than guessing.
 */
export async function shareImage(blob, filename, text) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], text });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
