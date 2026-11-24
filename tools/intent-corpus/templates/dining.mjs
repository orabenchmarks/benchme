/**
 * Restaurant reservation intent templates (apps/dining, "Thistlecombe Tables"). Shaped
 * on the french-bistro demo in GoogleChromeLabs/webmcp-tools and its
 * webmcp-evals (Apache-2.0): book a table for a named guest with a seating
 * area and a special request. Around it: find the only restaurant that fits,
 * say so when none does and name the closest, the deposit a private room
 * takes, book the earliest free time, and change one reservation out of a
 * guest's several. Those suites grade the tool calls an agent makes; these
 * grade the answer or the site's end state, so an agent may use the pages,
 * REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Free tables are what most of these turn on: the generator fills some areas
 * at some times on purpose (packages/scenarios/src/sites/dining/generate.ts),
 * and the search tasks are built around one such area — it would fit every
 * requirement if a table were free. Every answer key is derived with
 * @benchme/scenarios' dining rules, the same functions the site enforces.
 *
 * Claims: a new reservation changes which tables are free, so every task that
 * depends on, or changes, what is free claims its day in its city
 * (`dining:day:<city>:<date>`). A party-size change frees and takes no table;
 * a deposit depends on prices only.
 *
 * Expected calls: a booking's `create_reservation` with what the task fixes or
 * has the agent find (the restaurant, the area, the date, the time, the party,
 * the guest's email; the name, the phone and the special request left free,
 * which a run may write its own way: the site's check reads a request
 * whatever its case); a change's `change_reservation` of the reservation
 * named, with the new party. A deposit is in `get_restaurant` and in a search
 * at that time, and a search has more than one way, so no question declares a
 * call.
 */
import { addDays, diningAvailability, diningDepositCents, diningMinutes, diningSearch, diningSeatingTimes, diningTablesLeft, shuffle } from "../../../packages/scenarios/dist/index.js";
import { call, free } from "../calls.mjs";
import { int, usd } from "../kit.mjs";
import { R } from "../rubrics.mjs";

const APP = "dining";
const RESERVATIONS = "/api/v1/reservations";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New guests the booking tasks book for: names no seeded guest has, at a domain no seeded email uses. */
const GUEST_FIRST = ["Aurelie", "Benedikt", "Cosima", "Dorian", "Elodie", "Florian"];
const GUEST_LAST = ["Ashcombe", "Brightwater", "Calloway", "Dunmore", "Everleigh", "Fenwick"];
/** Special requests a booking task asks for word for word. */
const REQUESTS = [
  "Celebrating our anniversary, a quiet table please",
  "One guest has a severe nut allergy",
  "Please have a high chair ready for a toddler",
  "Birthday dinner, a candle on the dessert please",
  "One guest uses a wheelchair, a table near the entrance please",
  "We would like to sit away from the kitchen door",
  "Two guests are vegetarian, please note it on the order",
  "We are bringing a small cake for a birthday",
  "One guest is gluten intolerant",
  "Please seat us together, we may arrive separately",
];
/** No seeded reservation falls after May 2027, so every table is free in the autumn. */
const QUIET_FROM = "2027-09-06";
const AREA_TEXT = { indoor: "an indoor table", terrace: "a terrace table", bar: "a table at the bar", private: "a private room" };
const BUSY_DAYS = [3, 17, 31, 45];

