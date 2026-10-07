import type { StoreDef, StoreId } from "@benchme/storefront";
import { HALDEN } from "./halden.js";
import { QUILLFEATHER } from "./quillfeather.js";
import { WRENFIELD } from "./wrenfield.js";

export { PAYLANTERN_BRAND } from "./paylantern.js";

/** Every store's local time zone: "today", delivery dates and the same-day cutoff are computed in it. */
export const STORE_TZ = "America/Los_Angeles";

/** The catalogues the shops app serves, by store id (a store missing here answers 404; see storeFor in sites.ts). */
export const STORES: Partial<Record<StoreId, StoreDef>> = {
  wrenfield: WRENFIELD,
  halden: HALDEN,
  quillfeather: QUILLFEATHER,
};
