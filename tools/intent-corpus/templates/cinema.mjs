/**
 * Cinema ticket booking intent templates (apps/cinema, "Orrowen Cinemas").
 * Shaped on the ticket-booking demo in GoogleChromeLabs/webmcp-tools
 * (Apache-2.0): set a location, filter the films by genre, pick a showtime by
 * date and time, check out with tickets. That demo grades the tool calls an
 * agent makes; these grade the answer or the site's end state instead, so an
 * agent may use the pages, REST, MCP or WebMCP. See ./index.mjs for the
 * contract.
 *
 * Free seats are what most of these turn on: the generator sells some
 * showtimes out and leaves others with single seats only, none side by side
 * (packages/scenarios/src/sites/cinema/generate.ts). The search tasks are
 * built around such a showtime — it would fit every requirement if it had the
 * seats. The rules every answer key is derived with are @benchme/scenarios'
 * cinema rules, the same functions the site enforces.
 *
 * Claims: a booking or a cancellation changes which seats are free, so every
 * task that depends on, or changes, a showtime's free seats claims that
 * showtime (`cinema:show:<code>`), and every write claims its customer.
 *
 * Expected calls: a booking's `create_booking` of the showtime, the seats (the
 * row's one run, in any order; any seats where the task leaves the run to the
 * agent), every ticket type the mix has (a type it has none of left free), and
 * the customer's email (the name left free); a cancellation's `cancel_booking`
 * of the booking named. A search is answered by `search_showtimes` or by each
 * film's showtimes read in turn, and a quote by the showtime or by its
 * cinema's price table and fees, so neither declares a read.
 */
import { CINEMA_ADULT_RATINGS, cinemaFreeRuns, cinemaSearchShowtimes, cinemaTakenSeats, shuffle } from "../../../packages/scenarios/dist/index.js";
import { anyOrder, call, free, pattern, someOf } from "../calls.mjs";
import { int, usd } from "../kit.mjs";
import { R } from "../rubrics.mjs";

const APP = "cinema";
const BOOKINGS = "/api/v1/bookings";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New customers the booking tasks book for: names no seeded customer has, at a domain no seeded email uses. */
const CUSTOMER_FIRST = ["Aurelio", "Bettina", "Cosmo", "Dagny", "Evander", "Florentyna"];
const CUSTOMER_LAST = ["Ashdown", "Brightling", "Copperfield", "Dunmore", "Eastwick", "Fennimore"];
const FORMAT_TEXT = { "2d": "in 2D", "3d": "in 3D", large: "in large format" };
const TYPE_WORDS = { adult: ["adult", "adults"], child: ["child", "children"], senior: ["senior", "seniors"], student: ["student", "students"] };
const TYPES = ["adult", "child", "senior", "student"];

/** The seed rows, indexed once per corpus build (kit.mjs's context knows nothing of the cinema). */
const indexes = new WeakMap();
function cin(ctx) {
  let x = indexes.get(ctx.rows);
  if (!x) {
    const r = ctx.rows.cinema;
    const offers = cinemaSearchShowtimes(r, {});
    x = {
      rows: r,
      offers,
      offer: new Map(offers.map((o) => [o.showtimeCode, o])),
      film: new Map(r.films.map((f) => [f.code, f])),
      screen: new Map(r.screens.map((s) => [s.code, s])),
      search: (q) => cinemaSearchShowtimes(r, q),
      runs: (o) => cinemaFreeRuns(x.screen.get(o.screenCode), cinemaTakenSeats(r.bookings, o.showtimeCode)),
    };
    indexes.set(ctx.rows, x);
  }
  return x;
}

