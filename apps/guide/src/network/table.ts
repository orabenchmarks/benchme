import { CATEGORIES } from "../content/catalog.js";
import { NETWORK_ROWS } from "./edition-table.js";
import { NetworkEditionTable } from "./editions.js";

/** The shipped network table: every row of edition-table.ts over every published category. */
export const defaultNetworkTable = (): NetworkEditionTable => new NetworkEditionTable(NETWORK_ROWS, CATEGORIES);
