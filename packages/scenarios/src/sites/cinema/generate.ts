import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { CINEMA_ADULT_RATINGS, CINEMA_FORMATS, CINEMA_MAX_SEATS, CINEMA_WINDOW, cinemaFreeRuns, cinemaFreeSeats, cinemaQuote, cinemaTakenSeats, type CinemaTicketCounts } from "./rules.js";
import type { Cinema, CinemaBooking, CinemaFilm, CinemaFormat, CinemaPrice, CinemaRating, CinemaRows, CinemaScreen, CinemaShowtime, CinemaTicketType } from "./types.js";

/**
 * The cinema site's rows: one cinema in each city, 2–3 screens each (half the
 * cinemas have a large-format screen), invented films, three days of
 * showtimes (four a day on every screen; each cinema's headliner plays most),
 * and bookings already made. Drawn from a stream of its own
 * (`substream(seed, "cinema")`), so adding the site moved no other row. Some
 * showtimes are sold out on purpose, and some are nearly full with only
 * single seats left (no two side by side): a search has to read free seats,
 * not just the programme.
 */
export const CINEMA_SIZES = { films: 16, screensPerCinema: [2, 3], filmsPerCinema: 6, customers: 30, bookings: 50, soldOut: 5, nearlyFull: 12 } as const;
export const CINEMA_GENRES = ["action", "animation", "comedy", "drama", "horror", "science fiction"] as const;

