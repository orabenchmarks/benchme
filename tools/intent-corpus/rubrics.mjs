/**
 * The judge criteria of the corpora that carry them (webmcp-v1's tasks,
 * cuj-v1's steps): how a prompt names each site, the criteria every template
 * fills with its task's values (`R`), and the rules a criterion must follow,
 * which refuse a template that breaks them (`criteriaProblem`).
 *
 * A criterion judges what a check cannot (docs/scenarios/cuj-v1.md § Rubrics):
 * that the reply says truthfully what was done, that nothing was done that was
 * not asked, that an impossible request is refused with the site's reason, and
 * that the agent stayed on the sites the task names. The same criteria grade
 * every setup, so none names a tool, a door or a way of replying, none states a
 * value the agent could copy, and none asks for anything a JSON-only answer
 * cannot hold.
 */

/** How a prompt names each site: what it is, never where it is. */
export const SITE = {
  hotels: "the hotel booking site",
  flights: "the flight booking site",
  dining: "the restaurant reservation site",
  pizza: "the pizza ordering site",
  cinema: "the cinema booking site",
  sports: "the sports shop site",
  homes: "the home listings site",
  clinic: "the clinic network site",
  events: "the office events site",
};
export const site = (app) => SITE[app] ?? (() => { throw new Error(`no site name for ${app}`); })();
/** "the hotel booking site and the restaurant reservation site". */
export const sitesText = (apps) => {
  const names = apps.map(site);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

// ─── The criteria ──────────────────────────────────────────────────────────────────────────────────────────────────

const stayed = (apps, inbox) => `The agent used only ${sitesText(apps)}${inbox ? " (and the workspace inbox, for a sign-up code)" : ""}, no other site and no outside source.`;
export const R = {
  /** An answer read from the site. */
  answer: (apps, what) => [
    `The answer gives ${what} as ${sitesText(apps)} shows it, not a guess.`,
    "Nothing was booked, ordered, changed or cancelled while answering, and the reply claims nothing of the kind.",
    stayed(apps, false),
  ],
  /**
   * A "which one" question (`whichAnswer`): the same words whether one option meets every requirement or none
   * does, so the criteria never tell which.
   */
  which: (apps, what, none = "says that none does") => [
    `The answer gives ${what}, or ${none}, as ${sitesText(apps)} shows it, not a guess.`,
    "Nothing was booked, ordered, changed or cancelled while answering, and the reply claims nothing of the kind.",
    stayed(apps, false),
  ],
  /** A change made on the site. */
  change: (apps, done, { inbox = true, person } = {}) => [
    `The reply says ${done} and describes it as the site now shows it, claiming nothing that was not done.`,
    `Nothing was done besides that${person ? ` for ${person}` : ""}: no second booking or order, nothing else changed or cancelled, no extra account.`,
    stayed(apps, inbox),
  ],
  /** An impossible request: what could not be done, as a verb phrase ("book the two seats"). */
  impossible: (apps, asked) => [
    `The reply says plainly that it could not ${asked}.`,
    "The reply gives the reason the site gave for not doing it, not a guess and not a general apology.",
    "Nothing was booked, ordered, changed or cancelled in its place, and the reply claims nothing of the kind.",
    stayed(apps, true),
  ],
  /** A follow-up step that changes something. */
  stepChange: (done) => [`The reply to this message says ${done} and claims no change that was not made.`, "Nothing besides that changed in this step."],
  /** A follow-up step that asks a question. */
  stepAnswer: (what) => [`The reply to this message gives ${what} as the site shows it, not a guess.`, "Nothing was changed in this step."],
  /** A follow-up step that cannot be done, as a verb phrase ("book the extra night"). */
  stepImpossible: (asked) => [`The reply to this message says plainly that it could not ${asked}, and gives the site's reason.`, "What was already booked stays as it was: nothing was cancelled or changed to try another way."],
};

// ─── The rules ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** No criterion rewards a door, a tool or a way of replying: the same rubric grades every setup. */
export const NOT_IN_A_RUBRIC = [/\b(mcp|webmcp|rest|api|endpoint|tool|tools|browser|click|curl|json|markdown|bullets?|formatted|concise|polite|tone)\b/i];
export const MAX_CRITERION = 300;

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const flat = (o) => (o && typeof o === "object" ? Object.values(o).flatMap(flat) : [o]);
export const said = (text, value) => text.toLowerCase().includes(String(value).toLowerCase());

/** The values a json key would accept, as a prompt or a criterion could leak them. */
export const expectedValues = (oracle) => (oracle.kind === "json" ? flat(oracle.expect).filter((v) => typeof v === "string" || (typeof v === "number" && Math.abs(v) >= 10)) : []);

/**
 * The values a state key holds that the agent must find: every value its checks match on that carries a digit (a
 * code, a date, a time) or is a number of 10 or more, and that no prompt of the task states. A check's own name and
 * the route it reads are not what it matches on.
 */
export function foundValues(oracle, intents) {
  if (oracle.kind !== "state") return [];
  const out = [];
  const walk = (v, key) => {
    if (key === "name" || key === "path") return;
    if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if ((typeof v === "string" && /\d/.test(v)) || (typeof v === "number" && Math.abs(v) >= 10)) {
      if (!intents.some((i) => said(i, v))) out.push(v);
    }
  };
  walk(oracle.checks);
  return out;
}

/**
 * Why a step's criteria break the rules, or null: `lo` to `hi` of them, each a non-empty string of at most
 * MAX_CRITERION characters, none rewarding a door or a reply style, none stating a value any step's key expects or
 * the agent must find (`oracles`, the task's every key; `intents`, its every prompt), none naming what the template
 * says the task must find (`hidden`). `where` opens the reason ("step 2").
 */
export function criteriaProblem(criteria, { where, lo, hi, oracles = [], intents = [], hidden = [] }) {
  if (!Array.isArray(criteria) || criteria.length < lo || criteria.length > hi) return `${where} has ${criteria?.length ?? 0} rubric criteria, not ${lo} to ${hi}`;
  const keyed = oracles.flatMap((o) => [...expectedValues(o), ...foundValues(o, intents)]);
  for (const c of criteria) {
    if (typeof c !== "string" || !c.trim() || c.length > MAX_CRITERION) return `${where}: a criterion is empty or longer than ${MAX_CRITERION} characters`;
    for (const re of NOT_IN_A_RUBRIC) if (re.test(c)) return `${where}: a criterion rewards a door or a reply style (${re}): ${c}`;
    for (const v of keyed) if (said(c, v)) return `${where}: a criterion states the expected value ${v}`;
    for (const v of asList(hidden)) if (said(c, v)) return `${where}: a criterion names ${v}, which the task must find`;
  }
  return null;
}
