import { z } from "zod";
import { invalid, LinkError } from "./link-errors.js";
import type { LineItem, Total } from "./types.js";

/**
 * The bodies link-cli 0.26.0 sends to POST /spend_requests (create) and POST /spend_requests/:id (update),
 * checked against Link's documented constraints: `context` at least 100 characters, `amount` a positive
 * integer of at most 50,000 cents, `currency` a 3-letter code, merchant name and URL required for a card.
 * Every refusal is a Link-shaped 400 naming the parameter; a parameter Link does not take is refused as
 * Stripe refuses one ("Received unknown parameter").
 */
export const MAX_AMOUNT = 50_000;
export const MIN_CONTEXT = 100;
const TOTAL_TYPES = ["subtotal", "tax", "total", "items_base_amount", "items_discount", "discount", "fulfillment", "shipping", "fee", "gift_wrap", "tip", "store_credit"] as const;

const lineItem = z
  .object({
    name: z.string().min(1),
    url: z.string().optional(),
    image_url: z.string().optional(),
    description: z.string().optional(),
    sku: z.string().optional(),
    // link-cli coerces the CLI's key:value flags to numbers; an MCP caller's object may carry "2".
    quantity: z.coerce.number().int().nonnegative().optional(),
    unit_amount: z.coerce.number().int().optional(),
    product_url: z.string().optional(),
    totals: z.array(z.unknown()).optional(),
  })
  .strict();
const total = z.object({ type: z.enum(TOTAL_TYPES), display_text: z.string(), amount: z.coerce.number().int() }).strict();
const metadata = z
  .record(z.string().max(40), z.string().max(500))
  .refine((m) => Object.keys(m).length <= 50, "metadata takes at most 50 keys");

const createBody = z
  .object({
    idempotency_key: z.string().min(1).max(255).optional(),
    payment_details: z.string().min(1).optional(),
    credential_type: z.string().default("card"),
    network_id: z.string().optional(),
    merchant_account_id: z.string().optional(),
    amount: z.number(),
    currency: z.string().default("usd"),
    merchant_name: z.string().optional(),
    merchant_url: z.string().optional(),
    context: z.string(),
    line_items: z.array(lineItem).optional(),
    totals: z.array(total).optional(),
    request_approval: z.boolean().optional(),
    test: z.boolean().optional(),
    approval_details: z.record(z.unknown()).optional(),
    metadata: metadata.optional(),
    expires_at: z.number().int().optional(),
    recurring: z.object({ interval: z.enum(["day", "week", "month", "year"]), interval_count: z.number().int().positive().default(1) }).strict().optional(),
  })
  .strict();

const updateBody = z
  .object({
    payment_details: z.string().min(1).optional(),
    amount: z.number().optional(),
    merchant_url: z.string().optional(),
    profile_id: z.string().optional(),
    merchant_id: z.string().optional(),
    currency: z.string().optional(),
    line_items: z.array(lineItem).optional(),
    totals: z.array(total).optional(),
  })
  .strict();

export type CreateInput = {
  idempotencyKey: string | null;
  paymentDetails: string | null;
  amount: number;
  currency: string;
  merchantName: string;
  merchantUrl: string;
  context: string;
  lineItems: LineItem[] | null;
  totals: Total[] | null;
  requestApproval: boolean;
  test: boolean;
  metadata: Record<string, string> | null;
  recurring: { interval: string; interval_count: number } | null;
};

export type UpdateInput = Partial<Pick<CreateInput, "paymentDetails" | "amount" | "currency" | "merchantUrl" | "lineItems" | "totals">>;

/** zod's first problem as Link's 400, naming the parameter. */
function refusal(error: z.ZodError): LinkError {
  const issue = error.issues[0];
  if (!issue) return invalid("parameter_invalid", "Invalid request.");
  if (issue.code === "unrecognized_keys") return invalid("parameter_unknown", `Received unknown parameter: ${issue.keys[0]}`, issue.keys[0]);
  const param = issue.path.map(String).join(".");
  if (issue.code === "invalid_type" && issue.received === "undefined") return invalid("parameter_missing", `Missing required param: ${param}.`, param);
  return invalid("parameter_invalid", `Invalid ${param}: ${issue.message}`, param);
}

export function checkAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) throw invalid("parameter_invalid", "amount must be a positive integer number of cents.", "amount");
  if (amount > MAX_AMOUNT) throw invalid("amount_too_large", `amount must not exceed ${MAX_AMOUNT} (cents) per spend request.`, "amount");
  return amount;
}

export function checkCurrency(currency: string): string {
  if (!/^[A-Za-z]{3}$/.test(currency)) throw invalid("parameter_invalid", "currency must be a three-letter ISO code.", "currency");
  return currency.toLowerCase();
}

export function parseCreate(raw: unknown): CreateInput {
  const parsed = createBody.safeParse(raw ?? {});
  if (!parsed.success) throw refusal(parsed.error);
  const b = parsed.data;
  if (b.credential_type !== "card") {
    throw invalid("credential_type_unavailable", `credential_type ${b.credential_type} is not available for this account; request a card.`, "credential_type");
  }
  if (b.network_id !== undefined || b.merchant_account_id !== undefined) {
    throw invalid("parameter_invalid", "network_id and merchant_account_id are not used by card requests.", b.network_id !== undefined ? "network_id" : "merchant_account_id");
  }
  if (!b.merchant_name?.trim()) throw invalid("parameter_missing", "merchant_name is required for a card.", "merchant_name");
  if (!b.merchant_url?.trim()) throw invalid("parameter_missing", "merchant_url is required for a card.", "merchant_url");
  if (b.context.trim().length < MIN_CONTEXT) {
    throw invalid("context_too_short", `context must be at least ${MIN_CONTEXT} characters: describe the purchase and why — the user reads it when approving.`, "context");
  }
  return {
    idempotencyKey: b.idempotency_key ?? null,
    paymentDetails: b.payment_details ?? null,
    amount: checkAmount(b.amount),
    currency: checkCurrency(b.currency),
    merchantName: b.merchant_name.trim(),
    merchantUrl: b.merchant_url.trim(),
    context: b.context,
    lineItems: (b.line_items as LineItem[] | undefined) ?? null,
    totals: b.totals ?? null,
    requestApproval: b.request_approval === true,
    test: b.test === true,
    metadata: b.metadata ?? null,
    recurring: b.recurring ?? null,
  };
}

export function parseUpdate(raw: unknown): UpdateInput {
  const parsed = updateBody.safeParse(raw ?? {});
  if (!parsed.success) throw refusal(parsed.error);
  const b = parsed.data;
  const out: UpdateInput = {};
  if (b.payment_details !== undefined) out.paymentDetails = b.payment_details;
  if (b.amount !== undefined) out.amount = checkAmount(b.amount);
  if (b.currency !== undefined) out.currency = checkCurrency(b.currency);
  if (b.merchant_url !== undefined) {
    if (!b.merchant_url.trim()) throw invalid("parameter_invalid", "merchant_url must not be empty.", "merchant_url");
    out.merchantUrl = b.merchant_url.trim();
  }
  if (b.line_items !== undefined) out.lineItems = b.line_items as LineItem[];
  if (b.totals !== undefined) out.totals = b.totals;
  return out;
}
