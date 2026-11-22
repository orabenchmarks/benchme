import { read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { HomesRepo } from "./homes-repo.js";

/** What the homes site's ledger keeps of each method of its rules: the reads of one listing (its viewing slots among them), agent or viewing, and both writes. */
export const HOMES_LEDGER: LedgerRules<HomesRepo> = {
  cities: unrecorded,
  search: unrecorded,
  listAgents: unrecorded,
  listViewings: unrecorded,
  getListing: read("listing", ([code]) => code),
  slots: read("listing", ([listingCode]) => listingCode),
  getAgent: read("agent", ([code]) => code),
  getViewing: read("viewing", ([viewingNo]) => viewingNo),
  requestViewing: write("viewing", "create", (_args, viewing) => viewing?.viewingNo),
  cancelViewing: write("viewing", "cancel", ([viewingNo]) => viewingNo),
};
