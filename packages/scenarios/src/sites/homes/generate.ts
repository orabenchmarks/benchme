import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { HOME_FEATURES, HOME_VIEWING_WINDOW, homeSlotTimes, homeViewingProblem } from "./rules.js";
import type { HomeAgent, HomeAgentDay, HomeListing, HomeRows, HomeType, HomeViewing, HomeListingStatus } from "./types.js";

/**
 * The home listings site's rows: listings in the six cities, two agents per
 * city, the days each agent shows homes in a fixed two-week window of June
 * 2027, and viewing requests already made. Drawn from a stream of its own
 * (`substream(seed, "homes")`), so adding the site moved no other row. Some
 * agent days are fully booked on purpose, some listings are pending or sold
 * (they cannot be viewed), some requests are cancelled, and most viewers hold
 * several requests.
 */
export const HOME_SIZES = { agentsPerCity: 2, listingsPerCity: [15, 18], neighbourhoodsPerCity: 3, viewers: 30, viewings: 110, fullDays: 10 } as const;

const NEIGHBOURHOOD_SUFFIXES = ["Heights", "Park", "Quarter", "Hill", "Gardens", "Village", "Fields"] as const;
const STREET_SUFFIXES = ["Street", "Road", "Lane", "Avenue", "Way", "Close", "Row"] as const;
/** The hours an agent shows homes on a working day. */
const HOURS = [
  { from: "09:00", until: "12:00" },
  { from: "10:00", until: "12:00" },
  { from: "13:00", until: "16:00" },
  { from: "14:00", until: "17:00" },
] as const;
type Feature = (typeof HOME_FEATURES)[number];
/** How often each feature appears, by home type. Only apartments have an elevator. */
const FEATURE_ODDS: Record<HomeType, Record<Feature, number>> = {
  house: { garage: 0.7, garden: 0.8, pool: 0.25, balcony: 0.1, elevator: 0, "pets allowed": 0.6, fireplace: 0.35, "solar panels": 0.2, "air conditioning": 0.5, "home office": 0.35 },
  apartment: { garage: 0.3, garden: 0.05, pool: 0.1, balcony: 0.7, elevator: 0.6, "pets allowed": 0.4, fireplace: 0.05, "solar panels": 0, "air conditioning": 0.55, "home office": 0.2 },
  townhouse: { garage: 0.5, garden: 0.5, pool: 0.1, balcony: 0.4, elevator: 0, "pets allowed": 0.5, fireplace: 0.2, "solar panels": 0.1, "air conditioning": 0.45, "home office": 0.3 },
};
/** Listed before the viewing window opens. */
const LISTED_FROM = "2027-01-04";
const LISTED_DAYS = 140;

function typeOf(rng: Rng): HomeType {
  const r = rng();
  return r < 0.4 ? "house" : r < 0.8 ? "apartment" : "townhouse";
}

function statusOf(rng: Rng): HomeListingStatus {
  const r = rng();
  return r < 0.64 ? "active" : r < 0.86 ? "pending" : "sold";
}

function makeAgents(rng: Rng): HomeAgent[] {
  const out: HomeAgent[] = [];
  const names = new Set<string>();
  for (const city of CITY_LIST) {
    for (let i = 0; i < HOME_SIZES.agentsPerCity; i++) {
      let first = "";
      let last = "";
      do {
        first = pick(rng, FIRST_NAMES);
        last = word(rng, 2);
      } while (names.has(`${first} ${last}`));
      names.add(`${first} ${last}`);
      out.push({ code: `AG-${11 + out.length}`, name: `${first} ${last}`, city, email: `${first}.${last}@agents.example`.toLowerCase() });
    }
  }
  return out;
}