const RATINGS: Record<(typeof CINEMA_GENRES)[number], CinemaRating[]> = {
  action: ["12", "15"], animation: ["U", "PG"], comedy: ["PG", "12", "15"], drama: ["12", "15"], horror: ["15", "18"], "science fiction": ["PG", "12", "15"],
};
/** How often each film of a programme is scheduled, by its place in it: the first is the cinema's headliner. */
const PROGRAMME_WEIGHTS = [5, 3, 2, 1, 1, 1] as const;
const LANGUAGES = ["French", "Spanish", "Japanese", "Korean", "German", "Hindi"] as const;
const NOUNS = ["Crossing", "Harbour", "Signal", "Orchard", "Lantern", "Divide", "Archive", "Tide", "Garden", "Frontier", "Echo", "Compass", "Winter", "Engine", "Summit", "Island"] as const;
const SETTINGS = ["a mountain town", "a port city", "a research station", "a farm", "an old theatre", "a night train", "a coastal village", "a desert outpost"] as const;
const CINEMA_SUFFIXES = ["Cinema", "Picturehouse", "Film Theatre", "Screens"] as const;
const STREETS = ["Street", "Road", "Square", "Avenue"] as const;
function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = items.reduce((s, _, i) => s + (weights[i] ?? 1), 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 1;
    if (r < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

/** A screen's day: these four start times, shifted by 0, 20 or 40 minutes by screen so no two screens of a cinema start together. */
const SLOTS = ["12:30", "15:30", "18:30", "21:30"] as const;
const TYPE_FACTOR: Record<CinemaTicketType, number> = { adult: 1, child: 0.6, senior: 0.7, student: 0.8 };

const to25 = (cents: number) => Math.round(cents / 25) * 25;
const shift = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

function makeFilms(rng: Rng): CinemaFilm[] {
  const genres = shuffle(rng, CINEMA_GENRES);
  const titles = new Set<string>();
  const films: CinemaFilm[] = [];
  for (let i = 0; i < CINEMA_SIZES.films; i++) {
    const genre = genres[i % genres.length] as (typeof CINEMA_GENRES)[number];
    let title = "";
    do {
      const w = word(rng);
      const n = pick(rng, NOUNS);
      title = pick(rng, [`The ${w} ${n}`, `${n} of ${w}`, `${w} ${n}`, `Beyond ${w}`, `Return to ${w}`]);
    } while (titles.has(title));
    titles.add(title);
    const bright = genre === "action" || genre === "animation" || genre === "science fiction";
    const formats: CinemaFormat[] = ["2d"];
    if (rng() < (bright ? 0.75 : 0.25)) formats.push("3d");
    if (rng() < (bright || genre === "drama" ? 0.6 : 0.15)) formats.push("large");
    films.push({
      code: `FM-${101 + i}`,
      title,
      genre,
      rating: pick(rng, RATINGS[genre]),
      runtimeMinutes: int(rng, 85, 150),
      language: rng() < 0.6 ? "English" : pick(rng, LANGUAGES),
      synopsis: `A ${genre} film set in ${pick(rng, SETTINGS)}.`,
      formats,
    });
  }
  // Every seed gets at least three films in each extra format, so a large screen always has a choice.
  for (const format of ["3d", "large"] as const) {
    for (const f of films) if (films.filter((x) => x.formats.includes(format)).length < 3 && !f.formats.includes(format)) f.formats.push(format);
  }
  for (const f of films) f.formats.sort((x, y) => CINEMA_FORMATS.indexOf(x) - CINEMA_FORMATS.indexOf(y));
  return films;
}

function makeCinemas(rng: Rng): { cinemas: Cinema[]; screens: CinemaScreen[]; prices: CinemaPrice[] } {
  const largeIn = new Set(shuffle(rng, CITY_LIST).slice(0, 3));
  const names = new Set<string>();
  const cinemas: Cinema[] = [];
  const screens: CinemaScreen[] = [];
  const prices: CinemaPrice[] = [];
  CITY_LIST.forEach((city, i) => {
    let name = "";
    do name = `${word(rng)} ${pick(rng, CINEMA_SUFFIXES)}`;
    while (names.has(name));
    names.add(name);
    const code = `CN-${101 + i}`;
    cinemas.push({ code, name, city, address: `${int(rng, 2, 240)} ${word(rng)} ${pick(rng, STREETS)}, ${city}`, bookingFeeCents: int(rng, 3, 6) * 25, premiumSurchargeCents: int(rng, 8, 14) * 25 });
    const large = largeIn.has(city);
    const count = int(rng, CINEMA_SIZES.screensPerCinema[0], CINEMA_SIZES.screensPerCinema[1]);
    for (let s = 1; s <= count; s++) {
      if (large && s === 1) screens.push({ cinemaCode: code, code: `${code}-S1`, name: "Screen 1", kind: "large", rows: 8, seatsPerRow: int(rng, 10, 12), premiumRows: ["G", "H"] });
      else {
        const rows = int(rng, 6, 8);
        screens.push({ cinemaCode: code, code: `${code}-S${s}`, name: `Screen ${s}`, kind: "standard", rows, seatsPerRow: int(rng, 6, 9), premiumRows: ["ABCDEFGH"[rows - 1] as string] });
      }
    }
    const adult2d = int(rng, 40, 56) * 25;
    const base: Partial<Record<CinemaFormat, number>> = { "2d": adult2d, "3d": adult2d + int(rng, 10, 16) * 25, ...(large ? { large: adult2d + int(rng, 20, 28) * 25 } : {}) };
    for (const [format, adult] of Object.entries(base) as [CinemaFormat, number][]) {
      for (const ticketType of Object.keys(TYPE_FACTOR) as CinemaTicketType[]) prices.push({ cinemaCode: code, format, ticketType, priceCents: to25(adult * TYPE_FACTOR[ticketType]) });
    }
  });
  return { cinemas, screens, prices };
}

function makeShowtimes(rng: Rng, cinemas: Cinema[], screens: CinemaScreen[], films: CinemaFilm[]): CinemaShowtime[] {
  const programme = new Map<string, CinemaFilm[]>();
  for (const c of cinemas) {
    const picked = shuffle(rng, films).slice(0, CINEMA_SIZES.filmsPerCinema);
    if (screens.some((s) => s.cinemaCode === c.code && s.kind === "large")) {
      // A large screen needs at least two large-format films to choose from.
      for (const f of shuffle(rng, films.filter((x) => x.formats.includes("large")))) {
        if (picked.filter((x) => x.formats.includes("large")).length >= 2) break;
        if (!picked.includes(f)) picked[picked.findIndex((x) => !x.formats.includes("large"))] = f;
      }
    }
    programme.set(c.code, picked);
  }
  const out: CinemaShowtime[] = [];
  for (let date: string = CINEMA_WINDOW.first; date <= CINEMA_WINDOW.last; date = addDays(date, 1)) {
    for (const c of cinemas) {
      const mine = programme.get(c.code) as CinemaFilm[];
      screens.filter((s) => s.cinemaCode === c.code).forEach((s, i) => {
        SLOTS.forEach((slot) => {
          const film = s.kind === "large" ? pick(rng, mine.filter((f) => f.formats.includes("large"))) : weighted(rng, mine, PROGRAMME_WEIGHTS);
          const format: CinemaFormat = s.kind === "large" ? "large" : film.formats.includes("3d") && rng() < 0.5 ? "3d" : "2d";
          out.push({ code: `ST-${2001 + out.length}`, cinemaCode: c.code, screenCode: s.code, filmCode: film.code, date, time: shift(slot, i * 20), format });
        });
      });
    }
  }
  return out;
}

function makeCustomers(rng: Rng): { name: string; email: string }[] {
  const out = new Map<string, { name: string; email: string }>();
  while (out.size < CINEMA_SIZES.customers) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.com`.toLowerCase();
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email });
  }
  return [...out.values()];
}

export function cinemaRows(seed: number): CinemaRows {
  const rng = substream(seed, "cinema");
  const films = makeFilms(rng);
  const { cinemas, screens, prices } = makeCinemas(rng);
  const showtimes = makeShowtimes(rng, cinemas, screens, films);
  const customers = makeCustomers(rng);
  const cinemaOf = new Map(cinemas.map((c) => [c.code, c]));
  const screenOf = new Map(screens.map((s) => [s.code, s]));
  const filmOf = new Map(films.map((f) => [f.code, f]));
  const bookings: CinemaBooking[] = [];

  const mix = (n: number, film: CinemaFilm): CinemaTicketCounts => {
    const c: CinemaTicketCounts = { adult: 0, child: 0, senior: 0, student: 0 };
    const kids = !CINEMA_ADULT_RATINGS.includes(film.rating);
    for (let i = 0; i < n; i++) {
      const r = rng();
      c[r < 0.6 ? "adult" : r < 0.75 ? (kids ? "child" : "adult") : r < 0.87 ? "senior" : "student"]++;
    }
    return c;
  };
  const book = (s: CinemaShowtime, seats: string[], status: CinemaBooking["status"]) => {
    const customer = pick(rng, customers);
    const q = cinemaQuote({ cinema: cinemaOf.get(s.cinemaCode) as Cinema, screen: screenOf.get(s.screenCode) as CinemaScreen, showtime: s, prices }, seats, mix(seats.length, filmOf.get(s.filmCode) as CinemaFilm));
    bookings.push({
      bookingNo: `TK-${30001 + bookings.length}`,
      showtimeCode: s.code,
      customerName: customer.name,
      customerEmail: customer.email,
      tickets: q.tickets,
      feesCents: q.feesCents,
      totalCents: q.totalCents,
      status,
      createdAt: new Date(Date.UTC(2027, 3, 1 + int(rng, 0, 40), int(rng, 8, 22), int(rng, 0, 59))).toISOString(),
    });
  };
  const runsOf = (s: CinemaShowtime) => cinemaFreeRuns(screenOf.get(s.screenCode) as CinemaScreen, cinemaTakenSeats(bookings, s.code));
  /** Books every free seat of the showtime except `keep`, a row's run at a time (at most CINEMA_MAX_SEATS a booking). */
  const fill = (s: CinemaShowtime, keep: ReadonlySet<string>) => {
    for (const run of runsOf(s)) {
      const seats = run.filter((x) => !keep.has(x));
      for (let i = 0; i < seats.length; ) {
        let j = i + 1;
        while (j < seats.length && j - i < CINEMA_MAX_SEATS && Number((seats[j] as string).slice(1)) === Number((seats[j - 1] as string).slice(1)) + 1) j++;
        book(s, seats.slice(i, j), "confirmed");
        i = j;
      }
    }
  };

  for (let i = 0; i < CINEMA_SIZES.bookings; i++) {
    const s = pick(rng, showtimes);
    const n = pick(rng, [1, 2, 2, 2, 3, 3, 4, 5, 6]);
    const runs = runsOf(s).filter((r) => r.length >= n);
    if (runs.length === 0) continue;
    const run = pick(rng, runs);
    const start = int(rng, 0, run.length - n);
    book(s, run.slice(start, start + n), rng() < 0.12 ? "cancelled" : "confirmed");
  }

  // Sold out on purpose: every seat of a few standard-screen showtimes taken, each on a day its cinema shows the
  // film's genre at least four times — so a search by genre, day, time and format has a near miss to step over.
  const standard = showtimes.filter((s) => screenOf.get(s.screenCode)?.kind === "standard");
  const dayOf = (s: CinemaShowtime) => `${s.cinemaCode}:${s.date}:${filmOf.get(s.filmCode)?.genre}`;
  const perDay = new Map<string, number>();
  for (const s of showtimes) perDay.set(dayOf(s), (perDay.get(dayOf(s)) ?? 0) + 1);
  const busy = standard.filter((s) => (perDay.get(dayOf(s)) ?? 0) >= 4);
  const soldOut = shuffle(rng, busy).slice(0, CINEMA_SIZES.soldOut);
  for (const s of soldOut) fill(s, new Set());

  // Nearly full on purpose: only 3–5 single seats left, no two side by side. Half are the first showing of their
  // film at their cinema (so "the earliest showing with seats together" is a later one), half on busy genre days.
  const firsts = new Map<string, CinemaShowtime>();
  for (const s of showtimes) if (!firsts.has(`${s.cinemaCode}:${s.filmCode}`)) firsts.set(`${s.cinemaCode}:${s.filmCode}`, s);
  const pool = (list: CinemaShowtime[]) => shuffle(rng, list.filter((s) => screenOf.get(s.screenCode)?.kind === "standard" && !soldOut.includes(s)));
  const nearly: CinemaShowtime[] = [];
  for (const s of [...pool([...firsts.values()]).slice(0, CINEMA_SIZES.nearlyFull / 2), ...pool(busy), ...pool(standard)]) {
    if (nearly.length >= CINEMA_SIZES.nearlyFull) break;
    if (!nearly.includes(s)) nearly.push(s);
  }
  for (const s of nearly) {
    const screen = screenOf.get(s.screenCode) as CinemaScreen;
    const keep = new Set<string>();
    const want = int(rng, 3, 5);
    for (const seat of shuffle(rng, cinemaFreeSeats(screen, cinemaTakenSeats(bookings, s.code)))) {
      if (keep.size >= want) break;
      const n = Number(seat.slice(1));
      if (!keep.has(`${seat[0]}${n - 1}`) && !keep.has(`${seat[0]}${n + 1}`)) keep.add(seat);
    }
    fill(s, keep);
  }
  return { cinemas, screens, films, prices, showtimes, bookings };
}
