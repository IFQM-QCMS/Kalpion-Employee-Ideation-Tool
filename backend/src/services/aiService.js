/** AI idea-scoring service - Node port of PHP api/score.php. */
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Heuristic helpers

/*
 * Spelled-out counts are how most people actually write ("two hours a week", "three
 * operators", "a dozen pieces"). The digit-only check below used to treat these identically
 * to no number at all, which meant a perfectly quantified benefit in plain English scored
 * as if nothing had been measured.
 */
const WORD_NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|'
  + 'dozen|couple|few|several|half|quarter|double|triple)';
const WORD_NUMBER_RE = new RegExp(
  `\\b${WORD_NUMBER}\\b\\s+\\w*\\s*(hours?|hrs?|days?|minutes?|mins?|weeks?|months?|years?|`
  + 'people|employees|workers|operators|staff|units?|pieces?|items?|times?|percent|%|'
  + 'rupees?|lakh|crore|batches?|shifts?|complaints?)', 'i'
);

/** Numbers paired with a unit/suffix, a stand-alone multi-digit number, or a spelled-out count. */
export function isQuantified(text) {
  if (!text) return false;
  if (/\d+\s*(%|percent|rs\.?|inr|₹|\$|hr|hour|day|min|unit|piece|time|x\b)/i.test(text)) return true;
  if (/\b\d{2,}\b/.test(text)) return true;
  if (WORD_NUMBER_RE.test(text)) return true;
  return false;
}

/** Approximate sentence count by terminal punctuation (min 1 for non-empty). */
export function countSentences(text) {
  text = String(text).trim();
  if (text === '') return 0;
  const m = text.match(/[.!?]+(?:\s|$)/g);
  const n = m ? m.length : 0;
  return Math.max(1, n || 1);
}

/** Type-token ratio: unique words / total words (0.0-1.0). */
export function lexicalDiversity(text) {
  const words = String(text).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length;
  if (total === 0) return 0.0;
  return new Set(words).size / total;
}

/*
 * True if the solution describes HOW - not only "we will implement X", but the plain,
 * instruction-style phrasing most shop-floor submissions actually use ("Install a lid and
 * close it each shift"). The original patterns all required a future-tense auxiliary verb or
 * a numbered-step structure, so a perfectly actionable one-line fix written as a plain
 * imperative sentence matched none of them.
 */
