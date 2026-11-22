import { about, read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { FlightsRepo } from "./flights-repo.js";

/** What the flights site's ledger keeps of each method of its rules: the reads of one flight (its seats on a date among them) or booking, and both writes. */
export const FLIGHTS_LEDGER: LedgerRules<FlightsRepo> = {
  airports: unrecorded,
  carriers: unrecorded,
  listFlights: unrecorded,
  search: unrecorded,
  listBookings: unrecorded,
  getFlight: read("flight", ([flightNo]) => flightNo),
  seats: read("flight", ([flightNo]) => flightNo),
  getBooking: read("booking", ([bookingNo]) => bookingNo),
  createBooking: write("booking", "create", (_args, booking) => booking?.bookingNo, about("flight", ([input]) => input.flightNo)),
  cancelBooking: write("booking", "cancel", ([bookingNo]) => bookingNo),
};