const cache = new WeakMap();
/** The dining rows indexed once per corpus run (kit.mjs indexes the other sites). */
function index(ctx) {
  let x = cache.get(ctx.rows);
  if (!x) {
    const d = ctx.rows.dining;
    x = {
      rows: d,
      restaurant: new Map(d.restaurants.map((r) => [r.code, r])),
      seating: new Map(d.seating.map((s) => [`${s.restaurantCode}:${s.area}`, s])),
    };
    cache.set(ctx.rows, x);
  }
  return x;
}
const dayClaim = (city, date) => `dining:day:${city.toLowerCase()}:${date}`;
const guestOf = (i) => {
  const first = GUEST_FIRST[i % GUEST_FIRST.length];
  const last = GUEST_LAST[Math.floor(i / GUEST_FIRST.length) % GUEST_LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@table.example`.toLowerCase() };
};
const phoneOf = (rng) => `555-${int(rng, 200, 899)}-${int(rng, 1000, 9999)}`;
const partyFor = (s, rng) => (s.area === "private" ? int(rng, 6, s.seats) : int(rng, Math.min(2, s.seats), s.seats));
const searchPath = (q) =>
  `/api/v1/search?${new URLSearchParams({
    city: q.city,
    date: q.date,
    time: q.time,
    partySize: String(q.partySize),
    ...(q.area ? { area: q.area } : {}),
    ...(q.menus?.length ? { menus: q.menus.join(",") } : {}),
    ...(q.maxPriceLevel !== undefined ? { maxPriceLevel: String(q.maxPriceLevel) } : {}),
  })}`;
const availabilityPath = (code, date, partySize) => `/api/v1/restaurants/${code}/availability?date=${date}&partySize=${partySize}`;
const reserve = (api, body) => api.post(APP, RESERVATIONS, body);
/** The reservation a correct solution makes: the reference one's body, through the tool. */
const reservation = (body) => call("create_reservation", body, { guestName: free, guestPhone: free, ...(body.note ? { note: free } : {}) });
/** Half hours after `time`, to the latest any restaurant seats. */
const laterThan = (time) => Array.from({ length: Math.max(0, (diningMinutes("21:30") - diningMinutes(time)) / 30) }, (_, i) => {
  const m = diningMinutes(time) + 30 * (i + 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Every (area, date, time) where all of a restaurant's tables in the area are taken, at a seeded reservation's own time. */
function fullSlots(ctx) {
  const x = index(ctx);
  const seen = new Set();
  const out = [];
  for (const b of x.rows.reservations) {
    if (b.status !== "confirmed") continue;
    const seating = x.seating.get(`${b.restaurantCode}:${b.area}`);
    const key = `${b.restaurantCode}:${b.area}:${b.date}:${b.time}`;
    if (seen.has(key) || diningTablesLeft(seating, x.rows.reservations, b.date, b.time) > 0) continue;
    seen.add(key);
    out.push({ seating, restaurant: x.restaurant.get(b.restaurantCode), date: b.date, time: b.time, i: out.length });
  }
  return out;
}

export const diningTemplates = [
  {
    key: "dining-only-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which restaurant in a city has a table in a named area free for a party at a date and time, offers a named dietary menu and, in some tasks, has at most a named price level. Exactly one does (`diningSearch`), and the menu matters: without it, two or more would. One more restaurant offers the menu, is within the price level, is open then and has tables in that area that seat the party, but every one of them is taken for the two hours. The miss names that restaurant.",
    candidates: fullSlots,
    // One task per city, so the three do not turn on the same pair of restaurants.
    claims: (s) => [dayClaim(s.restaurant.city, s.date), `dining:only-match:${s.restaurant.city.toLowerCase()}`],
    build({ seating, restaurant: r, date, time }, ctx, rng) {
      const rows = index(ctx).rows;
      const partySize = partyFor(seating, rng);
      const base = { city: r.city, date, time, partySize, area: seating.area };
      const without = diningSearch(rows, base);
      for (const menu of shuffle(rng, r.menus)) {
        const withMenu = diningSearch(rows, { ...base, menus: [menu] });
        // A cap at or above the full restaurant's level, so it is out only because its tables are taken.
        for (let cap = r.priceLevel; cap <= 4; cap++) {
          const matches = withMenu.filter((o) => o.priceLevel <= cap);
          if (matches.length !== 1 || without.filter((o) => o.priceLevel <= cap).length < 2 || (cap < 4 && withMenu.length < 2)) continue;
          const q = { ...base, menus: [menu], ...(cap < 4 ? { maxPriceLevel: cap } : {}) };
          const capText = cap < 4 ? `, with a price level of ${cap} or lower (the site rates 1 to 4)` : "";
          return {
            intent: `On the restaurant reservation site, which restaurant in ${r.city} has ${AREA_TEXT[seating.area]} free for ${partySize} people on ${date} at ${time} and offers a ${menu} menu${capText}? Answer as JSON: {"restaurant": "<the restaurant's code, RS-…>"}.`,
            summary: `The one ${r.city} restaurant with ${AREA_TEXT[seating.area]} free for the party at that time that offers the menu${cap < 4 ? " within the price level" : ""}.`,
            rubric: R.answer([APP], "the restaurant that meets every requirement"),
            oracle: { kind: "json", expect: { restaurant: matches[0].restaurantCode } },
            calls: [],
            note: `${r.city} ${date} ${time}, ${partySize} people, ${seating.area}, ${menu}${cap < 4 ? `, level ≤ ${cap}` : ""} → ${matches[0].restaurantCode}; ${r.code} fits too but its ${seating.area} tables are all taken`,
            answer: async (api) => ({ restaurant: api.only(await api.get(APP, searchPath(q))).restaurantCode }),
            miss: async () => ({ restaurant: r.code }),
          };
        }
      }
      return null;
    },
  },
  {
    key: "dining-no-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu — none does — and the closest: the first later half hour that day at which one does, and that restaurant (only one at that time). The area alone and the menu alone can each be met at the asked time. One restaurant offers the menu and has tables in that area that seat the party, but they are all taken. The miss says that restaurant has one at the asked time.",
    candidates: fullSlots,
    claims: (s) => [dayClaim(s.restaurant.city, s.date), `dining:no-match:${s.restaurant.city.toLowerCase()}`],
    build({ seating, restaurant: r, date, time }, ctx, rng) {
      const rows = index(ctx).rows;
      const partySize = partyFor(seating, rng);
      const base = { city: r.city, date, time, partySize, area: seating.area };
      for (const menu of shuffle(rng, r.menus)) {
        const q = { ...base, menus: [menu] };
        if (diningSearch(rows, q).length > 0 || diningSearch(rows, base).length === 0) continue;
        const { area: _area, ...anyArea } = q;
        if (diningSearch(rows, anyArea).length === 0) continue;
        const next = laterThan(time).map((t) => ({ t, offers: diningSearch(rows, { ...q, time: t }) })).find((x) => x.offers.length > 0);
        if (!next || next.offers.length !== 1) continue;
        const area = AREA_TEXT[seating.area];
        return {
          intent: `On the restaurant reservation site, is there a restaurant in ${r.city} with ${area} free for ${partySize} people on ${date} at ${time} that offers a ${menu} menu? If there is none, find the closest: the first later time that same day at which a restaurant in ${r.city} that offers a ${menu} menu has ${area} free for ${partySize} people, and that restaurant. Answer as JSON: {"exists": <true or false>, "restaurant": "<the restaurant's code, RS-…>", "time": "<HH:MM>"}.`,
          summary: `No ${r.city} restaurant meets every requirement at the asked time; the closest is the first later time that day when one does.`,
          rubric: R.answer([APP], "whether any restaurant meets every requirement at that time, and the first later time one does and which restaurant it is,"),
          oracle: { kind: "json", expect: { exists: false, restaurant: next.offers[0].restaurantCode, time: next.t } },
          calls: [],
          note: `${r.city} ${date} ${time}, ${partySize} people, ${seating.area}, ${menu} → none; first later: ${next.offers[0].restaurantCode} at ${next.t}; ${r.code}'s ${seating.area} tables would fit but are all taken`,
          answer: async (api) => {
            const exists = (await api.get(APP, searchPath(q))).length > 0;
            for (const t of laterThan(time)) {
              const offers = await api.get(APP, searchPath({ ...q, time: t }));
              if (offers.length) return { exists, restaurant: api.only(offers).restaurantCode, time: t };
            }
            return { exists, restaurant: "", time: "" };
          },
          miss: async () => ({ exists: true, restaurant: r.code, time }),
        };
      }
      return null;
    },
  },
  {
    key: "dining-deposit",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "The deposit a restaurant takes for a reservation of its private room: the party × the restaurant's deposit per guest + its private-room fee (`diningDepositCents`), ±0.01. Asked of restaurants that take both, on autumn dates when no seeded reservation holds a table. The miss is the per-guest part alone.",
    candidates: (ctx) => index(ctx).rows.restaurants.filter((r) => r.privateRoomFeeCents && r.depositPerGuestCents > 0),
    claims: (r) => [`dining:deposit:${r.code}`],
    build(r, ctx, rng) {
      const room = index(ctx).seating.get(`${r.code}:private`);
      const partySize = int(rng, 6, room.seats);
      let date = addDays(QUIET_FROM, int(rng, 0, 60));
      while (diningSeatingTimes(r, date).length === 0) date = addDays(date, 1);
      const time = shuffle(rng, diningSeatingTimes(r, date))[0];
      const deposit = diningDepositCents(r, "private", partySize) / 100;
      return {
        intent: `On the restaurant reservation site, what deposit would ${r.name} (${r.code}) take for a reservation of its private room for ${partySize} people on ${date} at ${time}? Answer as JSON: {"deposit": <dollars>}.`,
        summary: `The per-guest deposit for the party plus ${r.code}'s private-room fee.`,
        rubric: R.answer([APP], "the deposit the reservation would take"),
        oracle: { kind: "json", expect: { deposit: { value: deposit, tolerance: 0.01 } } },
        calls: [],
        note: `${r.code}: ${partySize} × ${usd(r.depositPerGuestCents)} + room ${usd(r.privateRoomFeeCents)} → $${deposit.toFixed(2)}`,
        answer: async (api) => {
          const x = await api.get(APP, `/api/v1/restaurants/${r.code}`);
          return { deposit: (partySize * x.depositPerGuestCents + x.privateRoomFeeCents) / 100 };
        },
        miss: async (api) => ({ deposit: (partySize * (await api.get(APP, `/api/v1/restaurants/${r.code}`)).depositPerGuestCents) / 100 }),
      };
    },
  },
  {
    key: "dining-book-note",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book a table in a named area at a named restaurant for a new guest (a name and email no seeded reservation has), with a phone number, a party, a date and time when a table is free, and a special request to enter word for word. The check reads the guest's reservations: exactly one confirmed reservation at that restaurant on that date, with the area, time, party and the request as asked. The miss books it without the request.",
    candidates: (ctx) => {
      const x = index(ctx);
      return x.rows.seating.flatMap((s, i) => {
        const r = x.restaurant.get(s.restaurantCode);
        return BUSY_DAYS.map((day, j) => {
          const date = addDays("2027-04-05", day + (i % 7));
          const times = diningSeatingTimes(r, date);
          return { seating: s, restaurant: r, date, time: times[(i + j) % Math.max(1, times.length)], guest: guestOf(i * 4 + j) };
        }).filter((c) => c.time && diningTablesLeft(c.seating, x.rows.reservations, c.date, c.time) > 0);
      });
    },
    claims: (c) => [`dining:guest:${c.guest.email}`, dayClaim(c.restaurant.city, c.date)],
    build({ seating, restaurant: r, date, time, guest }, ctx, rng) {
      const partySize = partyFor(seating, rng);
      const note = REQUESTS[int(rng, 0, REQUESTS.length - 1)];
      const phone = phoneOf(rng);
      const body = { restaurantCode: r.code, area: seating.area, date, time, partySize, guestName: guest.name, guestEmail: guest.email, guestPhone: phone, note };
      return {
        intent: `On the restaurant reservation site, book ${AREA_TEXT[seating.area]} at ${r.name} (${r.code}) for ${guest.name} (${guest.email}, phone ${phone}): ${partySize} people on ${date} at ${time}, with this special request, word for word: "${note}".`,
        summary: `${guest.email} has one confirmed reservation at ${r.code} on ${date} with the area, time, party and special request asked.`,
        rubric: R.change([APP], "the table was booked"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "reserved-with-note",
              app: APP,
              path: `${RESERVATIONS}?guestEmail=${encodeURIComponent(guest.email)}`,
              where: { restaurantCode: r.code, date, status: "confirmed" },
              count: { min: 1, max: 1 },
              expect: { area: seating.area, time, partySize, note },
            },
          ],
        },
        calls: [reservation(body)],
        note: `${guest.email} → ${r.code} ${seating.area}, ${date} ${time}, ${partySize} people, "${note}"`,
        solve: (api) => reserve(api, body),
        miss: (api) => reserve(api, { ...body, note: "" }),
      };
    },
  },
  {
    key: "dining-book-earliest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book, for a new guest, a table in a named area at a named restaurant at a date and time — every table of the area is taken then — or else at the earliest later half hour that day when one is free for the two hours (`diningAvailability`). The check: exactly one confirmed reservation for the guest at that restaurant on that date, in that area, at that time, for that party. The miss books the first free time on the hour after the asked one (or the free time after the earliest, when the earliest is on the hour).",
    candidates: (ctx) => fullSlots(ctx).map((s) => ({ ...s, guest: guestOf(s.i + 13) })),
    // One task per restaurant, so the three ask of three different places.
    claims: (s) => [`dining:guest:${s.guest.email}`, dayClaim(s.restaurant.city, s.date), `dining:book-earliest:${s.restaurant.code}`],
    build({ seating, restaurant: r, date, time, guest }, ctx, rng) {
      const rows = index(ctx).rows;
      const partySize = partyFor(seating, rng);
      const open = diningAvailability(r, rows, date, partySize).filter((s) => s.area === seating.area && s.time > time && s.tablesLeft > 0).map((s) => s.time);
      const [earliest] = open;
      if (!earliest) return null;
      const wrong = earliest.endsWith(":30") ? open.find((t) => t.endsWith(":00")) : open[1];
      if (!wrong) return null;
      const phone = phoneOf(rng);
      const bodyAt = (t) => ({ restaurantCode: r.code, area: seating.area, date, time: t, partySize, guestName: guest.name, guestEmail: guest.email, guestPhone: phone, note: "" });
      return {
        intent: `On the restaurant reservation site, book ${AREA_TEXT[seating.area]} at ${r.name} (${r.code}) for ${guest.name} (${guest.email}, phone ${phone}), ${partySize} people on ${date}: at ${time}, or if none is free then, at the earliest later time that day when one is.`,
        summary: `${guest.email} has one confirmed reservation at ${r.code} on ${date} in the area asked, at the earliest time from the asked one when a table is free.`,
        rubric: R.change([APP], "the table was booked"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "reserved-earliest",
              app: APP,
              path: `${RESERVATIONS}?guestEmail=${encodeURIComponent(guest.email)}`,
              where: { restaurantCode: r.code, date, status: "confirmed" },
              count: { min: 1, max: 1 },
              expect: { area: seating.area, time: earliest, partySize },
            },
          ],
        },
        calls: [reservation(bodyAt(earliest))],
        note: `${r.code} ${seating.area} ${date}: ${time} is full → ${earliest} for ${partySize} people (${guest.email}); the miss books ${wrong}`,
        solve: async (api) => {
          const { slots } = await api.get(APP, availabilityPath(r.code, date, partySize));
          return reserve(api, bodyAt(slots.find((s) => s.area === seating.area && s.time >= time && s.tablesLeft > 0).time));
        },
        miss: (api) => reserve(api, bodyAt(wrong)),
      };
    },
  },
  {
    key: "dining-change-party",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Change the party size of one of a seeded guest's confirmed reservations, named by its restaurant and date, and leave the guest's other confirmed reservations alone. Asked of a guest with at least two confirmed reservations, where no other reservation of theirs has the same restaurant and date; the new size fits the area's tables. One check per confirmed reservation of the guest: the new party for the one named, the party it had for the rest, all still confirmed. The miss changes every one of their reservations whose tables seat the new size.",
    candidates: (ctx) => {
      const byGuest = new Map();
      for (const b of index(ctx).rows.reservations) byGuest.set(b.guestEmail, [...(byGuest.get(b.guestEmail) ?? []), b]);
      return [...byGuest.values()].flatMap((all) => {
        const live = all.filter((b) => b.status === "confirmed");
        if (live.length < 2) return [];
        return live.filter((t) => all.filter((b) => b.restaurantCode === t.restaurantCode && b.date === t.date).length === 1).map((target) => ({ target, live }));
      });
    },
    claims: ({ target }) => [`dining:guest:${target.guestEmail}`],
    build({ target, live }, ctx, rng) {
      const x = index(ctx);
      const seats = (b) => x.seating.get(`${b.restaurantCode}:${b.area}`).seats;
      const sizes = Array.from({ length: seats(target) }, (_, i) => i + 1).filter((n) => n !== target.partySize && n >= (target.area === "private" ? 6 : 1));
      const size = shuffle(rng, sizes).find((n) => live.some((b) => b !== target && seats(b) >= n && b.partySize !== n));
      if (!size) return null;
      const r = x.restaurant.get(target.restaurantCode);
      const after = (b) => (b.reservationNo === target.reservationNo ? size : b.partySize);
      const change = (api, no) => api.post(APP, `${RESERVATIONS}/${no}/change`, { partySize: size });
      return {
        intent: `On the restaurant reservation site, ${target.guestName} (${target.guestEmail}) has several reservations. Change only their reservation at ${r.name} on ${target.date} to a party of ${size}, and leave their other reservations as they are.`,
        summary: `${target.guestEmail}'s reservation at ${r.code} on ${target.date} is for the new party size; their other confirmed reservations are unchanged.`,
        rubric: R.change([APP], "the party size was changed"),
        oracle: {
          kind: "state",
          checks: live.map((b) => ({ name: `${b.reservationNo}-party-${after(b)}`, app: APP, path: `${RESERVATIONS}/${b.reservationNo}`, expect: { status: "confirmed", partySize: after(b) } })),
        },
        calls: [call("change_reservation", { reservationNo: target.reservationNo, partySize: size })],
        note: `${target.guestEmail}: ${target.reservationNo} (${r.code}, ${target.date}) ${target.partySize} → ${size}; ${live.filter((b) => b !== target).map((b) => b.reservationNo).join(", ")} unchanged`,
        solve: async (api) => {
          const mine = await api.list(APP, `${RESERVATIONS}?guestEmail=${encodeURIComponent(target.guestEmail)}`);
          await change(api, api.only(mine.filter((b) => b.restaurantCode === r.code && b.date === target.date && b.status === "confirmed")).reservationNo);
        },
        miss: async (api) => {
          for (const b of live) if (seats(b) >= size) await change(api, b.reservationNo);
        },
      };
    },
  },
];
