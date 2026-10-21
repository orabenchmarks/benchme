import type { Product } from "../content/types.js";
import { sitePath, type NetworkEdition } from "./editions.js";
import { POINTERS } from "./pointers.js";

/**
 * Which page of an edition points where. A chain enters the network only from the TARGET's own vendor site, which
 * points to hop 1; every served site but the last points to the next hop; an explicit arm's sites point onward
 * exactly as its editorial chain's do, and no vendor site points anywhere. Base serves no site, so nothing points.
 */
export function vendorPointer(e: NetworkEdition, p: Product, prefix: string): string {
  const first = e.chain[0];
  if (e.arm.entry !== "vendor" || !e.arm.pointer || p.slug !== e.target.slug || !first) return "";
  return POINTERS[e.arm.pointer].render(e.category, first, `${prefix}/${sitePath(first.key)}`);
}

/** The pointer on the site served at `hop` (1-based) to the one at hop + 1; "" on the last hop. */
export function sitePointer(e: NetworkEdition, hop: number, prefix: string): string {
  const next = e.chain[hop];
  if (!e.arm.pointer || !next) return "";
  return POINTERS[e.arm.pointer].render(e.category, next, `${prefix}/${sitePath(next.key)}`);
}
