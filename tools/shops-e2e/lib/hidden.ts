/**
 * The tasks of a benchme-hidden checkout (shops/<ID>/{scenario.json,reference.json,wrong.json}), read at
 * run time only: nothing from them is ever written into this repository. The run format is the one
 * tools/build-shop-config.mjs validates and replays; scenario.json goes through the stores' own parser.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sf, type ScenarioDef } from "./benchme.js";

export type Card = "success" | "decline" | "3ds";
export type AddStep = { sku: string; options?: Record<string, string>; qty?: number; mode?: "once" | "subscribe"; interval?: string };
export type DeliveryStep = { offsetDays: number; message?: string; signature?: string };
export type InformationStep = {
  /** A florist's optional "Your name": who the order is from (the buyer; the address is the recipient's). */
  senderName?: string;
  email: string;
  phone: string;
  marketing: boolean;
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  delivery?: DeliveryStep;
};
export type ShippingStep = { method: string; addOns: string[] };
/** The payment step's card, and the ZIP it is billed to (lib/billing.ts: the Link card's billing ZIP when left out). */
export type PayStep = { card: Card; billingZip?: string };

/** One step of a run: an object with exactly one key. */
export type Step =
  | { visit: string }
  | { newsletter: string }
  | { add: AddStep }
  | { promo: string }
  | { checkout: true }
  | { information: InformationStep }
  | { shipping: ShippingStep }
  | { pay: PayStep }
  | { followNotice: true }
  | { paylantern: { card: Card } }
  | { stop: true };

export type Run = { steps: Step[]; expectClass: string; expectPaylantern?: boolean; deferred?: "wallet" };
export type Task = { id: string; scenario: ScenarioDef; reference: Run; wrong: Run };

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }
};

function readRun(path: string): Run {
  const v = readJson(path) as Partial<Run>;
  if (!Array.isArray(v.steps) || typeof v.expectClass !== "string") throw new Error(`${path}: not a run ({ steps, expectClass })`);
  for (const [i, s] of v.steps.entries()) {
    if (typeof s !== "object" || s === null || Object.keys(s).length !== 1) throw new Error(`${path}: step ${i + 1} is not a one-key step`);
  }
  return v as Run;
}

/** Every task under <hiddenDir>/shops, sorted by id as build-shop-config sorts them. */
export function loadTasks(hiddenDir: string): Task[] {
  const dir = join(hiddenDir, "shops");
  if (!existsSync(dir)) throw new Error(`HIDDEN_DIR ${hiddenDir} has no shops/ directory`);
  const ids = readdirSync(dir)
    .filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids.map((id) => {
    const at = (f: string) => join(dir, id, f);
    const [scenario] = sf.ScenarioIndex.parse({ scenarios: [readJson(at("scenario.json"))] }).list();
    if (!scenario || scenario.id !== id) throw new Error(`${at("scenario.json")}: its id is not ${id}`);
    return { id, scenario, reference: readRun(at("reference.json")), wrong: readRun(at("wrong.json")) };
  });
}

/** A step's kind and value. */
export function stepOf(step: Step): [string, unknown] {
  return Object.entries(step)[0] as [string, unknown];
}
