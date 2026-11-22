/**
 * What the cuj-v1 templates share: how a prompt names each site, new people
 * to book for, the shapes of a state step's checks, and the rubric criteria.
 *
 * A rubric criterion judges what a check cannot (contract § 5): that the reply
 * says truthfully what was done, that nothing was done that was not asked,
 * that an impossible request is refused with the site's reason, and that the
 * agent stayed on the sites the task names. The same criteria grade every
 * setup, so none names a tool, a door or a way of replying, none states a
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

export const PAGES_AND_TOOLS = ["pages", "tools"];

/**
 * The claim on a thing a task writes about (a write's subject in the ledger:
 * the room a booking is for, the flight, the restaurant). A task whose check
 * says nothing was written about it claims it too, so no other task in the
 * same workspace writes about it.
 */
export const about = (app, type, id) => `about:${app}:${type}:${id}`;
/** Money as a person writes it: "$1,450,000", "$12.50". */
export const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", cents % 100 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usdNumber = (cents) => Math.round(cents) / 100;
/** "the Zyom Trail Shoe in size 44, red (SP-101-RED-44)"; a one-size item has no size to name. */
export const variantText = (productName, v) => `the ${productName}${/^one size$/i.test(v.size) ? "" : ` in size ${v.size}`}, ${v.colour} (${v.sku})`;
export const money = (cents) => ({ value: usdNumber(cents), tolerance: 0.01 });

const FIRST = ["Aurelie", "Benedikt", "Calla", "Dorian", "Elodie", "Florian", "Greer", "Hollis", "Imogen", "Jasper", "Keira", "Lucan", "Mireille", "Nolan", "Ottilie", "Pascal", "Quinta", "Rafferty", "Sorrel", "Tamsin"];
const LAST = ["Ashdown", "Brightwell", "Corrigan", "Delacourt", "Everhart", "Fairbanks", "Greystone", "Holloway", "Ingram", "Juniper"];
/**
 * A new customer for a task to book for: a name and email no seeded row has (the domain is the corpus's own), the
 * same for the same (template, index) at every seed so a regenerated corpus does not move them.
 */
export function newPerson(key, i = 0) {
  const hash = (text) => {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  };
  const h = hash(`${key}:${i}`), n = hash(`${key}:${i}:number`);
  const first = FIRST[h % FIRST.length];
  const last = LAST[(h >>> 8) % LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}.${(n % 90000) + 10000}@journeys.example`.toLowerCase(), phone: `555 01${String(n % 100).padStart(2, "0")} ${String((n >>> 8) % 10000).padStart(4, "0")}` };
}

/** A password a person chooses for a new account in a prompt: long enough for every site, never reused. */
export const passwordFor = (email) => `Journey-${[...email].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9000, 7) + 1000}-go`;

// ─── A state step's checks (apps/verify/src/specs/spec.ts) ────────────────────────────────────────────────────────

/** A row check: a row is there that matches. `entity` lets the check report when the row was last written. */
export const row = (name, app, path, { expect, where, count, rowPath, entity } = {}) => ({ name, app, path, expect, ...(where ? { where } : {}), ...(count ? { count } : {}), ...(rowPath ? { rowPath } : {}), ...(entity ? { entity } : {}) });
/** An absent check: no row matches. */
export const absent = (name, app, path, { where, expect } = {}) => ({ kind: "absent", name, app, path, ...(where ? { where } : {}), ...(expect ? { expect } : {}) });
/** A ledger check: an entry matches (one matcher, or a list of which any will do). */
export const seen = (name, match, { after } = {}) => ({ kind: "ledger", name, match, ...(after ? { after } : {}) });
/** An unchanged check: no successful write in the scope (one, or a list), except the ones named. */
export const unchanged = (name, scope, { except, after } = {}) => ({ kind: "unchanged", name, scope, ...(except ? { except } : {}), ...(after ? { after } : {}) });
export const stateOracle = (...checks) => ({ kind: "state", checks });
export const jsonOracle = (expect) => ({ kind: "json", expect });
/** A successful write to one entity (an id, or "@<check>" for what an earlier check stood on), optionally after an earlier check: when a step made its change. */
export const wrote = (name, app, entity, action, { after } = {}) => seen(name, { app, entity, ...(action ? { action } : {}), outcome: "ok" }, { after });
/** The other things of a customer's that a task must leave alone: no successful write to any of them. */
export const leftAlone = (name, app, things) => unchanged(name, things.map((t) => ({ apps: [app], entity: t })));

/**
 * The checks of an impossible task: nothing was changed about the things it names (done to one, or made for
 * one: its entity or its subject), and the agent looked at one of them or was refused about one for the reason
 * the site gives (one code, or any of several). A run that did nothing reads nothing and is refused nothing, and
 * fails. `after` makes both count from an earlier step's entry.
 */
export function impossibleChecks({ app, things, code, after, actor }) {
  const codes = Array.isArray(code) ? code : [code];
  const who = actor === undefined ? {} : { actor };
  const scope = things.flatMap((t) => [{ apps: [app], entity: t }, { apps: [app], subject: t }]);
  const looked = things.map((t) => ({ app, entity: t, action: "read", outcome: "ok", ...who }));
  const refused = things.flatMap((t) => codes.flatMap((c) => [{ app, entity: t, outcome: "refused", code: c, ...who }, { app, subject: t, outcome: "refused", code: c, ...who }]));
  return [unchanged("nothing changed", scope, after ? { after } : {}), seen(actor === undefined ? "looked or was refused" : "looked or was refused, signed in as them", [...looked, ...refused], after ? { after } : {})];
}

/** A successful write by one signed-in account: the change was made as that person. */
export const asThem = (name, app, entity, action, email, { subject, after } = {}) => seen(name, { app, entity, ...(subject ? { subject } : {}), action, outcome: "ok", actor: email }, { after });
/** An emailed code confirmed an account: the sign-up a task asked for was finished. */
export const verified = (name, app, email) => seen(name, { app, entity: { type: "account", id: email }, action: "verify", outcome: "ok" });

// ─── Rubric criteria ────────────────────────────────────────────────────────────────────────────────────────────────

const stayed = (apps, inbox) => `The agent used only ${sitesText(apps)}${inbox ? " (and the workspace inbox, for a sign-up code)" : ""}, no other site and no outside source.`;
export const R = {
  /** An answer read from the site. */
  answer: (apps, what) => [
    `The answer gives ${what} as ${sitesText(apps)} shows it, not a guess.`,
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
