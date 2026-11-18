import type { ScenarioRows } from "../scenario.js";
import { cinemaRows } from "./cinema/generate.js";
import { clinicRows } from "./clinic/generate.js";
import { diningRows } from "./dining/generate.js";
import { eventRows } from "./events/generate.js";
import { flightRows } from "./flights/generate.js";
import { homeRows } from "./homes/generate.js";
import { hotelRows } from "./hotels/generate.js";
import { pizzaRows } from "./pizza/generate.js";
import { sportsRows } from "./sports/generate.js";

/**
 * The nine sites shaped on GoogleChromeLabs/webmcp-tools (README § Sites from
 * webmcp-tools), by app key. Each draws its rows from a stream of its own
 * (`substream(seed, "<app>")`), so the scenario that carries them — webmcp-v1 —
 * moves none of them, and their answer keys are the same whichever scenario
 * derives them.
 */
export const SITE_APPS = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"] as const;
export type SiteApp = (typeof SITE_APPS)[number];
export type SiteRows = Pick<ScenarioRows, SiteApp>;

export function siteRows(seed: number): SiteRows {
  return {
    hotels: hotelRows(seed),
    flights: flightRows(seed),
    dining: diningRows(seed),
    pizza: pizzaRows(seed),
    cinema: cinemaRows(seed),
    sports: sportsRows(seed),
    homes: homeRows(seed),
    clinic: clinicRows(seed),
    events: eventRows(seed),
  };
}

/** Every site with no rows: what a scenario that does not carry them seeds into them. */
export function noSiteRows(): SiteRows {
  return {
    hotels: { hotels: [], rooms: [], bookings: [] },
    flights: { airports: [], carriers: [], flights: [], cabins: [], bookings: [] },
    dining: { restaurants: [], seating: [], reservations: [] },
    pizza: { sizes: [], toppings: [], pizzas: [], branches: [], stockouts: [], orders: [] },
    cinema: { cinemas: [], screens: [], films: [], prices: [], showtimes: [], bookings: [] },
    sports: { categories: [], shipping: { feeCents: 0, freeFromCents: 0 }, products: [], variants: [], customers: [], addresses: [], orders: [], lines: [], returns: [] },
    homes: { agents: [], listings: [], agentDays: [], viewings: [] },
    clinic: { clinics: [], doctors: [], plans: [], procedures: [], coverage: [], medications: [], prices: [], patients: [], appointments: [], prescriptions: [], refills: [] },
    events: { offices: [], rooms: [], people: [], events: [], registrations: [] },
  };
}
