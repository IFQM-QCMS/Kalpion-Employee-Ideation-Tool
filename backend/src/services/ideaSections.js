/** Which parts of somebody else's idea an ordinary colleague may read. */
export const IDEA_SECTIONS = [
  'situation',      // the extract of the problem statement
  'solution',       // the one-line gist of the proposal
  'benefits',       // tangible and intangible benefit text
  'business_case',  // investment, feasibility, timeline, recorded return
  'attachments',    // the files
  'comments',       // the discussion thread
  'co_suggesters',  // who raised it with them
  'timeline',       // the approval history
];

/** The sections an organisation allows, cleaned up. */
export function employeeSections(settings) {
  const raw = settings?.employee_visible_sections;
  if (raw === undefined || raw === null) return ['solution'];
  const wanted = String(raw).split(',').map((x) => x.trim()).filter(Boolean);
  return IDEA_SECTIONS.filter((x) => wanted.includes(x));
}

export default { IDEA_SECTIONS, employeeSections };
