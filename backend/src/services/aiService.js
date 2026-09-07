/** AI idea-scoring service - Node port of PHP api/score.php. */
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Heuristic helpers

/** Numbers paired with a unit/suffix, or a stand-alone multi-digit number. */
export function isQuantified(text) {
  if (!text) return false;
  if (/\d+\s*(%|percent|rs\.?|inr|₹|\$|hr|hour|day|min|unit|piece|time|x\b)/i.test(text)) return true;
  if (/\b\d{2,}\b/.test(text)) return true;
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

/** True if the solution describes HOW (implementation-oriented language). */
export function hasActionableSteps(text) {
  if (!text) return false;
  const patterns = [
    /\b(will|can|shall)\s+(be\s+)?(implement|introduc|deploy|install|replac|creat|establish|develop|train|monitor|audit|track|measur|digitiz|automat)/i,
    /\bby\s+(implement|introduc|deploy|install|using|integrat|conduct|establish|train)/i,
    /\bthrough\s+\w+/i,
    /\bpropos(e|ed|ing)\s+to\s+\w+/i,
    /\b(step\s*\d|phase\s*\d|first[,\s]|second[,\s]|then[,\s]|next[,\s]|finally[,\s])/i,
  ];
  return patterns.some((p) => p.test(text));
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

/** Dimension 1 - Problem Clarity (0-20). */
export function scoreProblemClarity(sit) {
  if (String(sit).trim() === '') return 0;
  let score = 0;

  const sentences = countSentences(sit);
  if (sentences >= 4) score += 5;
  else if (sentences >= 2) score += 3;
  else score += 1;

  const ttr = lexicalDiversity(sit);
  if (ttr >= 0.70) score += 5;
  else if (ttr >= 0.55) score += 3;
  else if (ttr >= 0.40) score += 1;

  if (isQuantified(sit)) score += 5;

  const lower = String(sit).toLowerCase();
  const causeWords = ['because', 'due to', 'results in', 'causing', 'leads to', 'result of',
    'currently', 'at present', 'since', 'therefore', 'consequently', 'as a result'];
  let causalHits = 0;
  for (const w of causeWords) if (lower.includes(w)) causalHits++;
  if (causalHits >= 3) score += 5;
  else if (causalHits >= 1) score += 3;

  score -= Math.ceil(genericPhrasePenalty(sit) / 3);
  if (wordCount(sit) < 15) score -= 5;

  return Math.max(0, Math.min(20, score));
}

/** Dimension 2 - Solution Quality (0-20). */
export function scoreSolutionQuality(sol) {
  if (String(sol).trim() === '') return 0;
  let score = 0;

  const sentences = countSentences(sol);
  if (sentences >= 4) score += 5;
  else if (sentences >= 2) score += 3;
  else score += 1;

  if (hasActionableSteps(sol)) score += 6;

  const ttr = lexicalDiversity(sol);
  if (ttr >= 0.65) score += 5;
  else if (ttr >= 0.50) score += 3;
  else if (ttr >= 0.35) score += 1;

  const lower = String(sol).toLowerCase();
  const mechanisms = ['system', 'software', 'database', 'dashboard', 'checklist', 'form',
    'procedure', 'protocol', 'template', 'sensor', 'scanner', 'camera',
    'algorithm', 'workflow', 'portal', 'module', 'report', 'alert', 'erp',
    'application', 'barcode', 'rfid', 'qr code', 'spreadsheet'];
  for (const m of mechanisms) {
    if (lower.includes(m)) { score += 4; break; }
  }

  score -= Math.ceil(genericPhrasePenalty(sol) / 2);
  if (wordCount(sol) < 15) score -= 5;

  return Math.max(0, Math.min(20, score));
}

/** Dimension 3 - Feasibility (0-15). */
export function scoreFeasibility(sol, sit, impactLevel) {
  let score = 0;
  const combined = `${String(sol)} ${String(sit)}`.toLowerCase();

  const resourceWords = ['team', 'department', 'manager', 'operator', 'staff', 'vendor',
    'supplier', 'month', 'week', 'quarter', 'phase', 'pilot', 'trial',
    'budget', 'cost', 'investment', 'existing', 'available', 'current system'];
  let resourceHits = 0;
  for (const w of resourceWords) if (combined.includes(w)) resourceHits++;
  if (resourceHits >= 4) score += 6;
  else if (resourceHits >= 2) score += 4;
  else if (resourceHits >= 1) score += 2;

  const overreach = ['completely eliminate', 'zero defect', 'fully automate everything',
    'no human error', '100% accuracy', 'eliminate all errors', 'perfect system'];
  let overreachHits = 0;
  for (const w of overreach) if (combined.includes(w)) overreachHits++;
  score += overreachHits === 0 ? 4 : (overreachHits === 1 ? 2 : 0);

  const solWords = wordCount(sol);
  if (impactLevel === 'High' && solWords >= 40) score += 5;
  else if (impactLevel === 'Medium' && solWords >= 20) score += 4;
  else if (impactLevel === 'Low') score += 3;
  else if (solWords >= 20) score += 2;

  return Math.max(0, Math.min(15, score));
}

/** Dimension 4 - Business Impact (0-20). */
export function scoreBusinessImpact(impactLevel, impAreas, tangible) {
  let score = 0;

  const levelMap = { High: 9, Medium: 6, Low: 3 };
  score += levelMap[impactLevel] ?? 6;

  const areaCount = impAreas.length;
  if (areaCount >= 5) score += 7;
  else if (areaCount >= 3) score += 5;
  else if (areaCount >= 2) score += 3;
  else if (areaCount === 1) score += 1;

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
  else if (String(tangible).trim() !== '') score += 2;

  if (isQuantified(sit)) score += 3;

  const combined = `${String(sol)} ${String(tangible)}`.toLowerCase();
  if (/\bfrom\s+\d+.*?to\s+\d+|\bby\s+\d+\s*(%|percent)|\btarget\b|\bgoal\b|\bbenchmark\b/i.test(combined)) {
    score += 2;
  }

  return Math.max(0, Math.min(10, score));
}

/** Dimension 6 - Innovation / Uniqueness (0-15). */
export function scoreInnovation(sol, sit, impAreas) {
  let score = 0;
  const combined = `${String(sol)} ${String(sit)}`.toLowerCase();

  const techWords = ['digital', 'software', 'app', 'application', 'automation', 'automated',
    'sensor', 'iot', 'barcode', 'qr', 'rfid', 'ai', 'machine learning',
    'real-time', 'cloud', 'dashboard', 'analytics', 'erp', 'api', 'database'];
  let techHits = 0;
  for (const w of techWords) if (combined.includes(w)) techHits++;
  if (techHits >= 3) score += 5;
  else if (techHits >= 1) score += 3;

  const newProcess = ['new process', 'new procedure', 'redesign', 'restructure', 'new workflow',
    'new system', 'new approach', 'novel', 'innovative', 'introduce a',
    'establish a', 'create a', 'develop a'];
  for (const w of newProcess) {
    if (combined.includes(w)) { score += 4; break; }
  }

  const areaCount = impAreas.length;
  if (areaCount >= 3) score += 3;
  else if (areaCount >= 2) score += 1;

  const rootWords = ['root cause', 'underlying', 'fundamental', 'source of the',
    'prevent recurrence', 'prevent future', 'systemic', 'recurring'];
  for (const w of rootWords) {
    if (combined.includes(w)) { score += 3; break; }
  }

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
