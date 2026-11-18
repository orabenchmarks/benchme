/**
 * The cinema ticket booking site (apps/cinema). A chain with one cinema in
 * each city; each cinema has screens with a seat map, a price table by format
 * and ticket type, a booking fee per ticket and a surcharge for premium-row
 * seats. Showtimes fall in a fixed window in 2027. Rows carry natural keys
 * (CN-101, FM-101, ST-2001, TK-30001) and no database ids. Rules: ./rules.ts.
 */
export type CinemaFormat = "2d" | "3d" | "large";
export type CinemaTicketType = "adult" | "child" | "senior" | "student";
/** Age ratings. Child tickets are not sold for films rated 15 or 18. */
export type CinemaRating = "U" | "PG" | "12" | "15" | "18";
export type CinemaScreenKind = "standard" | "large";
export type CinemaBookingStatus = "confirmed" | "cancelled";

export type Cinema = {
  code: string;
  name: string;
  city: string;
  address: string;
  /** Charged once per ticket on every booking. */
  bookingFeeCents: number;
  /** Added to the ticket price of every seat in a premium row. */
  premiumSurchargeCents: number;
};

export type CinemaScreen = {
  cinemaCode: string;
  code: string;
  name: string;
  /** A standard screen shows 2D and 3D; a large screen shows large format only. */
  kind: CinemaScreenKind;
  /** Rows are lettered from A; at most 8 (A–H). */
  rows: number;
  /** Seats are numbered from 1 in every row. */
  seatsPerRow: number;
  /** Row letters whose seats are premium (the back rows). */
  premiumRows: string[];
};

export type CinemaFilm = {
  code: string;
  title: string;
  genre: string;
  rating: CinemaRating;
  runtimeMinutes: number;
  language: string;
  synopsis: string;
  /** The formats the film is released in; every film has 2d. */
  formats: CinemaFormat[];
};

/** One cell of a cinema's price table. A cinema without a large screen has no large-format prices. */
export type CinemaPrice = { cinemaCode: string; format: CinemaFormat; ticketType: CinemaTicketType; priceCents: number };

export type CinemaShowtime = {
  code: string;
  cinemaCode: string;
  screenCode: string;
  filmCode: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Start time, 24-hour "HH:MM". */
  time: string;
  format: CinemaFormat;
};

/** One seat of a booking: its ticket type and what it costs (ticket price plus any premium surcharge; the booking fee is separate). */
export type CinemaTicket = { seat: string; ticketType: CinemaTicketType; priceCents: number };

export type CinemaBooking = {
  bookingNo: string;
  showtimeCode: string;
  customerName: string;
  customerEmail: string;
  /** In seat order (row, then number). */
  tickets: CinemaTicket[];
  /** The booking fee times the number of tickets. */
  feesCents: number;
  /** Sum of the tickets' prices plus the fees. */
  totalCents: number;
  status: CinemaBookingStatus;
  createdAt: string;
};

export type CinemaRows = {
  cinemas: Cinema[];
  screens: CinemaScreen[];
  films: CinemaFilm[];
  prices: CinemaPrice[];
  showtimes: CinemaShowtime[];
  bookings: CinemaBooking[];
};
