import { about, read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { HotelsRepo } from "./hotels-repo.js";

/** What the hotel site's ledger keeps of each method of its rules: the reads of one hotel, room type or booking, and both writes. */
export const HOTELS_LEDGER: LedgerRules<HotelsRepo> = {
  cities: unrecorded,
  listHotels: unrecorded,
  search: unrecorded,
  listBookings: unrecorded,
  getHotel: read("hotel", ([code]) => code),
  availability: read("room", ([roomCode]) => roomCode),
  getBooking: read("booking", ([bookingNo]) => bookingNo),
  createBooking: write("booking", "create", (_args, booking) => booking?.bookingNo, about("room", ([input]) => input.roomCode)),
  cancelBooking: write("booking", "cancel", ([bookingNo]) => bookingNo),
};