const showClaim = (code) => `cinema:show:${code}`;
/** Every showtime of a genre in a city on a day: the ones a search task's answer reads the free seats of. */
const dayClaims = (x, o) => x.search({ city: o.city, date: o.date, genre: o.genre }).map((s) => showClaim(s.showtimeCode));
const customerOf = (i) => {
  const first = CUSTOMER_FIRST[i % CUSTOMER_FIRST.length];
  const last = CUSTOMER_LAST[Math.floor(i / CUSTOMER_FIRST.length) % CUSTOMER_LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@film.example`.toLowerCase() };
};
const mixText = (counts) => {
  const parts = TYPES.filter((t) => counts[t] > 0).map((t) => `${counts[t]} ${TYPE_WORDS[t][counts[t] === 1 ? 0 : 1]}`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};
const fullCounts = (c) => Object.fromEntries(TYPES.map((t) => [t, c[t] ?? 0]));
/** A ticket mix of n seats with at least one non-adult ticket (a child only where the film's rating allows it). */
function mixFor(n, film, rng) {
  const others = CINEMA_ADULT_RATINGS.includes(film.rating) ? ["senior", "student"] : ["child", "senior", "student"];
  const c = fullCounts({});
  c[others[int(rng, 0, others.length - 1)]] = 1;
  for (let i = 1; i < n; i++) c[rng() < 0.6 ? "adult" : others[int(rng, 0, others.length - 1)]]++;
  return c;
}
const aFilm = (genre) => `${/^[aeiou]/.test(genre) ? "an" : "a"} ${genre} film`;
const FORMAT_WORD = { "2d": "2D", "3d": "3D", large: "large-format" };
const showText = (o) => `the ${o.time} showing of "${o.filmTitle}" at ${o.cinemaName} on ${o.date}`;
const showtimesPath = (q) =>
  `/api/v1/showtimes?${new URLSearchParams(
    Object.entries({ city: q.city, cinema: q.cinemaCode, date: q.date, genre: q.genre, film: q.filmCode, format: q.format, after: q.after, seats: q.seats, together: q.together })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  )}`;
const book = (api, body) => api.post(APP, BOOKINGS, body);
/** Any seat of a screen (rows A to H): seats side by side the task leaves to the agent may be any free run. */
const SEAT = pattern("^[A-Z][0-9]+$");
/** A ticket type the mix has none of is free: a run may send 0 or leave it out. */
const noneFree = (counts) => Object.fromEntries(TYPES.filter((t) => !counts[t]).map((t) => [t, free]));
/** The booking a correct solution makes, through the tool: the seats as `seatsAs` publishes them, the mix, the customer. */
const booking = (showtimeCode, seats, counts, customer, seatsAs) =>
  call("create_booking", { showtimeCode, seats, ...counts, customerName: customer.name, customerEmail: customer.email }, { seats: seatsAs, customerName: free, ...noneFree(counts) });
/** The first n free seats side by side on a served seat map (in one row when given), in seat order. */
function firstRun(seatMap, n, row) {
  for (const r of seatMap) {
    if (row && r.row !== row) continue;
    for (let i = 0; i + n <= r.seats.length; i++) {
      const w = r.seats.slice(i, i + n);
      if (w.every((y) => y.free)) return w.map((y) => y.seat);
    }
  }
  return [];
}
/** Whole hours a search can start from, up to the showtime's own start. */
const hoursUpTo = (time) => Array.from({ length: Number(time.slice(0, 2)) - 11 }, (_, i) => `${String(12 + i).padStart(2, "0")}:00`).filter((h) => h <= time);
/** Showtimes too full for a party: sold out, or a few single seats left. */
const nearlyFull = (ctx) => cin(ctx).offers.filter((o) => o.freeSeats <= 5);

export const cinemaTemplates = [
  {
    key: "cinema-no-showtime",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any showtime in a city on a date is of a named genre, in a named format, starts at or after a time, and has at least N free seats — none does — and which comes closest: the earliest showtime of that genre there that day, from that time, with N free seats, in any format (start times in one cinema never tie). One showtime meets every requirement but the seats: it is sold out or has fewer than N free. The miss says one exists and names it.",
    candidates: nearlyFull,
    claims: (o, ctx) => dayClaims(cin(ctx), o),
    build(full, ctx, rng) {
      const x = cin(ctx);
      const base = { city: full.city, date: full.date, genre: full.genre };
      for (const seats of shuffle(rng, [2, 3, 4, 5, 6].filter((n) => n > full.freeSeats))) {
        for (const after of shuffle(rng, hoursUpTo(full.time))) {
          if (x.search({ ...base, format: full.format, after, seats }).length !== 0) continue;
          const [closest] = x.search({ ...base, after, seats });
          if (!closest) continue;
          return {
            intent: `On the cinema booking site, is there a showtime in ${full.city} on ${full.date} of ${aFilm(full.genre)} ${FORMAT_TEXT[full.format]}, starting at ${after} or later, with at least ${seats} free seats? Also name the showtime that comes closest: the earliest showtime of ${aFilm(full.genre)} in ${full.city} on ${full.date} starting at ${after} or later with at least ${seats} free seats, in any format. Answer as JSON: {"exists": <true or false>, "closest": "<the showtime's code, ST-…>"}.`,
            summary: `No ${full.genre} showtime in ${full.city} that day meets every requirement; the closest is the earliest with the seats in any format.`,
            rubric: R.answer([APP], "whether any showtime meets every requirement, and the one that comes closest,"),
            oracle: { kind: "json", expect: { exists: false, closest: closest.showtimeCode } },
            calls: [],
            note: `${full.city} ${full.date} ${full.genre} ${full.format} from ${after}, ${seats} seats → none; closest ${closest.showtimeCode} (${closest.time}, ${closest.format}); ${full.showtimeCode} (${full.time}) fits but has ${full.freeSeats} free`,
            answer: async (api) => ({
              exists: (await api.get(APP, showtimesPath({ ...base, format: full.format, after, seats }))).length > 0,
              closest: (await api.get(APP, showtimesPath({ ...base, after, seats })))[0]?.showtimeCode ?? "",
            }),
            miss: async () => ({ exists: true, closest: full.showtimeCode }),
          };
        }
      }
      return null;
    },
  },
  {
    key: "cinema-only-showtime",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which showtime in a city on a date is of a named genre, in a named format, starts at or after a time, and has at least N free seats. Exactly one does (`cinemaSearchShowtimes`), and the time or the format matters (both where the day allows it): without it, two or more would. One more showtime is of that genre and format and starts after the time, but it is sold out or has fewer than N seats free. The miss names that showtime.",
    candidates: nearlyFull,
    claims: (o, ctx) => dayClaims(cin(ctx), o),
    build(full, ctx, rng) {
      const x = cin(ctx);
      const base = { city: full.city, date: full.date, genre: full.genre, format: full.format };
      // Every (seats, time) that leaves one match, scored by how many of the time and the format rule out a showtime
      // with the seats; the first with the best score wins, and a score of 0 (the answer is just "the one with seats") never does.
      let best = null;
      for (const seats of shuffle(rng, [2, 3, 4, 5, 6].filter((n) => n > full.freeSeats))) {
        for (const after of shuffle(rng, hoursUpTo(full.time))) {
          const q = { ...base, after, seats };
          const matches = x.search(q);
          if (matches.length !== 1 || matches[0].showtimeCode === full.showtimeCode) continue;
          const score = (x.search({ ...base, seats }).length >= 2 ? 1 : 0) + (x.search({ ...q, format: undefined }).length >= 2 ? 1 : 0);
          if (score > (best?.score ?? 0)) best = { q, seats, after, match: matches[0], score };
        }
      }
      if (!best) return null;
      const { q, seats, after, match } = best;
      return {
        intent: `On the cinema booking site, which showtime in ${full.city} on ${full.date} is of ${aFilm(full.genre)} ${FORMAT_TEXT[full.format]}, starts at ${after} or later, and has at least ${seats} free seats? Answer as JSON: {"showtime": "<the showtime's code, ST-…>"}.`,
        summary: `The one ${full.genre} showtime in ${full.city} on that date, in that format, from that time, with enough free seats.`,
        rubric: R.answer([APP], "the showtime that meets every requirement"),
        oracle: { kind: "json", expect: { showtime: match.showtimeCode } },
        calls: [],
        note: `${full.city} ${full.date} ${full.genre} ${full.format} from ${after}, ${seats} seats → ${match.showtimeCode} (${match.time}, ${match.freeSeats} free); ${full.showtimeCode} (${full.time}) fits but has ${full.freeSeats} free`,
        answer: async (api) => ({ showtime: api.only(await api.get(APP, showtimesPath(q))).showtimeCode }),
        miss: async () => ({ showtime: full.showtimeCode }),
      };
    },
  },
  {
    key: "cinema-book-earliest-together",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book, for a new customer, N seats side by side at the earliest showtime of a named film at a named cinema that still has N free seats side by side (`cinemaSearchShowtimes` with `together`, first result). An earlier showtime of the film there has N or more seats free, but none side by side. The check: exactly one confirmed booking for the customer, at that showtime, of N seats side by side, with the ticket mix asked. The miss books N free seats at the earliest showtime with N free seats, which are not side by side.",
    candidates: (ctx) => {
      const x = cin(ctx);
      const pairs = new Map();
      for (const o of x.offers) pairs.set(`${o.cinemaCode}:${o.filmCode}`, [...(pairs.get(`${o.cinemaCode}:${o.filmCode}`) ?? []), o]);
      return [...pairs.values()]
        .flatMap((shows) =>
          [2, 3, 4].flatMap((n) => {
            const k = shows.findIndex((o) => o.bestRun >= n);
            const trap = shows.findIndex((o) => o.freeSeats >= n);
            // Only the showings up to the target decide the answer: a later one changing its free seats cannot.
            return k > 0 && trap >= 0 && trap < k ? [{ shows: shows.slice(0, k + 1), n, target: shows[k], trap: shows[trap] }] : [];
          }),
        )
        .map((s, i) => ({ ...s, customer: customerOf(i + 11) }));
    },
    claims: (s) => [...s.shows.map((o) => showClaim(o.showtimeCode)), `cinema:customer:${s.customer.email}`],
    build({ n, target, trap, customer }, ctx, rng) {
      const counts = mixFor(n, cin(ctx).film.get(target.filmCode), rng);
      const q = { cinemaCode: target.cinemaCode, filmCode: target.filmCode, seats: n };
      const together = cin(ctx).runs(target).find((r) => r.length >= n)?.slice(0, n);
      if (!together) return null;
      const bookAt = async (api, query, pickSeats) => {
        const o = (await api.get(APP, showtimesPath(query)))[0];
        const s = await api.get(APP, `/api/v1/showtimes/${o.showtimeCode}`);
        return book(api, { showtimeCode: o.showtimeCode, seats: pickSeats(s), ...counts, customerName: customer.name, customerEmail: customer.email });
      };
      return {
        intent: `On the cinema booking site, book ${n} seats side by side (in one row, next to each other) for ${customer.name} (${customer.email}), as ${mixText(counts)}, at the earliest showtime of "${target.filmTitle}" at ${target.cinemaName} in ${target.city} that still has ${n} free seats side by side.`,
        summary: `${customer.email} has one confirmed booking of ${n} seats side by side at the earliest showtime of ${target.filmCode} at ${target.cinemaCode} that had them free.`,
        rubric: R.change([APP], "the seats were booked"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "booked-earliest-together",
              app: APP,
              path: `${BOOKINGS}?customerEmail=${encodeURIComponent(customer.email)}`,
              where: { status: "confirmed" },
              count: { min: 1, max: 1 },
              expect: { showtimeCode: target.showtimeCode, seatCount: n, together: true, ticketCounts: counts },
            },
          ],
        },
        calls: [booking(target.showtimeCode, together, counts, customer, someOf(n, SEAT))],
        note: `${target.filmCode} at ${target.cinemaCode}, ${n} together → ${target.showtimeCode} (${target.date} ${target.time}); ${trap.showtimeCode} (${trap.date} ${trap.time}) has ${trap.freeSeats} free, at most ${trap.bestRun} side by side`,
        solve: (api) => bookAt(api, { ...q, together: true }, (s) => firstRun(s.seatMap, n)),
        miss: (api) => bookAt(api, q, (s) => s.seatMap.flatMap((r) => r.free).slice(0, n)),
      };
    },
  },
  {
    key: "cinema-ticket-quote",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What named seats in a premium row of a showtime cost in total for a ticket mix with at least one non-adult ticket: each ticket's price for the showtime's format and type, plus the premium surcharge per seat, plus the booking fee per ticket (`cinemaQuote`), ±0.01. The seats are free in the seed. The miss is the ticket prices alone.",
    candidates: (ctx) => cin(ctx).offers.filter((o) => o.freeSeats >= 10),
    claims: (o) => [showClaim(o.showtimeCode)],
    build(o, ctx, rng) {
      const x = cin(ctx);
      const screen = x.screen.get(o.screenCode);
      const film = x.film.get(o.filmCode);
      const cinema = x.rows.cinemas.find((c) => c.code === o.cinemaCode);
      const n = int(rng, 2, 4);
      const runs = x.runs(o).filter((r) => r.length >= n && screen.premiumRows.includes(r[0][0]));
      if (runs.length === 0) return null;
      const run = runs[int(rng, 0, runs.length - 1)];
      const start = int(rng, 0, run.length - n);
      const seats = run.slice(start, start + n);
      const counts = mixFor(n, film, rng);
      const price = (t) => x.rows.prices.find((p) => p.cinemaCode === o.cinemaCode && p.format === o.format && p.ticketType === t).priceCents;
      const tickets = TYPES.reduce((s, t) => s + price(t) * counts[t], 0);
      const total = (tickets + n * (cinema.premiumSurchargeCents + cinema.bookingFeeCents)) / 100;
      return {
        intent: `On the cinema booking site, what would these tickets for ${showText(o)} (${o.showtimeCode}) cost in total: seats ${seats.join(", ")}, as ${mixText(counts)}? Answer as JSON: {"total": <dollars>}.`,
        summary: `The ${FORMAT_WORD[o.format]} ticket prices for the mix, plus the premium-row surcharge and the booking fee for each of the ${n} seats.`,
        rubric: R.answer([APP], "what the tickets cost in total, surcharge and fees included,"),
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 } } },
        calls: [],
        note: `${o.showtimeCode} ${o.format} ${seats.join(",")} (premium) ${mixText(counts)}: tickets ${usd(tickets)} + ${n} × (surcharge ${usd(cinema.premiumSurchargeCents)} + fee ${usd(cinema.bookingFeeCents)}) → $${total.toFixed(2)}`,
        answer: async (api) => {
          const s = await api.get(APP, `/api/v1/showtimes/${o.showtimeCode}`);
          const premium = seats.filter((seat) => s.premiumRows.includes(seat[0])).length;
          return { total: (TYPES.reduce((sum, t) => sum + s.prices[t] * counts[t], 0) + premium * s.premiumSurchargeCents + n * s.bookingFeeCents) / 100 };
        },
        miss: async (api) => {
          const s = await api.get(APP, `/api/v1/showtimes/${o.showtimeCode}`);
          return { total: TYPES.reduce((sum, t) => sum + s.prices[t] * counts[t], 0) / 100 };
        },
      };
    },
  },
  {
    key: "cinema-book-row",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book N seats side by side in a named row of a showtime, for a new customer, with a ticket mix that has at least one non-adult ticket. The row has exactly one set of N free seats side by side (its other free seats are in shorter runs). The check reads the customer's bookings: exactly one confirmed booking at that showtime, of exactly those seats, with the ticket counts asked. The miss books the right seats as adult tickets only.",
    candidates: (ctx) => {
      const x = cin(ctx);
      return x.offers
        .filter((o) => o.freeSeats > 0)
        .flatMap((o) => {
          const byRow = new Map();
          for (const r of x.runs(o)) byRow.set(r[0][0], [...(byRow.get(r[0][0]) ?? []), r]);
          return [...byRow.entries()].flatMap(([row, runs]) =>
            [2, 3, 4].filter((n) => runs.filter((r) => r.length >= n).length === 1 && runs.some((r) => r.length === n)).map((n) => ({ o, row, n, seats: runs.find((r) => r.length === n) })),
          );
        })
        .map((s, i) => ({ ...s, customer: customerOf(i) }));
    },
    claims: (s) => [showClaim(s.o.showtimeCode), `cinema:customer:${s.customer.email}`],
    build({ o, row, n, seats, customer }, ctx, rng) {
      const counts = mixFor(n, cin(ctx).film.get(o.filmCode), rng);
      const body = (c) => ({ showtimeCode: o.showtimeCode, seats, ...c, customerName: customer.name, customerEmail: customer.email });
      return {
        intent: `On the cinema booking site, book ${n} seats side by side in row ${row} for ${showText(o)} (${o.showtimeCode}), for ${customer.name} (${customer.email}): ${mixText(counts)}.`,
        summary: `${customer.email} has one confirmed booking at ${o.showtimeCode}: the ${n} free seats side by side in row ${row}, with the ticket mix asked.`,
        rubric: R.change([APP], "the seats were booked"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "booked-row",
              app: APP,
              path: `${BOOKINGS}?customerEmail=${encodeURIComponent(customer.email)}`,
              where: { showtimeCode: o.showtimeCode, status: "confirmed" },
              count: { min: 1, max: 1 },
              expect: { seats: seats.join(","), ticketCounts: counts },
            },
          ],
        },
        calls: [booking(o.showtimeCode, seats, counts, customer, anyOrder(seats))],
        note: `${customer.email} → ${o.showtimeCode} row ${row}: ${seats.join(",")} as ${mixText(counts)}`,
        solve: async (api) => book(api, body({ ...counts, seats: firstRun((await api.get(APP, `/api/v1/showtimes/${o.showtimeCode}`)).seatMap, n, row) })),
        miss: (api) => book(api, body({})),
      };
    },
  },
  {
    key: "cinema-cancel-one",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel one of a seeded customer's confirmed bookings, named by its film and date, and leave the customer's other confirmed bookings alone. Asked of a customer with at least two confirmed bookings, where no other booking of theirs is for the same film on the same date. One check per confirmed booking of the customer: `cancelled` for the one named, `confirmed` for the rest. The miss cancels all of them.",
    candidates: (ctx) => {
      const x = cin(ctx);
      const filmOf = (b) => x.offer.get(b.showtimeCode).filmCode;
      const dateOf = (b) => x.offer.get(b.showtimeCode).date;
      const byCustomer = new Map();
      for (const b of x.rows.bookings) byCustomer.set(b.customerEmail, [...(byCustomer.get(b.customerEmail) ?? []), b]);
      return [...byCustomer.values()].flatMap((all) => {
        const live = all.filter((b) => b.status === "confirmed");
        if (live.length < 2) return [];
        return live.filter((t) => all.filter((b) => filmOf(b) === filmOf(t) && dateOf(b) === dateOf(t)).length === 1).map((target) => ({ target, live }));
      });
    },
    claims: ({ target }) => [`cinema:customer:${target.customerEmail}`, showClaim(target.showtimeCode)],
    build({ target, live }, ctx) {
      const o = cin(ctx).offer.get(target.showtimeCode);
      const status = (b) => (b.bookingNo === target.bookingNo ? "cancelled" : "confirmed");
      const cancel = (api, no) => api.post(APP, `${BOOKINGS}/${no}/cancel`, {});
      return {
        intent: `On the cinema booking site, ${target.customerName} (${target.customerEmail}) has several bookings. Cancel only their booking for "${o.filmTitle}" on ${o.date}, and leave their other bookings as they are.`,
        summary: `${target.customerEmail}'s booking for ${o.filmCode} on ${o.date} is cancelled; their other confirmed bookings are still confirmed.`,
        rubric: R.change([APP], "the booking was cancelled"),
        oracle: { kind: "state", checks: live.map((b) => ({ name: `${b.bookingNo}-${status(b)}`, app: APP, path: `${BOOKINGS}/${b.bookingNo}`, expect: { status: status(b) } })) },
        calls: [call("cancel_booking", { bookingNo: target.bookingNo })],
        note: `${target.customerEmail}: ${target.bookingNo} (${o.filmCode}, ${o.date}, ${o.showtimeCode}) → cancelled; ${live.filter((b) => b !== target).map((b) => b.bookingNo).join(", ")} stay confirmed`,
        solve: async (api) => {
          const mine = await api.list(APP, `${BOOKINGS}?customerEmail=${encodeURIComponent(target.customerEmail)}`);
          await cancel(api, api.only(mine.filter((b) => b.filmCode === o.filmCode && b.date === o.date)).bookingNo);
        },
        miss: async (api) => {
          for (const b of live) await cancel(api, b.bookingNo);
        },
      };
    },
  },
];
