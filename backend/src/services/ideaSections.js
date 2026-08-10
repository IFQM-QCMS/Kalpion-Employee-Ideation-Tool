/**
 * Which parts of somebody else's idea an ordinary colleague may read.
 *
 * This lives in its own file because two services need the same vocabulary and
 * they cannot import each other: settingsService validates what an admin saves,
 * ideaService enforces it when a page is served. Putting the list in either one
 * would make the pair circular.
 *
 * "Ordinary colleague" means exactly one thing: not the author, not a
 * co-suggester, not a reviewer of this idea, and not senior enough to be
 * judging ideas at all. Everybody else is unaffected — an author always reads
 * their own idea in full, and a reviewer always reads what they are being asked
 * to decide on.
 *
 * The title, code, status, department, impact and score are deliberately not on
 * this list. They are what makes an idea findable and what the leaderboard is
 * built from; hiding them would produce a list of blank rows rather than a
 * shorter one.
 */
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

/**
 * The sections an organisation allows, cleaned up.
 *
 * The default is `solution` alone: an employee browsing other people's ideas
 * sees the title and one line saying what it is about. An organisation that
 * wants to be more open adds sections; one that wants to be stricter can take
 * even that away by saving an empty list.
 *
 * An empty string is a real answer meaning "nothing", which is why it is
 * distinguished from the setting being absent altogether.
 */
export function employeeSections(settings) {
  const raw = settings?.employee_visible_sections;
  if (raw === undefined || raw === null) return ['solution'];
  const wanted = String(raw).split(',').map((x) => x.trim()).filter(Boolean);
  return IDEA_SECTIONS.filter((x) => wanted.includes(x));
}

export default { IDEA_SECTIONS, employeeSections };
