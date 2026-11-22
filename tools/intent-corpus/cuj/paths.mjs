/**
 * The REST routes the cuj-v1 reference solutions use, one builder per query,
 * taking the same query objects as @benchme/scenarios' rules so a key and its
 * live read ask the same question.
 */
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]));
const enc = encodeURIComponent;

export const hotelsPath = {
  hotel: (code) => `/api/v1/hotels/${code}`,
  availability: (room, checkIn, nights) => `/api/v1/rooms/${room}/availability?checkIn=${checkIn}&nights=${nights}`,
  search: (q) => `/api/v1/search?${qs({ city: q.city, checkIn: q.checkIn, nights: q.nights, adults: q.adults, kids: q.kids, pets: q.pets ?? 0, amenities: q.amenities, maxPrice: q.maxNightlyCents !== undefined ? q.maxNightlyCents / 100 : undefined })}`,
  bookings: "/api/v1/bookings",
  bookingsOf: (email) => `/api/v1/bookings?guestEmail=${enc(email)}`,
  booking: (no) => `/api/v1/bookings/${no}`,
  cancel: (no) => `/api/v1/bookings/${no}/cancel`,
};

export const flightsPath = {
  flight: (no) => `/api/v1/flights/${no}`,
  seats: (no, date) => `/api/v1/flights/${no}/seats?date=${date}`,
  carriers: "/api/v1/carriers",
  search: (q) => `/api/v1/search?${qs({ origin: q.origin, destination: q.destination, date: q.date, passengers: q.passengers ?? 1, cabin: q.cabin ?? "economy", maxStops: q.maxStops, carriers: q.carriers, maxPrice: q.maxPriceCents !== undefined ? q.maxPriceCents / 100 : undefined, departAfter: q.departAfter, departBefore: q.departBefore })}`,
  bookings: "/api/v1/bookings",
  bookingsOf: (email) => `/api/v1/bookings?contactEmail=${enc(email)}`,
  booking: (no) => `/api/v1/bookings/${no}`,
  cancel: (no) => `/api/v1/bookings/${no}/cancel`,
};

export const diningPath = {
  restaurant: (code) => `/api/v1/restaurants/${code}`,
  availability: (code, date, partySize) => `/api/v1/restaurants/${code}/availability?date=${date}&partySize=${partySize}`,
  search: (q) => `/api/v1/search?${qs({ city: q.city, date: q.date, time: q.time, partySize: q.partySize, area: q.area, menus: q.menus, cuisine: q.cuisine, maxPriceLevel: q.maxPriceLevel })}`,
  reservations: "/api/v1/reservations",
  reservationsOf: (email) => `/api/v1/reservations?guestEmail=${enc(email)}`,
  reservation: (no) => `/api/v1/reservations/${no}`,
  change: (no) => `/api/v1/reservations/${no}/change`,
  cancel: (no) => `/api/v1/reservations/${no}/cancel`,
};

export const pizzaPath = {
  builder: "/api/v1/builder",
  branch: (code) => `/api/v1/branches/${code}`,
  slots: (code, date, pizzas, from) => `/api/v1/branches/${code}/slots?${qs({ date, pizzas, from })}`,
  pizza: (code) => `/api/v1/pizzas/${code}`,
  search: (q) => `/api/v1/search?${qs({ size: q.size, branch: q.branchCode, vegetarian: q.vegetarian ? "true" : undefined, vegan: q.vegan ? "true" : undefined, without: q.without, toppings: q.toppings, maxPrice: q.maxPriceCents !== undefined ? q.maxPriceCents / 100 : undefined })}`,
  quote: "/api/v1/quote",
  orders: "/api/v1/orders",
  ordersOf: (email) => `/api/v1/orders?customerEmail=${enc(email)}`,
  order: (no) => `/api/v1/orders/${no}`,
  line: (no, line) => `/api/v1/orders/${no}/lines/${line}`,
  cancel: (no) => `/api/v1/orders/${no}/cancel`,
};

