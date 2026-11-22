/**
 * The focus areas and levels of the cuj-v1 corpus (docs/scenarios/cuj-v1.md),
 * and the one function that gives a task its level. A level is never written
 * on a task: it is derived from properties anyone can count, the template
 * declares them, the corpus builder derives the level from them, and
 * tools/intent-integrity.mjs measures them again on the live reference
 * solution and refuses a task whose measurement does not give the same level.
 */

/** The ten focus areas, by their stable key. */
export const AREAS = ["find-the-fit", "price-it", "book-it", "book-the-best", "change-it", "cancel-it", "return-or-repeat", "act-as-yourself", "carry-a-conversation", "plan-across-sites"];
export const LEVELS = ["easy", "medium", "hard", "impossible"];
/** The areas that have no easy task by nature: a conversation and a plan are never one read or one write. */
export const NO_EASY = ["carry-a-conversation", "plan-across-sites"];

/**
 * A task's countable properties:
 *
 *   sites        the apps its reference solution touches, in the order it meets them (the inbox is not a site)
 *   stepSites    per step, the apps that step touches
 *   steps        how many prompts (1 to 8)
 *   reads        lookups the reference solution makes (a search, a list, one entity), signing in left out
 *   writes       changes it makes that the site keeps (signing up and in left out)
 *   named        the target is named in the prompt
 *   constraints  how many requirements the target must be found by
 *   rule         a site rule changes the outcome: a fee, a party size (the outcome without it is a different one)
 *   tempting     a tempting option fails one of the constraints
 *   signUp       a sign-up with an emailed code comes before the task can start
 *   interacting  constraints interact across the sites or steps (a budget, a schedule): choosing each part on its own breaks them
 *   recovered    one failure part-way is recovered from: a write the site refuses, then one it makes
 *   impossible   the site's rules or stock make the request impossible: the right outcome is to refuse and change nothing
 *
 * returns { level, veryHard } or null when no level's definition fits.
 */
export function levelOf(p) {
  const between = (n, lo, hi) => n >= lo && n <= hi;
  if (p.impossible) return { level: "impossible", veryHard: false };
  if ((p.sites.length >= 2 || between(p.steps, 6, 8)) && p.interacting && p.recovered) return { level: "hard", veryHard: true };
  if (p.tempting || between(p.steps, 3, 5) || p.signUp) return { level: "hard", veryHard: false };
  const onePerStep = p.stepSites.every((apps) => apps.length <= 1);
  if (onePerStep && p.steps <= 2 && p.writes <= 1 && !p.interacting && (between(p.constraints, 2, 3) || p.rule)) return { level: "medium", veryHard: false };
  if (p.sites.length === 1 && p.steps === 1 && p.named && p.reads <= 1 && p.writes <= 1 && p.reads + p.writes >= 1 && !p.rule && p.constraints <= 1) return { level: "easy", veryHard: false };
  return null;
}

/** The level definitions, word for word as the docs give them, for the generated description. */
export const LEVEL_TEXT = {
  easy: "One site. The target is named in the prompt. One read or one write. No rule changes the outcome.",
  medium: "One site (one per step). The target must be found by two or three constraints, or a rule changes the outcome (a fee, a party size). One write.",
  hard: "A tempting option that fails one constraint; or three to five steps; or a sign-up with an emailed code before the task can start.",
  veryHard: "Two or more sites or six to eight steps, constraints that interact across them (a budget, a schedule), and one failure to recover from part-way.",
  impossible: "The site's rules or stock make the request impossible. The right outcome: say so, give the site's reason, change nothing.",
};
