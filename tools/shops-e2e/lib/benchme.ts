/**
 * The benchme code the suite reads, from the checkout's own builds (npx tsc -b packages/storefront apps/shops):
 * the storefront package (suffixTable, parseOrderNumber, US_STATES, addDays, the scenario parser) and the
 * catalogues the stores serve (names, option labels, shipping methods, add-ons) — so every locator is the
 * text a shopper reads on the page, taken from the same data the page is rendered from.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BENCHME_DIR } from "./env.js";

type Storefront = typeof import("../../../packages/storefront/dist/index.js");
type Stores = typeof import("../../../apps/shops/dist/stores/index.js");

export type { Product, ScenarioDef, StoreDef, StoreId } from "../../../packages/storefront/dist/index.js";

async function load<T>(rel: string): Promise<T> {
  try {
    return (await import(pathToFileURL(join(BENCHME_DIR, rel)).href)) as T;
  } catch (err) {
    throw new Error(`cannot load ${rel} from ${BENCHME_DIR} (${(err as Error).message.split("\n")[0]}) — build it first: npx tsc -b packages/storefront apps/shops`);
  }
}

export const sf = await load<Storefront>("packages/storefront/dist/index.js");
const stores = await load<Stores>("apps/shops/dist/stores/index.js");
export const STORES = stores.STORES;
/** The stores' time zone: "today" and delivery dates are store-local. */
export const STORE_TZ = stores.STORE_TZ;