export const cinemaPath = {
  cinema: (code) => `/api/v1/cinemas/${code}`,
  film: (code) => `/api/v1/films/${code}`,
  showtime: (code) => `/api/v1/showtimes/${code}`,
  search: (q) => `/api/v1/showtimes?${qs({ city: q.city, cinema: q.cinemaCode, date: q.date, genre: q.genre, film: q.filmCode, format: q.format, after: q.after, seats: q.seats, together: q.together })}`,
  bookings: "/api/v1/bookings",
  bookingsOf: (email) => `/api/v1/bookings?customerEmail=${enc(email)}`,
  booking: (no) => `/api/v1/bookings/${no}`,
  cancel: (no) => `/api/v1/bookings/${no}/cancel`,
};

export const sportsPath = {
  policies: "/api/v1/policies",
  product: (code) => `/api/v1/products/${code}`,
  variant: (sku) => `/api/v1/variants/${sku}`,
  customer: (email) => `/api/v1/customers/${enc(email)}`,
  orders: "/api/v1/orders",
  ordersOf: (email) => `/api/v1/orders?customerEmail=${enc(email)}`,
  order: (no) => `/api/v1/orders/${no}`,
  cancel: (no) => `/api/v1/orders/${no}/cancel`,
  reorder: (no) => `/api/v1/orders/${no}/reorder`,
  returns: "/api/v1/returns",
  returnsOf: (orderNo) => `/api/v1/returns?orderNo=${enc(orderNo)}`,
};

export const homesPath = {
  listing: (code) => `/api/v1/listings/${code}`,
  slots: (code, from) => `/api/v1/listings/${code}/slots?${qs({ from, free: "true" })}`,
  search: (q) => `/api/v1/listings?${qs({ city: q.city, type: q.types, minBeds: q.minBeds, minBaths: q.minBaths, features: q.features, maxPrice: q.maxPriceCents !== undefined ? q.maxPriceCents / 100 : undefined, status: q.status })}`,
  viewings: "/api/v1/viewings",
  viewingsOf: (email) => `/api/v1/viewings?email=${enc(email)}`,
  viewing: (no) => `/api/v1/viewings/${no}`,
  cancel: (no) => `/api/v1/viewings/${no}/cancel`,
};

export const clinicPath = {
  doctor: (code) => `/api/v1/doctors/${code}`,
  slots: (code, date) => `/api/v1/doctors/${code}/slots?date=${date}`,
  doctors: (q) => `/api/v1/doctors?${qs({ city: q.city, specialty: q.specialty, language: q.language, visitType: q.visitType, plan: q.planCode, newPatients: q.newPatients ? "true" : undefined, date: q.date })}`,
  medication: (code) => `/api/v1/medications/${code}`,
  prices: (code, dosage) => `/api/v1/prices?${qs({ medication: code, dosage })}`,
  appointments: "/api/v1/appointments",
  appointmentsOf: (email) => `/api/v1/appointments?patientEmail=${enc(email)}`,
  appointment: (no) => `/api/v1/appointments/${no}`,
  cancel: (no) => `/api/v1/appointments/${no}/cancel`,
  patient: (email) => `/api/v1/patients/${enc(email)}`,
  prescription: (rx) => `/api/v1/prescriptions/${rx}`,
  refill: (rx) => `/api/v1/prescriptions/${rx}/refill`,
  refillsOf: (rx) => `/api/v1/refills?rxNo=${enc(rx)}`,
};

export const eventsPath = {
  room: (code) => `/api/v1/rooms/${code}`,
  freeRooms: (q) => `/api/v1/free-rooms?${qs({ office: q.officeCode, date: q.date, startTime: q.startTime, endTime: q.endTime, people: q.people, equipment: q.equipment, accessible: q.accessible ? "true" : undefined })}`,
  events: "/api/v1/events",
  eventsWhere: (q) => `/api/v1/events?${qs(q)}`,
  event: (code) => `/api/v1/events/${code}`,
  change: (code) => `/api/v1/events/${code}/change`,
  cancel: (code) => `/api/v1/events/${code}/cancel`,
  register: (code) => `/api/v1/events/${code}/register`,
  registrationsOf: (email) => `/api/v1/registrations?email=${enc(email)}`,
  registration: (no) => `/api/v1/registrations/${no}`,
  cancelRegistration: (no) => `/api/v1/registrations/${no}/cancel`,
};
