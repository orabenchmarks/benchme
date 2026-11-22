/**
 * The cuj-v1 rows, indexed once for every template: each site's entities by
 * their natural key, a few groupings the templates ask for, and the accounts
 * the workspace starts with.
 */
const by = (items, key) => new Map(items.map((x) => [key(x), x]));
const group = (items, key) => {
  const out = new Map();
  for (const x of items) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
};

export function contextOf(rows) {
  const h = rows.hotels, f = rows.flights, d = rows.dining, p = rows.pizza, c = rows.cinema, s = rows.sports, m = rows.homes, k = rows.clinic, e = rows.events;
  const accounts = rows.accounts ?? {};
  return {
    rows,
    accounts,
    /** Claim keys of every person who has an account: only the templates that sign in as them may name them. */
    accountPeople: Object.entries(accounts).flatMap(([app, list]) => list.map((a) => `person:${app}:${a.email}`)),
    hotels: { hotel: by(h.hotels, (x) => x.code), room: by(h.rooms, (x) => x.code), roomsOf: group(h.rooms, (x) => x.hotelCode), byGuest: group(h.bookings, (x) => x.guestEmail) },
    flights: { airport: by(f.airports, (x) => x.code), carrier: by(f.carriers, (x) => x.code), flight: by(f.flights, (x) => x.flightNo), cabinsOf: group(f.cabins, (x) => x.flightNo), byContact: group(f.bookings, (x) => x.contactEmail) },
    dining: { restaurant: by(d.restaurants, (x) => x.code), seatingOf: group(d.seating, (x) => x.restaurantCode), byGuest: group(d.reservations, (x) => x.guestEmail) },
    pizza: { branch: by(p.branches, (x) => x.code), pizza: by(p.pizzas, (x) => x.code), byCustomer: group(p.orders, (x) => x.customerEmail) },
    cinema: { cinema: by(c.cinemas, (x) => x.code), screen: by(c.screens, (x) => x.code), film: by(c.films, (x) => x.code), showtime: by(c.showtimes, (x) => x.code), byCustomer: group(c.bookings, (x) => x.customerEmail) },
    sports: { product: by(s.products, (x) => x.code), variant: by(s.variants, (x) => x.sku), category: by(s.categories, (x) => x.key), addressesOf: group(s.addresses, (x) => x.customerEmail), ordersOf: group(s.orders, (x) => x.customerEmail), linesOf: group(s.lines, (x) => x.orderNo) },
    homes: { listing: by(m.listings, (x) => x.code), agent: by(m.agents, (x) => x.code), daysOf: group(m.agentDays, (x) => x.agentCode), byViewer: group(m.viewings, (x) => x.viewerEmail) },
    clinic: { clinic: by(k.clinics, (x) => x.code), doctor: by(k.doctors, (x) => x.code), plan: by(k.plans, (x) => x.code), medication: by(k.medications, (x) => x.code), patient: by(k.patients, (x) => x.email), byPatient: group(k.appointments, (x) => x.patientEmail) },
    events: { office: by(e.offices, (x) => x.code), room: by(e.rooms, (x) => x.code), roomsOf: group(e.rooms, (x) => x.officeCode), person: by(e.people, (x) => x.email), event: by(e.events, (x) => x.code), byEmail: group(e.registrations, (x) => x.email) },
  };
}
