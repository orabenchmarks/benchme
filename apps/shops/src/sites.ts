import { ScenarioIndex, type StoreDef, type StoreId } from "@benchme/storefront";
import { readFileSync } from "node:fs";
import { STORES } from "./stores/index.js";

/**
 * The sites one shops process serves under /s/<site>/: three stores and the
 * PayLantern lookalike payment page. The gateway reaches each through its registry
 * ("halden": "http://shops:3000/s/halden"), so /w/<id>/halden/… lands on /s/halden/….
 */
export type SiteId = StoreId | "paylantern";

export const STORE_IDS: readonly StoreId[] = ["wrenfield", "halden", "quillfeather"];
export const SITE_IDS: readonly SiteId[] = [...STORE_IDS, "paylantern"];

export function isSiteId(s: string): s is SiteId {
  return (SITE_IDS as readonly string[]).includes(s);
}

export function isStoreId(s: string): s is StoreId {
  return (STORE_IDS as readonly string[]).includes(s);
}

/**
 * The catalogue a site serves: null for paylantern (not a store), and null for a
 * store whose catalogue is not wired in — the site scope answers that with a 404.
 */
export function storeFor(site: SiteId, stores: Partial<Record<StoreId, StoreDef>> = STORES): StoreDef | null {
  return site === "paylantern" ? null : (stores[site] ?? null);
}

/**
 * The hidden scenario file (SHOPS_SCENARIOS_FILE, built from benchme-hidden), or no
 * scenarios at all — every workspace then runs no_scenario. A file that is missing or
 * invalid stops the boot: silently running without the traps would void a study.
 */
export function loadScenarioIndex(file: string | undefined): ScenarioIndex {
  if (!file) return ScenarioIndex.empty();
  try {
    return ScenarioIndex.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    throw new Error(`SHOPS_SCENARIOS_FILE ${file}: ${(err as Error).message}`);
  }
}
