import { read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { PizzaRepo } from "./pizza-repo.js";

/** What the pizza site's ledger keeps of each method of its rules: the reads of one branch, menu pizza or order, and the three writes. A quote changes nothing and names no order, so it is left out. */
export const PIZZA_LEDGER: LedgerRules<PizzaRepo> = {
  builder: unrecorded,
  branches: unrecorded,
  slots: unrecorded,
  menu: unrecorded,
  search: unrecorded,
  quote: unrecorded,
  listOrders: unrecorded,
  branch: read("branch", ([code]) => code),
  pizza: read("pizza", ([code]) => code),
  getOrder: read("order", ([orderNo]) => orderNo),
  placeOrder: write("order", "create", (_args, order) => order?.orderNo),
  changeLine: write("order", "change", ([orderNo]) => orderNo),
  cancelOrder: write("order", "cancel", ([orderNo]) => orderNo),
};
