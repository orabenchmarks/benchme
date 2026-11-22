import { read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { CinemaRepo } from "./cinema-repo.js";

/** What the cinema site's ledger keeps of each method of its rules: the reads of one cinema, film, showtime (its seat map) or booking, and both writes. */
export const CINEMA_LEDGER: LedgerRules<CinemaRepo> = {
  listCinemas: unrecorded,
  listFilms: unrecorded,
  search: unrecorded,
  listBookings: unrecorded,
  getCinema: read("cinema", ([code]) => code),
  getFilm: read("film", ([code]) => code),
  getShowtime: read("showtime", ([code]) => code),
  getBooking: read("booking", ([bookingNo]) => bookingNo),
  createBooking: write("booking", "create", (_args, booking) => booking?.bookingNo),
  cancelBooking: write("booking", "cancel", ([bookingNo]) => bookingNo),
};
