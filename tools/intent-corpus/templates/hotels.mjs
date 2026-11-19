/**
 * Hotel booking intent templates (apps/hotels, "Larchmere Stays"). Shaped on
 * the hotel journeys in GoogleChromeLabs/webmcp-tools' webmcp-evals (Apache-2.0):
 * find the only hotel that fits every requirement, say so when none does and
 * name the closest one, price a stay, book one, book the cheapest that fits,
 * and cancel one booking out of several. Those suites grade the tool calls an
 * agent makes; these grade the answer or the site's end state instead, so an
 * agent may use the pages, REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Availability is what most of these turn on: the generator books some room
 * types out for a few nights (packages/scenarios/src/sites/hotels/generate.ts), and
 * the search tasks are built around one such room — it would fit every
 * requirement if it were free. The rules every answer key is derived with are
 * @benchme/scenarios' stays rules, the same functions the site enforces.
 *
 * Claims: a booking or a cancellation changes which rooms are free, so every
 * task that depends on, or changes, what is free claims each night of its stay
 * in its city (`night:<city>:<date>`). A price quote depends on prices only.
 */
import { addDays, nightsOf, roomsLeft, searchStays, shuffle, stayTotalCents } from "../../../packages/scenarios/dist/index.js";
import { int, usd } from "../kit.mjs";

const APP = "hotels";
const BOOKINGS = "/api/v1/bookings";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New guests the booking tasks book for: names no seeded guest has, at a domain no seeded email uses. */
const GUEST_FIRST = ["Anouk", "Basil", "Corin", "Delphine", "Emeric", "Fenna"];
const GUEST_LAST = ["Arkwright", "Belloc", "Castellan", "Draycott", "Esterhazy", "Fairweather"];
/** No seeded stay starts after June 2027, so every room is free in the autumn: a quote is never asked of a room that is taken. */
const QUIET_FROM = "2027-09-06";

/** How an intent names each amenity; the site's filters take the bare key (`gym`). */
const AMENITY_TEXT = { gym: "a gym", breakfast: "breakfast", spa: "a spa", pool: "a pool", "free parking": "free parking", washer: "a washer", restaurant: "a restaurant", "airport shuttle": "an airport shuttle" };
const said = (a) => AMENITY_TEXT[a] ?? a;
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
const partyText = (adults, kids) => `${adults} adult${adults === 1 ? "" : "s"}${kids ? ` and ${kids} child${kids === 1 ? "" : "ren"}` : ""}`;
const extrasText = (pets, late) => `${pets ? ", bringing one dog" : ""}${late ? ", with late checkout" : ""}`;
const dollars = (cents) => `$${cents / 100}`;
const guestOf = (i) => {
  const first = GUEST_FIRST[i % GUEST_FIRST.length];
  const last = GUEST_LAST[Math.floor(i / GUEST_FIRST.length) % GUEST_LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@travel.example`.toLowerCase() };
};
const searchPath = (q) =>
  `/api/v1/search?${new URLSearchParams({
    city: q.city,
    checkIn: q.checkIn,
    nights: String(q.nights),
    adults: String(q.adults),
    kids: String(q.kids),
    pets: String(q.pets ?? 0),
    ...(q.amenities?.length ? { amenities: q.amenities.join(",") } : {}),
    ...(q.maxNightlyCents !== undefined ? { maxPrice: String(q.maxNightlyCents / 100) } : {}),
  })}`;
const book = (api, body) => api.post(APP, BOOKINGS, body);
/** Amenity pairs a hotel has, wifi left out (every hotel has it). */
const pairsOf = (hotel) => {
  const a = hotel.amenities.filter((x) => x !== "wifi");
  return a.flatMap((x, i) => a.slice(i + 1).map((y) => [x, y]));
};
const partyFor = (room, rng) => ({ adults: int(rng, 1, Math.min(2, room.maxAdults)), kids: room.maxKids > 0 && rng() < 0.4 ? 1 : 0 });

/**
 * Stays built around a room type that is booked out on at least one of their
 * nights: (room, hotel, checkIn, nights) for every booked-out night, 2 or 3
 * nights long, starting on that night or the one before.
 */
function aroundBookedOut(ctx) {
  const { rooms, bookings } = ctx.rows.hotels;
  const seen = new Set();
  const out = [];
  for (const room of rooms) {
    const nights = new Set(bookings.filter((b) => b.roomCode === room.code && b.status === "confirmed").flatMap((b) => nightsOf(b.checkIn, b.nights)));
    for (const night of [...nights].sort()) {
      if (roomsLeft(room, bookings, night, 1) > 0) continue;
      for (const length of [2, 3]) {
        for (const back of [0, 1]) {
          const checkIn = addDays(night, -back);
          const key = `${room.code}:${checkIn}:${length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ room, hotel: ctx.hotel.get(room.hotelCode), checkIn, nights: length, i: out.length });
        }
      }
    }
  }
  return out;
}

