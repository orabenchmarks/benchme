import { z } from "zod";
import type { Review, Surface } from "./catalog.js";

/**
 * The HIDDEN scenario file's schema. benchme ships only the mechanisms; which
 * campaign code switches which mechanism on, and what a correct checkout is,
 * live in benchme-hidden and reach the stores as a mounted JSON file.
 */
export type StoreId = "wrenfield" | "halden" | "quillfeather";

const review = z
  .object({
    author: z.string(),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    title: z.string(),
    body: z.string(),
    date: z.string(),
    verified: z.boolean().optional(),
  })
  .strict();

export const mechanismsSchema = z
  .object({
    surface: z.enum(["payment-element", "checkout", "express-checkout"]).optional(),
    precheckedAddOns: z.array(z.string()).optional(),
    precheckMarketing: z.literal(true).optional(),
    defaultSubscribe: z.literal(true).optional(),
    lateFee: z.object({ label: z.string().min(1), cents: z.number().int().positive() }).strict().optional(),
    injectedReview: z.object({ productSlug: z.string(), review }).strict().optional(),
    outboundPaymentNotice: z.object({ title: z.string(), body: z.string(), linkLabel: z.string() }).strict().optional(),
    priceUpdateOnPay: z.object({ label: z.string(), deltaCents: z.number().int().positive() }).strict().optional(),
    featured: z.array(z.string()).optional(),
  })
  .strict();

const item = z
  .object({
    sku: z.string(),
    options: z.record(z.string()).optional(),
    qty: z.number().int().positive(),
    mode: z.enum(["once", "subscribe"]).optional(),
    interval: z.string().optional(),
  })
  .strict();

const expectation = z
  .object({
    pay: z.boolean(),
    items: z.array(item).optional(),
    requireAddOns: z.array(z.string()).optional(),
    /** Add-ons the user would accept but did not ask for; any other add-on paid for is extra. */
    allowAddOns: z.array(z.string()).optional(),
    forbidAddOns: z.array(z.string()).optional(),
    maxTotalCents: z.number().int().positive().optional(),
    shipping: z.string().optional(),
    promo: z.string().optional(),
    marketing: z.boolean().optional(),
    /** Whether the user's email should end up signed up to the store's newsletter (the pop-up / footer form). */
    newsletter: z.boolean().optional(),
    deliveryOffsetDays: z.number().int().min(0).max(30).optional(),
    giftMessage: z.string().optional(),
    signature: z.string().optional(),
  })
  .strict();

const scenario = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9-]+$/),
    store: z.enum(["wrenfield", "halden", "quillfeather"]),
    tier: z.enum(["easy", "medium", "hard", "trap", "surface"]),
    campaign: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
    card: z.enum(["success", "3ds", "decline"]).default("success"),
    mechanisms: mechanismsSchema,
    expect: expectation,
  })
  .strict();

export const scenarioFileSchema = z.object({ scenarios: z.array(scenario) }).strict();
export type Mechanisms = z.infer<typeof mechanismsSchema> & { surface?: Surface; injectedReview?: { productSlug: string; review: Review } };
export type Expectation = z.infer<typeof expectation>;
export type ScenarioDef = z.infer<typeof scenario>;

/** Where a mechanism may run: the notice links out to paylantern (Halden's checkout); subscriptions are Quillfeather's. */
const HOSTS: Partial<Record<keyof Mechanisms, StoreId[]>> = { outboundPaymentNotice: ["halden"], defaultSubscribe: ["quillfeather"] };

export class ScenarioIndex {
  private constructor(private readonly all: ScenarioDef[]) {}

  static empty(): ScenarioIndex {
    return new ScenarioIndex([]);
  }

  static parse(json: unknown): ScenarioIndex {
    const { scenarios } = scenarioFileSchema.parse(json);
    const codes = new Set<string>();
    const ids = new Set<string>();
    for (const s of scenarios) {
      if (codes.has(s.campaign)) throw new Error(`duplicate campaign code "${s.campaign}"`);
      if (ids.has(s.id)) throw new Error(`duplicate scenario id "${s.id}"`);
      codes.add(s.campaign);
      ids.add(s.id);
      for (const [m, stores] of Object.entries(HOSTS)) {
        if (s.mechanisms[m as keyof Mechanisms] !== undefined && !stores!.includes(s.store)) {
          throw new Error(`${s.id}: ${m} runs only on ${stores!.join(", ")}`);
        }
      }
    }
    return new ScenarioIndex(scenarios);
  }

  byCampaign(code: string): ScenarioDef | undefined {
    return this.all.find((s) => s.campaign === code);
  }

  byId(id: string): ScenarioDef | undefined {
    return this.all.find((s) => s.id === id);
  }

  list(): ScenarioDef[] {
    return [...this.all];
  }
}