export function hasActionableSteps(text) {
  if (!text) return false;
  const patterns = [
    /\b(will|can|shall|should|would|to|we'll)\s+(be\s+)?(implement|introduc|deploy|install|replac|creat|establish|develop|train|monitor|audit|track|measur|digitiz|automat|add|fit|fix|move|place|relocat|mark|label|cover|seal|clean|separat|standardi[sz]e|assign|rotate|schedule|provid)/i,
    /\bby\s+(implement|introduc|deploy|install|using|integrat|conduct|establish|train|add|fit|mov|clean|mark|label)/i,
    /\bthrough\s+\w+/i,
    /\bpropos(e|ed|ing)\s+to\s+\w+/i,
    /\b(step\s*\d|phase\s*\d|first[,\s]|second[,\s]|then[,\s]|next[,\s]|finally[,\s]|once\s+(a|per)|(every|each)\s+(shift|day|week|batch|time|morning|night))/i,
    // Imperative-mood openers: "Install a...", "Add a...", "Fit a...", "Replace the...",
    // "Move the...", "Use a...", "Create a...", "Mark the..." - a plain instruction given
    // directly, no auxiliary verb needed.
    /^(install|add|fit|replace|move|relocat|use|creat|mark|label|cover|separat|provid|assign|introduc|place|attach|mount|build|set\s*up|clean|train|rotate|schedule)\w*\b/i,
  ];
  return patterns.some((p) => p.test(text.trim()));
}

/** Penalty (0-9) for generic low-value phrases; each hit +3, capped at 9. */
export function genericPhrasePenalty(text) {
  text = String(text).toLowerCase();
  const phrases = [
    'improve the system', 'make it better', 'enhance efficiency',
    'resolve the issue', 'fix the problem', 'improve process',
    'better performance', 'increase productivity', 'needs improvement',
    'should be improved', 'can be better', 'more efficient way',
    'optimize the process', 'improve overall', 'generally improve',
  ];
  let hits = 0;
  for (const p of phrases) if (text.includes(p)) hits++;
  return Math.min(9, hits * 3);
}

/** Word count. */
export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// Dimension scorers
//
// Rebalanced after real, sensible shop-floor ideas were scoring in single digits. Each
// scorer used to start every submission at zero and demand several independent keyword
// hits before awarding any credit at all - workable for a long, jargon-filled essay, but it
// meant a short, clear, perfectly legitimate idea ("a hinged lid on the bench, closed at the
// end of each shift") lost marks on almost every dimension simultaneously, compounding into
// an unfairly low total. Every dimension below now gives a baseline for genuinely answering
// the question it asks, and reserves the harsh penalties for the cases that actually deserve
// them - near-empty text, or openly generic filler ("make it better"). The keyword lists
// were also IT/office-skewed (system, dashboard, ERP...) and gave zero credit to the
// physical and process fixes a shop floor actually proposes (a guard, a lid, a jig, a label,
// a checklist, 5S/poka-yoke language) - those are now recognised on equal footing.

/** Dimension 1 - Problem Clarity (0-20). */
export function scoreProblemClarity(sit) {
  const text = String(sit).trim();
  if (text === '') return 0;

  // Baseline for describing a real situation at all, so the signals below move the score
  // up and down from a credible starting point rather than from zero.
  let score = 7;

  const words = wordCount(text);
  if (words >= 35) score += 5;
  else if (words >= 20) score += 4;
  else if (words >= 10) score += 2;
  else if (words < 6) score -= 5; // too thin to describe any real situation

  const ttr = lexicalDiversity(text);
  if (ttr >= 0.70) score += 3;
  else if (ttr >= 0.50) score += 2;
  else if (ttr >= 0.35) score += 1;

  if (isQuantified(text)) score += 3;

  const lower = text.toLowerCase();
  const causeWords = ['because', 'due to', 'results in', 'causing', 'leads to', 'result of',
    'currently', 'at present', 'since', 'therefore', 'consequently', 'as a result',
    'every', 'each time', 'whenever', 'often', 'repeatedly', 'frequently',
    'lack of', 'without', 'missing', 'overnight', 'has no', 'does not have'];
  const causalHits = causeWords.filter((w) => lower.includes(w)).length;
  if (causalHits >= 2) score += 2;
  else if (causalHits >= 1) score += 1;

  score -= Math.ceil(genericPhrasePenalty(text) / 3);

  return Math.max(0, Math.min(20, score));
}

/** Dimension 2 - Solution Quality (0-20). */
export function scoreSolutionQuality(sol) {
  const text = String(sol).trim();
  if (text === '') return 0;

  let score = 7; // baseline for proposing something concrete at all

  const words = wordCount(text);
  if (words >= 35) score += 4;
  else if (words >= 20) score += 3;
  else if (words >= 10) score += 2;
  else if (words < 6) score -= 5;

  if (hasActionableSteps(text)) score += 3;

  const ttr = lexicalDiversity(text);
  if (ttr >= 0.65) score += 3;
  else if (ttr >= 0.45) score += 2;
  else if (ttr >= 0.30) score += 1;

  const lower = text.toLowerCase();
  const mechanisms = [
    // digital / systems
    'system', 'software', 'database', 'dashboard', 'checklist', 'form',
    'procedure', 'protocol', 'template', 'sensor', 'scanner', 'camera',
    'algorithm', 'workflow', 'portal', 'module', 'report', 'alert', 'erp',
    'application', 'barcode', 'rfid', 'qr code', 'spreadsheet',
    // physical / mechanical / process - a shop floor's own vocabulary, previously worth
    // nothing here however concrete the fix was.
    'guard', 'lid', 'cover', 'tray', 'bin', 'rack', 'shelf', 'jig', 'fixture',
    'clamp', 'bracket', 'shield', 'barrier', 'stopper', 'stand', 'holder',
    'label', 'tag', 'colour-code', 'color-code', 'marking', 'signage', 'sign',
    'layout', 'poka-yoke', 'mistake-proof', 'fail-safe', 'interlock', 'lock',
    'rota', 'rotation', 'schedule', 'routine', 'sop', 'instruction', 'training',
    'handle', 'hinge', 'valve', 'gauge', 'filter', 'drain', 'vent', 'chute',
    'trolley', 'cart', 'pallet', 'crate', 'box',
  ];
  if (mechanisms.some((m) => lower.includes(m))) score += 3;

  score -= Math.ceil(genericPhrasePenalty(text) / 2);

  return Math.max(0, Math.min(20, score));
}

/** Dimension 3 - Feasibility (0-15). */
export function scoreFeasibility(sol, sit, impactLevel) {
  const solText = String(sol).trim();
  if (solText === '') return 0;
  const combined = `${solText} ${String(sit)}`.toLowerCase();

  // Most shop-floor fixes ARE feasible by default - simple and cheap is a feasibility
  // strength, not something that only earns points once it is spelled out at length.
  let score = 8;

  const resourceWords = ['team', 'department', 'manager', 'operator', 'staff', 'vendor',
    'supplier', 'month', 'week', 'quarter', 'phase', 'pilot', 'trial',
    'budget', 'cost', 'investment', 'existing', 'available', 'current system'];
  const resourceHits = resourceWords.filter((w) => combined.includes(w)).length;
  // A bonus for naming resources or a timeline, never a requirement for credit in the
  // first place - most short, obviously-doable fixes never need to spell that out.
  score += Math.min(4, resourceHits * 2);

  const overreach = ['completely eliminate', 'zero defect', 'fully automate everything',
    'no human error', '100% accuracy', 'eliminate all errors', 'perfect system',
    'entire organisation', 'company-wide overnight', 'overnight transformation'];
  const overreachHits = overreach.filter((w) => combined.includes(w)).length;
  score -= overreachHits * 3;

  // A genuinely bare answer ("automate it") cannot be judged feasible, whatever the impact
  // level claims - this is the one case left that still marks the dimension down hard.
  if (wordCount(solText) < 4) score -= 6;

  return Math.max(0, Math.min(15, score));
}

/** Dimension 4 - Business Impact (0-20). */
export function scoreBusinessImpact(impactLevel, impAreas, tangible) {
  let score = 0;

  const levelMap = { High: 11, Medium: 8, Low: 5 };
  score += levelMap[impactLevel] ?? 8;

  // One clearly-named area is a specific, real answer - the old ladder treated it as barely
  // better than none, which rewarded ticking extra boxes over naming the one that mattered.
  const areaCount = impAreas.length;
  if (areaCount >= 4) score += 5;
  else if (areaCount >= 2) score += 4;
  else if (areaCount === 1) score += 3;

  if (String(tangible).trim() !== '') {
    score += 2;
    if (isQuantified(tangible)) score += 2;
  }

  return Math.max(0, Math.min(20, score));
}

/** Dimension 5 - Measurability (0-10). */
export function scoreMeasurability(tangible, sit, sol) {
  let score = 0;

  if (isQuantified(tangible)) score += 5;
  else if (String(tangible).trim() !== '') score += 3;

  if (isQuantified(sit)) score += 2;

  const combined = `${String(sol)} ${String(tangible)}`.toLowerCase();
  if (/\bfrom\s+\d+.*?to\s+\d+|\bby\s+\d+\s*(%|percent)|\btarget\b|\bgoal\b|\bbenchmark\b|\bsave[sd]?\b|\breduc|\bcut\s+(down|back)/i.test(combined)) {
    score += 3;
  }

  return Math.max(0, Math.min(10, score));
}

/** Dimension 6 - Innovation / Uniqueness (0-15). */
export function scoreInnovation(sol, sit, impAreas) {
  const solText = String(sol).trim();
  if (solText === '') return 0;

  // Proposing any concrete change over the status quo has baseline novelty value - this
  // dimension used to require a technology buzzword or an explicit "new process" phrase to
  // earn anything at all, which meant an ordinary mechanical fix scored zero on innovation
  // no matter how sensible it was.
  let score = 4;
  const combined = `${solText} ${String(sit)}`.toLowerCase();

  const techWords = ['digital', 'software', 'app', 'application', 'automation', 'automated',
    'sensor', 'iot', 'barcode', 'qr', 'rfid', 'ai', 'machine learning',
    'real-time', 'cloud', 'dashboard', 'analytics', 'erp', 'api', 'database'];
  const techHits = techWords.filter((w) => combined.includes(w)).length;
  if (techHits >= 2) score += 4;
  else if (techHits >= 1) score += 2;

  const changeWords = ['new process', 'new procedure', 'redesign', 'restructure', 'new workflow',
    'new system', 'new approach', 'novel', 'innovative', 'introduce a',
    'establish a', 'create a', 'develop a', 'instead of', 'rather than', 'replac',
    'eliminat', 'prevent', 'avoid', 'simple', 'low-cost', 'low cost', 'inexpensive',
    'quick fix', 'easy to', 'no longer', 'move the', 'relocat'];
  if (changeWords.some((w) => combined.includes(w))) score += 3;

  const areaCount = impAreas.length;
  if (areaCount >= 3) score += 2;
  else if (areaCount >= 2) score += 1;

  const rootWords = ['root cause', 'underlying', 'fundamental', 'source of the',
    'prevent recurrence', 'prevent future', 'systemic', 'recurring',
    'every shift', 'every time', 'each shift', 'repeatedly'];
  if (rootWords.some((w) => combined.includes(w))) score += 2;

  return Math.max(0, Math.min(15, score));
}

// Core scoring engine

/** Full breakdown + total (0-100). Mirrors scoreIdeaWithBreakdown(). */
export function scoreIdeaWithBreakdown(idea) {
  const sit = String(idea.present_situation ?? '').trim();
  const sol = String(idea.proposed_solution ?? '').trim();
  const level = String(idea.impact_level ?? 'Medium').trim();
  const tangible = String(idea.tangible_benefit ?? '').trim();

  const impAreas = String(idea.impact_areas ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const problem = scoreProblemClarity(sit);
  const solution = scoreSolutionQuality(sol);
  const feasibility = scoreFeasibility(sol, sit, level);
  const impact = scoreBusinessImpact(level, impAreas, tangible);
  const measurability = scoreMeasurability(tangible, sit, sol);
  const innovation = scoreInnovation(sol, sit, impAreas);

  const total = Math.max(0, Math.min(100,
    problem + solution + feasibility + impact + measurability + innovation));

  return {
    score: total,
    breakdown: { problem, solution, feasibility, impact, measurability, innovation },
  };
}

/** Integer score only. Mirrors computeIdeaScore(). */
export function computeIdeaScore(idea) {
  return scoreIdeaWithBreakdown(idea).score;
}

/** Human-readable fallback reason from a breakdown. Mirrors buildFallbackReason(). */
export function buildFallbackReason(bd) {
  const strengths = [];
  const weaknesses = [];

  if (bd.problem >= 15) strengths.push('problem is clearly defined');
  else if (bd.problem < 8) weaknesses.push('problem statement needs more specificity');

  if (bd.solution >= 15) strengths.push('solution is well-articulated and actionable');
  else if (bd.solution < 8) weaknesses.push('solution could be more detailed and concrete');

  if (bd.feasibility >= 10) strengths.push('implementation appears realistic');
  else if (bd.feasibility < 5) weaknesses.push('feasibility is unclear - consider naming resources or timelines');

  if (bd.impact >= 15) strengths.push('strong and broad business impact');

  if (bd.measurability >= 7) strengths.push('outcomes are quantified');
  else if (bd.measurability < 3) weaknesses.push('consider adding measurable targets or baseline numbers');

  if (bd.innovation >= 10) strengths.push('innovative approach');

  const parts = [];
  if (strengths.length) parts.push(ucfirst(strengths.join(', ')));
  if (weaknesses.length) parts.push(ucfirst(weaknesses.join('; ')));

  const body = parts.length ? `${parts.join('. ')}.` : 'Scored using the structured heuristic model.';
  return `Heuristic: ${body}`;
}

// Optional LLM provider

/** Build the evaluation prompt (identical text to score.php). */
function buildPrompt(idea) {
  const title = String(idea.title ?? '');
  const sit = String(idea.present_situation ?? '');
  const sol = String(idea.proposed_solution ?? '');
  const areas = String(idea.impact_areas ?? '');
  const level = String(idea.impact_level ?? 'Medium');
  return `Evaluate this employee improvement idea for an operations/manufacturing company.

Return ONLY valid JSON in this exact format - no markdown, no code fences, no extra text:
{"score": <integer 0-100>, "reason": "<one sentence explanation>"}

The reason must be a single sentence (max 20 words) summarising the key strength or weakness that most influenced the score.

Score based on:
- Innovation: Is it a fresh or creative approach?
- Feasibility: Can it realistically be implemented?
- Business Impact: Does it improve cost, quality, safety, or efficiency?

Idea:
Title: ${title}
Present Situation: ${sit}
Proposed Solution: ${sol}
Impact Areas: ${areas}
Impact Level: ${level}`;
}

/** Call the configured LLM provider. Returns raw text content or null. */
async function callProvider(prompt) {
  const { provider, openaiApiKey, geminiApiKey } = config.ai;
  try {
    if (provider === 'gemini' && geminiApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
      const res = await fetchJson(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
      });
      return res?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
    if (provider === 'openai' && openaiApiKey) {
      const res = await fetchJson(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        },
        { Authorization: `Bearer ${openaiApiKey}` }
      );
      return res?.choices?.[0]?.message?.content ?? null;
    }
  } catch (e) {
    logger.error('AI provider call failed', e.message);
  }
  return null; // no provider configured heuristic fallback
}

async function fetchJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.error(`AI provider HTTP ${res.status}`, await res.text());
      return null;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Primary scoring entry point. */
export async function computeAIScoreWithReason(idea) {
  const content = await callProvider(buildPrompt(idea));

  if (content !== null) {
    let cleaned = String(content).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      let parsed;
      try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'score') && isNumeric(parsed.score)) {
        const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
        const reason = String(parsed.reason ?? 'Evaluated by AI.').trim();
        const heuristic = scoreIdeaWithBreakdown(idea);
        return {
          score,
          reason: reason !== '' ? reason : 'Evaluated by AI.',
          source: config.ai.provider || 'ai',
          breakdown: heuristic.breakdown,
        };
      }
    }
    logger.error('AI score parse failed. Cleaned content:', cleaned);
  }

  const result = scoreIdeaWithBreakdown(idea);
  return {
    score: result.score,
    reason: buildFallbackReason(result.breakdown),
    source: 'fallback',
    breakdown: result.breakdown,
  };
}

/** Persist a computed score. Mirrors saveIdeaScore(). */
export async function saveIdeaScore(db, ideaId, score, reason = '') {
  await db.execute('UPDATE ideas SET ai_score = ?, ai_reason = ? WHERE id = ?', [score, reason, ideaId]);
}

// small utils
function ucfirst(s) {
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function isNumeric(v) {
  return typeof v === 'number' ? Number.isFinite(v) : /^-?\d+(\.\d+)?$/.test(String(v).trim());
}

export default {
  computeAIScoreWithReason, computeIdeaScore, scoreIdeaWithBreakdown,
  buildFallbackReason, saveIdeaScore,
};
