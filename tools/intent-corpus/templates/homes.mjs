/**
 * Home listings intent templates (apps/homes, "Corvane Homes"). Shaped on the
 * real-estate demo in GoogleChromeLabs/webmcp-tools (demos/real-estate-map and
 * webmcp-evals/examples/real-estate, Apache-2.0): filter listings by city,
 * type, price, bedrooms and features, open one listing's details — plus the
 * viewing appointments a buyer books next. Those suites grade the tool calls
 * an agent makes; these grade the answer or the site's end state instead, so
 * an agent may use the pages, REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Listing status is what the search tasks turn on: a search with no status
 * returns pending and sold listings too, and each search task is built around
 * a pending or sold listing that would fit every other requirement. The
 * viewing tasks turn on the agents' slots: some agent days are fully booked
 * on purpose (packages/scenarios/src/sites/homes/generate.ts). The rules every
 * answer key is derived with are @benchme/scenarios' home rules, the same
 * functions the site enforces.
 *
 * Claims: a viewing request or a cancellation changes which slots of one
 * agent's day are free, so every task that depends on, or changes, an agent's
 * slots claims that agent day (`homes:agent-day:<agent>:<date>`); a viewer a
 * task writes for is claimed (`homes:viewer:<email>`). No task changes a
 * listing, so the listing tasks claim listings only to stay distinct: the
 * pending or sold listing a search task is built around
 * (`homes:near-miss:<code>`, shared by both search templates) and the answer
 * (`homes:<template>:<code>`).
 */
import { homeSlotsOf, homeYearlyCostsCents, searchHomeListings, shuffle } from "../../../packages/scenarios/dist/index.js";

const APP = "homes";
const VIEWINGS = "/api/v1/viewings";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New viewers the request tasks write for: names no seeded viewer has, at a domain no seeded email uses. Two pools, one per template. */
const BOOK_FIRST = ["Odile", "Pascoe", "Rhoswen", "Tamsin", "Ulric", "Wynne"];
const EARLY_FIRST = ["Aurelie", "Benedikt", "Clemence", "Dorian", "Eluned", "Florian"];
const NEW_LAST = ["Ashdown", "Brightwell", "Cardew", "Dunmore", "Elsworth", "Fanshawe"];

/** How an intent names each feature; the site's filters take the bare key (`garage`). */
const FEATURE_TEXT = {
  garage: "a garage",
  garden: "a garden",
  pool: "a pool",
  balcony: "a balcony",
  elevator: "an elevator",
  fireplace: "a fireplace",
  "solar panels": "solar panels",
  "air conditioning": "air conditioning",
  "home office": "a home office",
};
const listOf = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
/** "with at least 2 bedrooms, a garage and a garden", "…, where pets are allowed" — the features said the way a person says them. */
const withAll = (sizes, features) => {
  const things = features.filter((f) => f !== "pets allowed").map((f) => FEATURE_TEXT[f] ?? f);
  return `with ${listOf([...sizes, ...things])}${features.includes("pets allowed") ? ", where pets are allowed" : ""}`;
};
/** Each feature of the listing alone, then each pair of them. */
const featureSetsOf = (l) => [...l.features.map((f) => [f]), ...l.features.flatMap((f, i) => l.features.slice(i + 1).map((g) => [f, g]))];
const kindOf = (type, city) => `${type === "apartment" ? "an" : "a"} ${type} in ${city}`;
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US")}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A cap a person would type: the price rounded up to a whole $10,000. */
const capOf = (cents) => Math.ceil(cents / 1_000_000) * 1_000_000;
const describe = (l) => `${l.beds}-bedroom ${l.type} at ${l.address}, ${l.neighbourhood}, ${l.city}`;
/** The (min bedrooms, min bathrooms) a question about the listing can ask: each at most the listing's own, bedrooms at least one fewer. */
const sizesOf = (l) => [l.beds, l.beds - 1].filter((b) => b >= 1).flatMap((b) => Array.from({ length: l.baths }, (_, i) => [b, i + 1]));
const guestOf = (first, i) => {
  const name = `${first[i % first.length]} ${NEW_LAST[Math.floor(i / first.length) % NEW_LAST.length]}`;
  return { name, email: `${name.replace(" ", ".")}@homebuyer.example`.toLowerCase() };
};
const dayClaim = (agentCode, date) => `homes:agent-day:${agentCode}:${date}`;
const listingsPath = (q) =>
  `/api/v1/listings?${new URLSearchParams({
    city: q.city,
    type: q.types.join(","),
    ...(q.minBeds !== undefined ? { minBeds: String(q.minBeds) } : {}),
    ...(q.minBaths !== undefined ? { minBaths: String(q.minBaths) } : {}),
    ...(q.features?.length ? { features: q.features.join(",") } : {}),
    ...(q.maxPriceCents !== undefined ? { maxPrice: String(q.maxPriceCents / 100) } : {}),
    ...(q.status ? { status: q.status } : {}),
  })}`;
