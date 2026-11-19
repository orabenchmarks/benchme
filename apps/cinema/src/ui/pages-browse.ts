import { CINEMA_GENRES, CINEMA_MAX_SEATS, CINEMA_WINDOW, addDays, type Cinema, type CinemaFilm, type CinemaShowtimeOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { CinemaDetail, FilmDetail } from "../db/cinema-repo.js";

/** Search, programme and catalogue pages: everything a visitor reads before choosing seats. */
export const FORMAT_LABEL: Record<string, string> = { "2d": "2D", "3d": "3D", large: "Large format" };
export const TYPE_LABEL: Record<string, string> = { adult: "Adult", child: "Child (3–14)", senior: "Senior (65+)", student: "Student" };
export type Filters = Record<string, string | undefined>;

const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
const inline = 'style="width:auto;display:inline"';
const days = (() => {
  const out: string[] = [];
  for (let d: string = CINEMA_WINDOW.first; d <= CINEMA_WINDOW.last; d = addDays(d, 1)) out.push(d);
  return out;
})();
const select = (name: string, values: readonly string[], current: string | undefined, label = (v: string) => v) =>
  `<select name="${name}"><option value="">Any</option>${values.map((v) => `<option value="${esc(v)}"${current === v ? " selected" : ""}>${esc(label(v))}</option>`).join("")}</select>`;

export function searchForm(p: string, cinemas: Cinema[], f: Filters = {}): string {
  const cities = [...new Set(cinemas.map((c) => c.city))].sort();
  return `<form class="card" method="get" action="${p}/showtimes">
<label>City</label>${select("city", cities, f.city)}<label>Date</label>${select("date", days, f.date)}<label>Genre</label>${select("genre", CINEMA_GENRES, f.genre)}
<label>Format</label>${select("format", ["2d", "3d", "large"], f.format, (v) => FORMAT_LABEL[v] ?? v)}<label>Starting at or after (HH:MM)</label><input name="after" value="${esc(f.after ?? "")}" placeholder="18:00">
<label>Seats needed</label><input name="seats" type="number" min="1" max="${CINEMA_MAX_SEATS}" value="${esc(f.seats ?? "")}">
<label><input type="checkbox" name="together" value="1" ${inline}${f.together ? " checked" : ""}> Seats side by side in one row</label><button>Search</button></form>`;
}

export function home(p: string, cinemas: Cinema[], f: Filters = {}): string {
  return `<h1>Find a showtime</h1>${searchForm(p, cinemas, f)}
<h2>Cinemas</h2><table><tr><th>City</th><th>Cinema</th><th>Address</th><th>Programme</th></tr>${cinemas
    .map((c) => `<tr><td>${esc(c.city)}</td><td><a href="${p}/cinemas/${esc(c.code)}">${esc(c.name)}</a> <code>${esc(c.code)}</code></td><td>${esc(c.address)}</td><td><a href="${p}/showtimes?cinema=${esc(c.code)}">All showtimes</a></td></tr>`)
    .join("")}</table>
<p class="muted">Showtimes run from ${CINEMA_WINDOW.first} to ${CINEMA_WINDOW.last}. One booking takes up to ${CINEMA_MAX_SEATS} seats. Child tickets (ages 3–14) are not sold for films rated 15 or 18. Every ticket carries the cinema's booking fee; seats in premium rows carry a surcharge. Sign in to book.</p>`;
}

export function showtimesTable(p: string, offers: CinemaShowtimeOffer[], empty = "No showtime matches every filter."): string {
  const rows = offers
    .map(
      (o) =>
        `<tr><td><a href="${p}/showtimes/${esc(o.showtimeCode)}">${esc(o.showtimeCode)}</a></td><td>${esc(o.date)}</td><td>${esc(o.time)}</td><td><a href="${p}/films/${esc(o.filmCode)}">${esc(o.filmTitle)}</a></td><td>${esc(o.genre)}</td><td>${esc(o.rating)}</td>
<td><a href="${p}/cinemas/${esc(o.cinemaCode)}">${esc(o.cinemaName)}</a>, ${esc(o.city)}</td><td>${esc(o.screenName)}</td><td>${esc(FORMAT_LABEL[o.format] ?? o.format)}</td><td>${o.freeSeats === 0 ? "Sold out" : `${o.freeSeats} of ${o.seatsTotal}`}</td><td>${o.bestRun}</td><td>${o.adultPriceCents === null ? "" : money(o.adultPriceCents)}</td></tr>`,
    )
    .join("");
  return `<table><tr><th>Showtime</th><th>Date</th><th>Starts</th><th>Film</th><th>Genre</th><th>Rating</th><th>Cinema</th><th>Screen</th><th>Format</th><th>Free seats</th><th>Most side by side</th><th>Adult ticket</th></tr>${rows || `<tr><td colspan=12>${esc(empty)}</td></tr>`}</table>`;
}

export function searchResults(p: string, cinemas: Cinema[], f: Filters, offers: CinemaShowtimeOffer[]): string {
  const said = [f.city, f.cinema, f.date, f.genre, f.format ? FORMAT_LABEL[f.format] : undefined, f.after ? `from ${f.after}` : undefined, f.seats ? `${f.seats} seat(s)${f.together ? " side by side" : ""}` : undefined].filter(Boolean).join(", ");
  return `<h1>Showtimes${said ? `: ${esc(said)}` : ""}</h1><p class="muted">${offers.length} showtime(s), by date and start time. "Most side by side" is the most free seats next to each other in one row. <a href="${p}/">New search</a></p>
${showtimesTable(p, offers)}<h2>Change the search</h2>${searchForm(p, cinemas, f)}`;
}

export function filmsList(p: string, films: CinemaFilm[], f: Filters, cities: string[]): string {
  const rows = films
    .map((x) => `<tr><td><a href="${p}/films/${esc(x.code)}">${esc(x.title)}</a></td><td><code>${esc(x.code)}</code></td><td>${esc(x.genre)}</td><td>${esc(x.rating)}</td><td>${x.runtimeMinutes} min</td><td>${esc(x.language)}</td><td>${x.formats.map((v) => tag(FORMAT_LABEL[v] ?? v)).join(" ")}</td></tr>`)
    .join("");
  return `<h1>Films</h1><form method="get" action="${p}/films" style="margin-bottom:1rem">Genre ${select("genre", CINEMA_GENRES, f.genre).replace("<select", `<select ${inline}`)} City ${select("city", cities, f.city).replace("<select", `<select ${inline}`)} <button style="margin:0">Filter</button></form>
<table><tr><th>Title</th><th>Code</th><th>Genre</th><th>Rating</th><th>Runtime</th><th>Language</th><th>Formats</th></tr>${rows || "<tr><td colspan=7>None.</td></tr>"}</table>`;
}

export function filmDetail(p: string, film: FilmDetail): string {
  const child = ["15", "18"].includes(film.rating) ? " Child tickets are not sold for this film." : "";
  return `<h1>${esc(film.title)} <code>${esc(film.code)}</code></h1><p>${tag(film.genre)} · rated ${esc(film.rating)} · ${film.runtimeMinutes} min · ${esc(film.language)} · ${film.formats.map((v) => esc(FORMAT_LABEL[v] ?? v)).join(", ")}</p>
<p>${esc(film.synopsis)}${child}</p><h2>Showtimes</h2>${showtimesTable(p, film.showtimes, "No showtimes.")}`;
}

export function cinemaDetail(p: string, c: CinemaDetail): string {
  const screens = c.screens
    .map((s) => `<tr><td>${esc(s.name)}</td><td><code>${esc(s.code)}</code></td><td>${s.kind === "large" ? "Large format" : "Standard (2D and 3D)"}</td><td>A–${"ABCDEFGH"[s.rows - 1]}</td><td>${s.seatsPerRow}</td><td>${s.premiumRows.join(", ")}</td></tr>`)
    .join("");
  const formats = [...new Set(c.prices.map((x) => x.format))];
  const cell = (format: string, type: string) => {
    const price = c.prices.find((x) => x.format === format && x.ticketType === type);
    return `<td>${price ? money(price.priceCents) : "—"}</td>`;
  };
  return `<h1>${esc(c.name)} <code>${esc(c.code)}</code></h1><p>${esc(c.address)}</p>
<p>Booking fee: ${money(c.bookingFeeCents)} per ticket. Premium-row seats: ${money(c.premiumSurchargeCents)} extra per seat. <a href="${p}/showtimes?cinema=${esc(c.code)}">All showtimes at this cinema</a></p>
<h2>Ticket prices</h2><table><tr><th>Ticket</th>${formats.map((v) => `<th>${esc(FORMAT_LABEL[v] ?? v)}</th>`).join("")}</tr>${["adult", "child", "senior", "student"].map((t) => `<tr><td>${esc(TYPE_LABEL[t])}</td>${formats.map((v) => cell(v, t)).join("")}</tr>`).join("")}</table>
<h2>Screens</h2><table><tr><th>Screen</th><th>Code</th><th>Shows</th><th>Rows</th><th>Seats per row</th><th>Premium rows</th></tr>${screens}</table>`;
}