function makeListings(rng: Rng, agents: HomeAgent[]): HomeListing[] {
  const out: HomeListing[] = [];
  const addresses = new Set<string>();
  for (const city of CITY_LIST) {
    const perSqm = int(rng, 28, 65) * 100;
    const hoods = new Set<string>();
    while (hoods.size < HOME_SIZES.neighbourhoodsPerCity) hoods.add(`${word(rng, 2)} ${pick(rng, NEIGHBOURHOOD_SUFFIXES)}`);
    const hoodFactor = new Map([...hoods].map((h) => [h, 0.8 + int(rng, 0, 5) / 10]));
    const cityAgents = agents.filter((a) => a.city === city);
    const count = int(rng, HOME_SIZES.listingsPerCity[0], HOME_SIZES.listingsPerCity[1]);
    for (let i = 0; i < count; i++) {
      const type = typeOf(rng);
      const neighbourhood = pick(rng, [...hoods]);
      const beds = type === "apartment" ? int(rng, 1, 3) : type === "townhouse" ? int(rng, 2, 4) : int(rng, 2, 5);
      const baths = int(rng, 1, Math.min(type === "apartment" ? 2 : 3, beds));
      const areaSqm = type === "apartment" ? 30 + beds * 20 + int(rng, 0, 20) : type === "townhouse" ? 60 + beds * 20 + int(rng, 0, 25) : 80 + beds * 25 + int(rng, 0, 40);
      const priceCents = Math.max(1, Math.round((areaSqm * perSqm * (hoodFactor.get(neighbourhood) ?? 1)) / 5000)) * 5000 * 100;
      const yearBuilt = int(rng, 1928, 2026);
      const features = HOME_FEATURES.filter((f) => rng() < FEATURE_ODDS[type][f]);
      const monthlyFeeCents = (type === "apartment" ? int(rng, 30, 120) : type === "townhouse" ? int(rng, 16, 60) : rng() < 0.35 ? int(rng, 6, 24) : 0) * 500;
      const annualTaxCents = Math.round((priceCents * int(rng, 55, 140)) / 10000 / 100) * 100;
      let address = "";
      do address = `${int(rng, 2, 248)} ${word(rng, 2)} ${pick(rng, STREET_SUFFIXES)}`;
      while (addresses.has(address));
      addresses.add(address);
      out.push({
        code: `LS-${3101 + out.length}`,
        city,
        neighbourhood,
        address,
        type,
        priceCents,
        beds,
        baths,
        areaSqm,
        yearBuilt,
        features,
        monthlyFeeCents,
        annualTaxCents,
        status: statusOf(rng),
        listedOn: addDays(LISTED_FROM, int(rng, 0, LISTED_DAYS)),
        agentCode: pick(rng, cityAgents).code,
        description: `A ${beds}-bedroom ${type} on ${address} in ${neighbourhood}, ${city}, built in ${yearBuilt}.`,
      });
    }
  }
  return out;
}

/** The window's days except Sundays. */
function windowDays(): string[] {
  const out: string[] = [];
  for (let d: string = HOME_VIEWING_WINDOW.first; d <= HOME_VIEWING_WINDOW.last; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) out.push(d);
  return out;
}

function makeAgentDays(rng: Rng, agents: HomeAgent[]): HomeAgentDay[] {
  const days = windowDays();
  return agents.flatMap((a) =>
    shuffle(rng, days)
      .slice(0, int(rng, 5, 7))
      .sort()
      .map((date) => ({ agentCode: a.code, date, ...pick(rng, HOURS) })),
  );
}

function makeViewers(rng: Rng): { name: string; email: string }[] {
  const out = new Map<string, { name: string; email: string }>();
  while (out.size < HOME_SIZES.viewers) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@mail.example`.toLowerCase();
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email });
  }
  return [...out.values()];
}

export function homeRows(seed: number): HomeRows {
  const rng = substream(seed, "homes");
  const agents = makeAgents(rng);
  const listings = makeListings(rng, agents);
  const agentDays = makeAgentDays(rng, agents);
  const viewers = makeViewers(rng);
  const active = listings.filter((l) => l.status === "active");
  const viewings: HomeViewing[] = [];
  const request = (listing: HomeListing, date: string, time: string, viewer: { name: string; email: string }, status: HomeViewing["status"]): boolean => {
    const req = { listingCode: listing.code, date, time, viewerName: viewer.name, viewerEmail: viewer.email };
    if (status === "requested" && homeViewingProblem(listing, agentDays, viewings, req)) return false;
    viewings.push({
      viewingNo: `VW-${1001 + viewings.length}`,
      listingCode: listing.code,
      agentCode: listing.agentCode,
      date,
      time,
      viewerName: viewer.name,
      viewerEmail: viewer.email,
      status,
      createdAt: new Date(Date.UTC(2027, 4, 17 + int(rng, 0, 20), int(rng, 8, 21), int(rng, 0, 59))).toISOString(),
    });
    return true;
  };
  for (let i = 0; i < HOME_SIZES.viewings; i++) {
    const listing = pick(rng, active);
    const days = agentDays.filter((d) => d.agentCode === listing.agentCode);
    if (days.length === 0) continue;
    const day = pick(rng, days);
    request(listing, day.date, pick(rng, homeSlotTimes(day)), pick(rng, viewers), rng() < 0.12 ? "cancelled" : "requested");
  }
  // Fully booked on purpose: every slot of an agent's day taken.
  const showing = agentDays.filter((d) => active.some((l) => l.agentCode === d.agentCode));
  for (const day of shuffle(rng, showing).slice(0, HOME_SIZES.fullDays)) {
    const theirs = active.filter((l) => l.agentCode === day.agentCode);
    for (const time of homeSlotTimes(day)) {
      const listing = pick(rng, theirs);
      for (const viewer of shuffle(rng, viewers)) if (request(listing, day.date, time, viewer, "requested") || viewings.some((v) => v.status === "requested" && v.agentCode === day.agentCode && v.date === day.date && v.time === time)) break;
    }
  }
  return { agents, listings, agentDays, viewings };
}