const request = (api, listing, slot, guest) => api.post(APP, VIEWINGS, { listingCode: listing.code, date: slot.date, time: slot.time, viewerName: guest.name, viewerEmail: guest.email });
/** One requested viewing for the guest, of that listing in that slot. */
const requestedCheck = (name, guest, listing, slot) => ({
  name,
  app: APP,
  path: `${VIEWINGS}?email=${encodeURIComponent(guest.email)}`,
  where: { status: "requested" },
  count: { min: 1, max: 1 },
  expect: { listingCode: listing.code, date: slot.date, time: slot.time },
});

export const homesTemplates = [
  {
    key: "home-only-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which active listing in a city is of a named type, with at least so many bedrooms and bathrooms, a named feature, at no more than a price cap. Exactly one is (`searchHomeListings` with `status: active`), and the feature and the cap each matter: without either, two or more active listings would fit. A pending listing fits every other requirement; a search without the status filter returns it too. The miss names that pending listing.",
    // Every (pending listing, feature, size, cap) that yields one active match; the claims cover the answer too, so no two tasks share one.
    candidates: (ctx) => {
      const { listings } = ctx.rows.homes;
      const out = [];
      for (const p of listings.filter((l) => l.status === "pending")) {
        for (const feature of p.features) {
          for (const [minBeds, minBaths] of sizesOf(p)) {
            const base = { city: p.city, types: [p.type], minBeds, minBaths, status: "active" };
            const withFeature = searchHomeListings(listings, { ...base, features: [feature] });
            if (withFeature.length < 2) continue;
            for (const cap of [...new Set([p.priceCents, ...withFeature.map((l) => l.priceCents)].map(capOf))].sort((x, y) => x - y)) {
              const matches = withFeature.filter((l) => l.priceCents <= cap);
              if (p.priceCents > cap || matches.length !== 1 || searchHomeListings(listings, { ...base, maxPriceCents: cap }).length < 2) continue;
              out.push({ p, q: { ...base, features: [feature], maxPriceCents: cap }, match: matches[0] });
              break;
            }
          }
        }
      }
      return out;
    },
    claims: ({ p, match }) => [`homes:near-miss:${p.code}`, `homes:only-match:${match.code}`],
    build({ p, q, match }) {
      const sizes = [`at least ${plural(q.minBeds, "bedroom")}`, `at least ${plural(q.minBaths, "bathroom")}`];
      return {
        intent: `On the home listings site, which active listing (not pending or sold) is ${kindOf(p.type, p.city)} ${withAll(sizes, q.features)}, at an asking price of no more than ${dollars(q.maxPriceCents)}? Answer as JSON: {"listing": "<the listing's code, LS-…>"}.`,
        summary: `The one active ${p.city} listing of that type, size and feature within the price cap.`,
        oracle: { kind: "json", expect: { listing: match.code } },
        note: `${p.city}, ${p.type}, ≥ ${q.minBeds} bed, ≥ ${q.minBaths} bath, ${q.features[0]}, ≤ ${dollars(q.maxPriceCents)} → ${match.code} at ${dollars(match.priceCents)}; ${p.code} at ${dollars(p.priceCents)} fits too but is pending`,
        answer: async (api) => ({ listing: api.only(await api.get(APP, listingsPath(q))).code }),
        miss: async () => ({ listing: p.code }),
      };
    },
  },
  {
    key: "home-no-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any active listing in a city is of a named type, with at least so many bedrooms and bathrooms, one or two named features, at no more than a price cap — none is — and which comes closest: the cheapest active listing of that type, size and features at any price (no tie for cheapest). The cap is the highest whole $10,000 below that closest listing's price, and an active listing of that type is within it. A pending or sold listing fits every requirement. The miss says one exists and names that listing.",
    // Every (pending or sold listing, features, size) whose closest active match is above a cap the listing is within; the claims cover the closest too.
    candidates: (ctx) => {
      const { listings } = ctx.rows.homes;
      const out = [];
      for (const p of listings.filter((l) => l.status !== "active")) {
        for (const features of featureSetsOf(p)) {
          for (const [minBeds, minBaths] of sizesOf(p)) {
            const base = { city: p.city, types: [p.type], minBeds, minBaths, status: "active" };
            const [closest, next] = searchHomeListings(listings, { ...base, features });
            if (!closest || (next && next.priceCents === closest.priceCents)) continue;
            // The highest whole $10,000 below the closest: the pending or sold listing must still be within it.
            const cap = Math.floor((closest.priceCents - 1) / 1_000_000) * 1_000_000;
            if (p.priceCents > cap || searchHomeListings(listings, { city: p.city, types: [p.type], status: "active", maxPriceCents: cap }).length === 0) continue;
            out.push({ p, base, features, cap, closest });
          }
        }
      }
      return out;
    },
    claims: ({ p, closest }) => [`homes:near-miss:${p.code}`, `homes:no-match:${closest.code}`],
    build({ p, base, features, cap, closest }) {
      const kind = `${kindOf(p.type, p.city)} ${withAll([`at least ${plural(base.minBeds, "bedroom")}`, `at least ${plural(base.minBaths, "bathroom")}`], features)}`;
      return {
        intent: `On the home listings site, is there an active listing (not pending or sold) that is ${kind}, at an asking price of no more than ${dollars(cap)}? Also name the listing that comes closest: the cheapest active listing that is ${kind}, at any price. Answer as JSON: {"exists": <true or false>, "closest": "<the listing's code, LS-…>"}.`,
        summary: `No active ${p.city} listing meets every requirement; the closest is the cheapest active one of that type, size and features at any price.`,
        oracle: { kind: "json", expect: { exists: false, closest: closest.code } },
        note: `${p.city}, ${p.type}, ≥ ${base.minBeds} bed, ≥ ${base.minBaths} bath, ${features.join(" + ")}, ≤ ${dollars(cap)} → none; closest ${closest.code} at ${dollars(closest.priceCents)}; ${p.code} at ${dollars(p.priceCents)} fits but is ${p.status}`,
        answer: async (api) => ({
          exists: (await api.get(APP, listingsPath({ ...base, features, maxPriceCents: cap }))).length > 0,
          closest: (await api.get(APP, listingsPath({ ...base, features })))[0]?.code ?? "",
        }),
        miss: async () => ({ exists: true, closest: p.code }),
      };
    },
  },
  {
    key: "home-yearly-costs",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What a named listing's service fee and property tax come to over one year: twelve times the monthly service fee plus the annual property tax (`homeYearlyCostsCents`), ±0.01. Asked of listings with both. The miss counts the monthly fee once.",
    candidates: (ctx) => ctx.rows.homes.listings.filter((l) => l.monthlyFeeCents > 0 && l.annualTaxCents > 0),
    claims: (l) => [`homes:yearly-costs:${l.code}`],
    build(l) {
      const total = homeYearlyCostsCents(l) / 100;
      return {
        intent: `On the home listings site, what do the service fee and the property tax of the ${describe(l)} (${l.code}) add up to over one year? Answer as JSON: {"total": <dollars>}.`,
        summary: `${l.code}'s service fee for twelve months plus its annual property tax.`,
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 } } },
        note: `${l.code}: 12 × ${dollars(l.monthlyFeeCents)} + ${dollars(l.annualTaxCents)} → $${total.toFixed(2)}`,
        answer: async (api) => {
          const x = await api.get(APP, `/api/v1/listings/${l.code}`);
          return { total: (x.monthlyFeeCents * 12 + x.annualTaxCents) / 100 };
        },
        miss: async (api) => {
          const x = await api.get(APP, `/api/v1/listings/${l.code}`);
          return { total: (x.monthlyFeeCents + x.annualTaxCents) / 100 };
        },
      };
    },
  },
  {
    key: "home-viewing-earliest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Request, for a new viewer, the earliest free viewing slot of a named listing that starts at or after the first slot of a day its agent is fully booked (`homeSlotsOf`, first free slot from then on, so on a later day). The agent has a free slot earlier in the window. The check: exactly one requested viewing for the viewer, of that listing in that slot. The miss takes the agent's earliest free slot in the window, before the time asked.",
    candidates: (ctx) => {
      const rows = ctx.rows.homes;
      const out = [];
      for (const day of rows.agentDays) {
        const slots = homeSlotsOf(rows, day.agentCode);
        const today = slots.filter((s) => s.date === day.date);
        const answer = slots.find((s) => s.free && s.date > day.date);
        const miss = slots.find((s) => s.free);
        if (today.some((s) => s.free) || !answer || !miss || miss.date >= day.date) continue;
        const days = [...new Set(slots.filter((s) => s.date >= miss.date && s.date <= answer.date).map((s) => s.date))];
        for (const listing of rows.listings.filter((l) => l.agentCode === day.agentCode && l.status === "active")) {
          out.push({ listing, day, answer, miss, days, guest: guestOf(EARLY_FIRST, out.length) });
        }
      }
      return out;
    },
    claims: (s) => [`homes:viewer:${s.guest.email}`, ...s.days.map((d) => dayClaim(s.day.agentCode, d))],
    build({ listing, day, answer, miss, guest }) {
      return {
        intent: `On the home listings site, request a viewing of the ${describe(listing)} (${listing.code}) for ${guest.name} (${guest.email}) in the earliest free viewing slot that starts at or after ${day.from} on ${day.date}.`,
        summary: `${guest.email} has one requested viewing of ${listing.code}: its agent's first free slot from ${day.date} ${day.from} on.`,
        oracle: { kind: "state", checks: [requestedCheck("requested-earliest", guest, listing, answer)] },
        note: `${listing.code} (${listing.agentCode}): ${day.date} is fully booked → ${answer.date} ${answer.time}; the earliest free slot in the window is ${miss.date} ${miss.time}`,
        solve: async (api) => {
          const free = await api.get(APP, `/api/v1/listings/${listing.code}/slots?from=${day.date}T${day.from}&free=true`);
          await request(api, listing, free[0], guest);
        },
        miss: (api) => request(api, listing, miss, guest),
      };
    },
  },
  {
    key: "home-viewing-book",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Request a viewing of a named active listing for a new viewer (a name and email no seeded request has) in a named free slot: a date and a start time. The check reads the viewer's requests: exactly one requested viewing, of that listing in that slot. The miss takes the next free slot of the same agent that day, 30 minutes or more off.",
    candidates: (ctx) => {
      const rows = ctx.rows.homes;
      const out = [];
      for (const listing of rows.listings.filter((l) => l.status === "active")) {
        const slots = homeSlotsOf(rows, listing.agentCode);
        for (const date of [...new Set(slots.map((s) => s.date))]) {
          const free = slots.filter((s) => s.date === date && s.free);
          if (free.length < 2) continue;
          const at = out.length % (free.length - 1);
          out.push({ listing, slot: free[at], miss: free[at + 1], guest: guestOf(BOOK_FIRST, out.length) });
        }
      }
      return out;
    },
    claims: (s) => [`homes:viewer:${s.guest.email}`, dayClaim(s.listing.agentCode, s.slot.date)],
    build({ listing, slot, miss, guest }) {
      return {
        intent: `On the home listings site, request a viewing of the ${describe(listing)} (${listing.code}) for ${guest.name} (${guest.email}) on ${slot.date} at ${slot.time}.`,
        summary: `${guest.email} has one requested viewing of ${listing.code} on ${slot.date} at ${slot.time}.`,
        oracle: { kind: "state", checks: [requestedCheck("requested", guest, listing, slot)] },
        note: `${guest.email} → ${listing.code} (${listing.agentCode}), ${slot.date} ${slot.time}`,
        solve: (api) => request(api, listing, slot, guest),
        miss: (api) => request(api, listing, miss, guest),
      };
    },
  },
  {
    key: "home-viewing-cancel-one",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel one of a seeded viewer's requested viewings, named by its listing and date, and leave the viewer's other requests alone. Asked of a viewer with at least two requested viewings, where no other request of theirs is for the same listing on the same date. One check per requested viewing of the viewer: `cancelled` for the one named, `requested` for the rest. The miss cancels all of them.",
    candidates: (ctx) => {
      const byViewer = new Map();
      for (const v of ctx.rows.homes.viewings) byViewer.set(v.viewerEmail, [...(byViewer.get(v.viewerEmail) ?? []), v]);
      return [...byViewer.values()].flatMap((all) => {
        const live = all.filter((v) => v.status === "requested");
        if (live.length < 2) return [];
        return live.filter((t) => all.filter((v) => v.listingCode === t.listingCode && v.date === t.date).length === 1).map((target) => ({ target, live }));
      });
    },
    claims: ({ target, live }) => [`homes:viewer:${target.viewerEmail}`, ...live.map((v) => dayClaim(v.agentCode, v.date))],
    build({ target, live }, ctx) {
      const listing = ctx.rows.homes.listings.find((l) => l.code === target.listingCode);
      const status = (v) => (v.viewingNo === target.viewingNo ? "cancelled" : "requested");
      const cancel = (api, no) => api.post(APP, `${VIEWINGS}/${no}/cancel`, {});
      return {
        intent: `On the home listings site, ${target.viewerName} (${target.viewerEmail}) has requested several viewings. Cancel only their viewing of the ${describe(listing)} (${listing.code}) on ${target.date}, and leave their other viewing requests as they are.`,
        summary: `${target.viewerEmail}'s viewing of ${listing.code} on ${target.date} is cancelled; their other requested viewings are still requested.`,
        oracle: { kind: "state", checks: live.map((v) => ({ name: `${v.viewingNo}-${status(v)}`, app: APP, path: `${VIEWINGS}/${v.viewingNo}`, expect: { status: status(v) } })) },
        note: `${target.viewerEmail}: ${target.viewingNo} (${listing.code}, ${target.date} ${target.time}) → cancelled; ${live.filter((v) => v !== target).map((v) => v.viewingNo).join(", ")} stay requested`,
        solve: async (api) => {
          const mine = await api.list(APP, `${VIEWINGS}?email=${encodeURIComponent(target.viewerEmail)}`);
          await cancel(api, api.only(mine.filter((v) => v.listingCode === listing.code && v.date === target.date)).viewingNo);
        },
        miss: async (api) => {
          for (const v of live) await cancel(api, v.viewingNo);
        },
      };
    },
  },
];
