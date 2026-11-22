import { int, pick, substream, type Rng } from "../prng.js";
import type { SiteAccount, SiteAccounts } from "../scenario.js";
import type { SiteRows } from "../sites/rows.js";

/** How many people of each site's rows get an account of their own. */
export const ACCOUNTS_PER_SITE = 4;

const WORDS = ["amber", "birch", "cedar", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel", "linden", "marble", "nectar", "orchid", "pewter"] as const;

/** A password a person can type: two words and four digits, from the site's own stream. */
const passwordOf = (rng: Rng) => `${pick(rng, WORDS)}-${int(rng, 1000, 9999)}-${pick(rng, WORDS)}`;

/** People with something on the site, by email, each once, in email order; the first name seen for an email is kept. */
function people(list: readonly { email: string; name: string }[]): { email: string; name: string }[] {
  const byEmail = new Map<string, string>();
  for (const p of list) if (!byEmail.has(p.email.toLowerCase())) byEmail.set(p.email.toLowerCase(), p.name);
  return [...byEmail].map(([email, name]) => ({ email, name })).sort((a, b) => a.email.localeCompare(b.email));
}

/** Who on each site has something to act on: a booking, an order, a viewing, a prescription, a place in the directory. */
function candidates(rows: SiteRows): Record<keyof SiteAccounts, { email: string; name: string }[]> {
  return {
    hotels: people(rows.hotels.bookings.filter((b) => b.status === "confirmed").map((b) => ({ email: b.guestEmail, name: b.guestName }))),
    flights: people(rows.flights.bookings.filter((b) => b.status === "confirmed").map((b) => ({ email: b.contactEmail, name: b.passengers[0]?.name ?? b.contactEmail }))),
    dining: people(rows.dining.reservations.filter((r) => r.status === "confirmed").map((r) => ({ email: r.guestEmail, name: r.guestName }))),
    pizza: people(rows.pizza.orders.map((o) => ({ email: o.customerEmail, name: o.customerName }))),
    cinema: people(rows.cinema.bookings.filter((b) => b.status === "confirmed").map((b) => ({ email: b.customerEmail, name: b.customerName }))),
    sports: people(rows.sports.customers),
    homes: people(rows.homes.viewings.filter((v) => v.status === "requested").map((v) => ({ email: v.viewerEmail, name: v.viewerName }))),
    clinic: people(rows.clinic.patients),
    events: people(rows.events.people),
  };
}

/**
 * The accounts a cuj-v1 workspace starts with: on each site, a few of the
 * people its rows already have something for, signed up and verified, each
 * with a password. A task that asks someone to act on their own account says
 * who they are and their password; a task that asks for a new account signs
 * up with an email no account has. Drawn from a stream of their own
 * (`substream(seed, "cuj-v1:accounts:<app>")`), spread across each site's
 * people in email order, so the same seed gives the same accounts forever.
 */
export function siteAccounts(seed: number, rows: SiteRows): SiteAccounts {
  const out: SiteAccounts = {};
  for (const [app, list] of Object.entries(candidates(rows)) as [keyof SiteAccounts, { email: string; name: string }[]][]) {
    const rng = substream(seed, `cuj-v1:accounts:${app}`);
    const step = Math.max(1, Math.floor(list.length / ACCOUNTS_PER_SITE));
    const chosen: SiteAccount[] = [];
    for (let i = Math.min(int(rng, 0, step - 1), list.length - 1); i < list.length && chosen.length < ACCOUNTS_PER_SITE; i += step) {
      const p = list[i] as { email: string; name: string };
      chosen.push({ email: p.email, name: p.name, password: passwordOf(rng) });
    }
    out[app] = chosen;
  }
  return out;
}
