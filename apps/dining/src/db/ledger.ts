import { about, read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { DiningRepo } from "./dining-repo.js";

/** What the restaurant site's ledger keeps of each method of its rules: the reads of one restaurant (its tables on a day among them) or reservation, and the three writes. */
export const DINING_LEDGER: LedgerRules<DiningRepo> = {
  cities: unrecorded,
  listRestaurants: unrecorded,
  search: unrecorded,
  listReservations: unrecorded,
  getRestaurant: read("restaurant", ([code]) => code),
  availability: read("restaurant", ([code]) => code),
  getReservation: read("reservation", ([no]) => no),
  createReservation: write("reservation", "create", (_args, reservation) => reservation?.reservationNo, about("restaurant", ([input]) => input.restaurantCode)),
  changeReservation: write("reservation", "change", ([no]) => no),
  cancelReservation: write("reservation", "cancel", ([no]) => no),
};