export const hotelTemplates = [
  {
    key: "stay-only-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which hotel in a city has a room free for a stay that fits the party, under a nightly cap, with two named amenities. Exactly one does (`searchStays`), and each requirement matters: without the cap, or without the amenities, two or more would. One more hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights (any other room of it that fits is over the cap). The miss names that hotel.",
    candidates: aroundBookedOut,
    claims: (s) => nightClaims(s.hotel.city, s.checkIn, s.nights),
    build({ room, hotel, checkIn, nights }, ctx, rng) {
      const rows = ctx.rows.hotels;
      const { adults, kids } = partyFor(room, rng);
      const base = { city: hotel.city, checkIn, nights, adults, kids, pets: 0 };
      for (const amenities of shuffle(rng, pairsOf(hotel))) {
        const withAmenities = searchStays(rows, { ...base, amenities });
        if (withAmenities.length < 2) continue;
        // Caps at whole $10s. The taken room must be within the cap, so the hotel is out only because that room is
        // taken: a room of it that is free is either over the cap or would make it a second match.
        const caps = [...new Set([room.nightlyCents, ...withAmenities.map((o) => o.nightlyCents)].map((c) => Math.ceil(c / 1000) * 1000))].sort((x, y) => x - y);
        for (const cap of caps) {
          if (room.nightlyCents > cap) continue;
          const matches = withAmenities.filter((o) => o.nightlyCents <= cap);
          if (matches.length !== 1 || matches[0].hotelCode === hotel.code || searchStays(rows, { ...base, maxNightlyCents: cap }).length < 2) continue;
          const q = { ...base, amenities, maxNightlyCents: cap };
          const party = partyText(adults, kids);
          return {
            intent: `On the hotel booking site, which hotel in ${hotel.city} has a room free for ${nights} nights from ${checkIn} for ${party}, at no more than ${dollars(cap)} a night, with both ${said(amenities[0])} and ${said(amenities[1])}? Answer as JSON: {"hotel": "<the hotel's code, HT-…>"}.`,
            summary: `The one ${hotel.city} hotel with a free room that fits the party, within the cap, with both amenities.`,
            oracle: { kind: "json", expect: { hotel: matches[0].hotelCode } },
            note: `${hotel.city} ${checkIn} × ${nights}, ${party}, ≤ ${dollars(cap)}, ${amenities.join(" + ")} → ${matches[0].hotelCode}; ${hotel.code} fits too but ${room.code} is booked out`,
            answer: async (api) => ({ hotel: api.only(await api.get(APP, searchPath(q))).hotelCode }),
            miss: async () => ({ hotel: hotel.code }),
          };
        }
      }
      return null;
    },
  },
  {
    key: "stay-no-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any hotel in a city has a room free for a stay that fits the party, under a nightly cap, with two named amenities — none does — and which hotel comes closest: the cheapest with a free room that fits and both amenities, at any price (no tie for cheapest). The cap alone and the amenities alone can each be met. One hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights. The miss says one exists.",
    candidates: aroundBookedOut,
    claims: (s) => nightClaims(s.hotel.city, s.checkIn, s.nights),
    build({ room, hotel, checkIn, nights }, ctx, rng) {
      const rows = ctx.rows.hotels;
      const { adults, kids } = partyFor(room, rng);
      const base = { city: hotel.city, checkIn, nights, adults, kids, pets: 0 };
      const cap = Math.ceil(room.nightlyCents / 1000) * 1000;
      for (const amenities of shuffle(rng, pairsOf(hotel))) {
        const withAmenities = searchStays(rows, { ...base, amenities });
        if (withAmenities.length === 0) continue;
        const [closest, next] = withAmenities;
        if (closest.nightlyCents <= cap || (next && next.nightlyCents === closest.nightlyCents)) continue;
        if (searchStays(rows, { ...base, maxNightlyCents: cap }).length === 0) continue;
        const party = partyText(adults, kids);
        return {
          intent: `On the hotel booking site, is there a hotel in ${hotel.city} with a room free for ${nights} nights from ${checkIn} for ${party}, at no more than ${dollars(cap)} a night, with both ${said(amenities[0])} and ${said(amenities[1])}? Also name the hotel that comes closest: the cheapest one with a room free on those nights for that party and both ${said(amenities[0])} and ${said(amenities[1])}, at any price. Answer as JSON: {"exists": <true or false>, "closest": "<the hotel's code, HT-…>"}.`,
          summary: `No ${hotel.city} hotel meets every requirement; the closest is the cheapest with both amenities at any price.`,
          oracle: { kind: "json", expect: { exists: false, closest: closest.hotelCode } },
          note: `${hotel.city} ${checkIn} × ${nights}, ${party}, ≤ ${dollars(cap)}, ${amenities.join(" + ")} → none; closest ${closest.hotelCode} at ${usd(closest.nightlyCents)}; ${hotel.code}'s ${room.code} would fit but is booked out`,
          answer: async (api) => ({
            exists: (await api.get(APP, searchPath({ ...base, amenities, maxNightlyCents: cap }))).length > 0,
            closest: (await api.get(APP, searchPath({ ...base, amenities })))[0]?.hotelCode ?? "",
          }),
          miss: async () => ({ exists: true, closest: hotel.code }),
        };
      }
      return null;
    },
  },
  {
    key: "stay-quote",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What a named stay costs in total: one room type for some nights, with one dog where the hotel allows pets and late checkout where it offers it — at least one of the two applies. nights × nightly price + the pet fee (once per stay) + the late-checkout fee (`stayTotalCents`), ±0.01. Asked of autumn dates, when no seeded booking holds a room. The miss is the nights alone.",
    candidates: (ctx) => ctx.rows.hotels.rooms.filter((r) => {
      const h = ctx.hotel.get(r.hotelCode);
      return h.petsAllowed || h.lateCheckoutUntil;
    }),
    claims: (room) => [`room:${room.code}`],
    build(room, ctx, rng) {
      const hotel = ctx.hotel.get(room.hotelCode);
      const nights = int(rng, 2, 5);
      const checkIn = addDays(QUIET_FROM, int(rng, 0, 60));
      const adults = int(rng, 1, room.maxAdults);
      const kids = room.maxKids > 0 && rng() < 0.4 ? 1 : 0;
      const pets = hotel.petsAllowed ? 1 : 0;
      const late = !!hotel.lateCheckoutUntil;
      const total = stayTotalCents(hotel, room, { nights, pets, lateCheckout: late }) / 100;
      return {
        intent: `On the hotel booking site, what would this stay at ${hotel.name} (${hotel.code}) cost in total: one ${room.name} (${room.code}) for ${nights} nights from ${checkIn}, for ${partyText(adults, kids)}${extrasText(pets, late)}? Answer as JSON: {"total": <dollars>}.`,
        summary: `${nights} nights at ${room.code}'s nightly price, plus the hotel's fees for what the stay adds.`,
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 } } },
        note: `${room.code} × ${nights} at ${usd(room.nightlyCents)}${pets ? ` + pet fee ${usd(hotel.petFeeCents)}` : ""}${late ? ` + late checkout ${usd(hotel.lateCheckoutFeeCents)}` : ""} → $${total.toFixed(2)}`,
        answer: async (api) => {
          const h = await api.get(APP, `/api/v1/hotels/${hotel.code}`);
          const r = h.rooms.find((x) => x.code === room.code);
          return { total: (r.nightlyCents * nights + (pets ? h.petFeeCents : 0) + (late ? h.lateCheckoutFeeCents : 0)) / 100 };
        },
        miss: async (api) => {
          const h = await api.get(APP, `/api/v1/hotels/${hotel.code}`);
          return { total: (h.rooms.find((x) => x.code === room.code).nightlyCents * nights) / 100 };
        },
      };
    },
  },
  {
    key: "stay-book",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book a named room type for a new guest (a name and email no seeded booking has): dates, party, and late checkout where the hotel offers it, else a dog where it allows pets. The check reads the guest's bookings: exactly one confirmed booking of that room type from that date, with the nights, party and extras asked. The miss books it without the extra, or one night short when there is none.",
    candidates: (ctx) =>
      ctx.rows.hotels.rooms.flatMap((room, i) =>
        [17, 45, 73, 101].map((day, j) => ({ room, hotel: ctx.hotel.get(room.hotelCode), checkIn: addDays("2027-03-01", day + (i % 7)), nights: 2 + ((i + j) % 3), guest: guestOf(i * 4 + j) })),
      ).filter((s) => roomsLeft(s.room, ctx.rows.hotels.bookings, s.checkIn, s.nights) > 0),
    claims: (s) => [`room:${s.room.code}`, `guest:${s.guest.email}`, ...nightClaims(s.hotel.city, s.checkIn, s.nights)],
    build({ room, hotel, checkIn, nights, guest }, ctx, rng) {
      const { adults, kids } = partyFor(room, rng);
      const late = !!hotel.lateCheckoutUntil;
      const pets = !late && hotel.petsAllowed ? 1 : 0;
      const body = { roomCode: room.code, hotelCode: hotel.code, checkIn, nights, adults, kids, pets, lateCheckout: late, guestName: guest.name, guestEmail: guest.email };
      const short = late || pets ? { ...body, pets: 0, lateCheckout: false } : { ...body, nights: nights - 1 };
      return {
        intent: `On the hotel booking site, book the ${room.name} (${room.code}) at ${hotel.name} for ${guest.name} (${guest.email}): ${nights} nights from ${checkIn}, for ${partyText(adults, kids)}${extrasText(pets, late)}.`,
        summary: `${guest.email} has one confirmed booking of ${room.code} from ${checkIn} with the nights, party and extras asked.`,
        oracle: {
          kind: "state",
          checks: [
            {
              name: "booked",
              app: APP,
              path: `${BOOKINGS}?guestEmail=${encodeURIComponent(guest.email)}`,
              where: { roomCode: room.code, checkIn, status: "confirmed" },
              count: { min: 1, max: 1 },
              expect: { nights, adults, kids, pets, lateCheckout: late },
            },
          ],
        },
        note: `${guest.email} → ${room.code}, ${checkIn} × ${nights}, ${partyText(adults, kids)}${extrasText(pets, late)}`,
        solve: (api) => book(api, body),
        miss: (api) => book(api, short),
      };
    },
  },
  {
    key: "stay-book-cheapest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book, for a new guest, the cheapest room in a city that fits the party, is free every night, and is in a hotel with a named amenity (`searchStays`, first offer; strictly cheaper than the next). A cheaper room in a hotel with that amenity fits the party but is booked out on one of the nights. The check: exactly one confirmed booking for the guest, of that room type, those dates and that party. The miss books the second-cheapest.",
    candidates: (ctx) => aroundBookedOut(ctx).map((s) => ({ ...s, guest: guestOf(s.i + 7) })),
    claims: (s) => [`guest:${s.guest.email}`, ...nightClaims(s.hotel.city, s.checkIn, s.nights)],
    build({ room, hotel, checkIn, nights, guest }, ctx, rng) {
      const rows = ctx.rows.hotels;
      const { adults, kids } = partyFor(room, rng);
      const base = { city: hotel.city, checkIn, nights, adults, kids, pets: 0 };
      for (const amenity of shuffle(rng, hotel.amenities.filter((a) => a !== "wifi"))) {
        const offers = searchStays(rows, { ...base, amenities: [amenity] });
        if (offers.length < 2) continue;
        const [best, next] = offers;
        if (room.nightlyCents >= best.nightlyCents || next.nightlyCents === best.nightlyCents) continue;
        const bodyFor = (o) => ({ roomCode: o.roomCode, hotelCode: o.hotelCode, checkIn, nights, adults, kids, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email });
        const party = partyText(adults, kids);
        return {
          intent: `On the hotel booking site, book a room for ${guest.name} (${guest.email}) for ${nights} nights from ${checkIn}, for ${party}: the cheapest room in ${hotel.city} that fits them, is free on every one of those nights, and is in a hotel with ${said(amenity)}.`,
          summary: `${guest.email} has one confirmed booking: the cheapest free room in ${hotel.city} that fits, in a hotel with ${said(amenity)}, for those dates.`,
          oracle: {
            kind: "state",
            checks: [
              {
                name: "booked-cheapest",
                app: APP,
                path: `${BOOKINGS}?guestEmail=${encodeURIComponent(guest.email)}`,
                where: { status: "confirmed" },
                count: { min: 1, max: 1 },
                expect: { hotelCode: best.hotelCode, roomCode: best.roomCode, checkIn, nights, adults, kids },
              },
            ],
          },
          note: `${hotel.city} ${checkIn} × ${nights}, ${party}, ${amenity} → ${best.roomCode} at ${usd(best.nightlyCents)}; ${room.code} at ${usd(room.nightlyCents)} is booked out`,
          solve: async (api) => book(api, bodyFor((await api.get(APP, searchPath({ ...base, amenities: [amenity] })))[0])),
          miss: async (api) => book(api, bodyFor((await api.get(APP, searchPath({ ...base, amenities: [amenity] })))[1])),
        };
      }
      return null;
    },
  },
  {
    key: "stay-cancel-one",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel one of a seeded guest's confirmed bookings, named by its hotel and check-in date, and leave the guest's other confirmed bookings alone. Asked of a guest with at least two confirmed bookings, where no other booking of theirs has the same hotel and date. One check per confirmed booking of the guest: `cancelled` for the one named, `confirmed` for the rest. The miss cancels all of them.",
    candidates: (ctx) => {
      const byGuest = new Map();
      for (const b of ctx.rows.hotels.bookings) byGuest.set(b.guestEmail, [...(byGuest.get(b.guestEmail) ?? []), b]);
      return [...byGuest.values()].flatMap((all) => {
        const live = all.filter((b) => b.status === "confirmed");
        if (live.length < 2) return [];
        return live.filter((t) => all.filter((b) => b.hotelCode === t.hotelCode && b.checkIn === t.checkIn).length === 1).map((target) => ({ target, live }));
      });
    },
    claims: ({ target }, ctx) => [`guest:${target.guestEmail}`, ...nightClaims(ctx.hotel.get(target.hotelCode).city, target.checkIn, target.nights)],
    build({ target, live }, ctx) {
      const hotel = ctx.hotel.get(target.hotelCode);
      const status = (b) => (b.bookingNo === target.bookingNo ? "cancelled" : "confirmed");
      const cancel = (api, no) => api.post(APP, `${BOOKINGS}/${no}/cancel`, {});
      return {
        intent: `On the hotel booking site, ${target.guestName} (${target.guestEmail}) has several bookings. Cancel only their stay at ${hotel.name} that starts on ${target.checkIn}, and leave their other bookings as they are.`,
        summary: `${target.guestEmail}'s booking at ${hotel.code} from ${target.checkIn} is cancelled; their other confirmed bookings are still confirmed.`,
        oracle: { kind: "state", checks: live.map((b) => ({ name: `${b.bookingNo}-${status(b)}`, app: APP, path: `${BOOKINGS}/${b.bookingNo}`, expect: { status: status(b) } })) },
        note: `${target.guestEmail}: ${target.bookingNo} (${hotel.code}, ${target.checkIn}) → cancelled; ${live.filter((b) => b !== target).map((b) => b.bookingNo).join(", ")} stay confirmed`,
        solve: async (api) => {
          const mine = await api.list(APP, `${BOOKINGS}?guestEmail=${encodeURIComponent(target.guestEmail)}`);
          await cancel(api, api.only(mine.filter((b) => b.hotelCode === hotel.code && b.checkIn === target.checkIn)).bookingNo);
        },
        miss: async (api) => {
          for (const b of live) await cancel(api, b.bookingNo);
        },
      };
    },
  },
];

