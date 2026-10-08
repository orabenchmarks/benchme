import Stripe from "stripe";
import { PaymentNotFoundError, type Charge, type Intent, type IntentInput, type IntentStatus, type PaymentGateway, type Session, type SessionInput } from "./gateway.js";

/** Statuses passed through as they are; anything else (requires_capture, a future status) is never "paid". */
const KNOWN: ReadonlySet<string> = new Set<IntentStatus>(["requires_payment_method", "requires_confirmation", "requires_action", "processing", "succeeded", "canceled"]);
const toStatus = (s: string): IntentStatus => (KNOWN.has(s) ? (s as IntentStatus) : "processing");

/**
 * How long one call to Stripe may take before it is abandoned, and how often a failed one is tried again: a page
 * waiting on Stripe answers within about twice this, never Stripe's own default of 80 s and two retries.
 */
export const STRIPE_TIMEOUT_MS = 12_000;
/** The longest timeout a caller may ask for. */
const MAX_TIMEOUT_MS = 15_000;
export const STRIPE_MAX_NETWORK_RETRIES = 1;

/** Stripe's "No such payment_intent / checkout.session" — a stale or forged id, answered as not found. */
async function orNotFound<T>(id: string, call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") throw new PaymentNotFoundError(id);
    throw err;
  }
}

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));

function toIntent(pi: Stripe.PaymentIntent): Intent {
  const status = toStatus(pi.status);
  const err = pi.last_payment_error;
  return {
    id: pi.id,
    status,
    amountCents: pi.amount,
    metadata: { ...pi.metadata },
    lastError: err?.message ?? null,
    lastErrorCode: err?.code ?? null,
    // The card waiting for 3-D Secure, else the card of the failure Stripe reports; a paid intent has none under way.
    attemptMethod: status === "requires_action" ? idOf(pi.payment_method) : status === "succeeded" ? null : idOf(err?.payment_method),
    latestCharge: idOf(pi.latest_charge),
  };
}

function toCharge(ch: Stripe.Charge): Charge {
  const tds = ch.payment_method_details?.card?.three_d_secure;
  return {
    id: ch.id,
    status: ch.status === "succeeded" ? "succeeded" : ch.status === "failed" ? "failed" : "pending",
    paymentMethod: ch.payment_method ?? null,
    threeDSecure: tds ? { flow: tds.authentication_flow ?? null, result: tds.result ?? null } : null,
    card: ch.payment_method_details?.card?.last4 ? { last4: ch.payment_method_details.card.last4 } : null,
    created: ch.created,
  };
}

/**
 * Stripe, TEST MODE ONLY: the constructor refuses anything but a test secret key
 * (sk_test_…) and a test publishable key (pk_test_…) — a second line behind the
 * config's live-key guard. `config` passes through to the SDK (tests give it an
 * offline HTTP client), except that every call times out within STRIPE_TIMEOUT_MS
 * (at most 15 s) and a failed one is tried again at most once: a slow Stripe holds a
 * page for seconds, never minutes.
 *
 * The plan's `payment_method_types` is `allowed_payment_method_types` here: stripe@23
 * (API 2026-09-30.endive) removed the old request parameter from PaymentIntents and
 * Checkout Sessions; it restricts the methods the same way.
 *
 * Cards only, everywhere the store sends the shopper (DESIGN 5.3): the hosted page
 * shows no Link (which offered a bank account and Klarna beside the card) and no other
 * currency first (Adaptive Pricing off), and every payment names its store on the
 * buyer's card statement (statement_descriptor_suffix).
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly mode = "stripe" as const;
  /** What every call is given: its timeout, and how many times a failed one is tried again. */
  readonly timeoutMs: number;
  readonly maxNetworkRetries: number;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    readonly publishableKey: string,
    config: Stripe.StripeConfig = {},
  ) {
    // Messages name the expected prefix only — a refused key is never echoed into a log.
    if (!secretKey.startsWith("sk_test_")) throw new Error("StripePaymentGateway takes a test-mode secret key (sk_test_…) only; live and restricted keys are refused");
    if (!publishableKey.startsWith("pk_test_")) throw new Error("StripePaymentGateway takes a test-mode publishable key (pk_test_…) only");
    this.timeoutMs = Math.min(config.timeout ?? STRIPE_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.maxNetworkRetries = Math.min(config.maxNetworkRetries ?? STRIPE_MAX_NETWORK_RETRIES, STRIPE_MAX_NETWORK_RETRIES);
    this.stripe = new Stripe(secretKey, { ...config, timeout: this.timeoutMs, maxNetworkRetries: this.maxNetworkRetries });
  }

  async createIntent(i: IntentInput): Promise<{ id: string; clientSecret: string }> {
    const pi = await this.stripe.paymentIntents.create({
      amount: i.amountCents,
      currency: "usd",
      allowed_payment_method_types: i.methods,
      receipt_email: i.email,
      statement_descriptor_suffix: i.statementDescriptor,
      metadata: i.metadata,
    });
    if (!pi.client_secret) throw new Error(`Stripe returned payment intent ${pi.id} without a client secret`);
    return { id: pi.id, clientSecret: pi.client_secret };
  }

  async updateIntentAmount(id: string, amountCents: number): Promise<void> {
    await orNotFound(id, this.stripe.paymentIntents.update(id, { amount: amountCents }));
  }

  async getIntent(id: string): Promise<Intent> {
    return toIntent(await orNotFound(id, this.stripe.paymentIntents.retrieve(id)));
  }

  /** Stripe lists the newest first: read back oldest first (by creation; Stripe's own order breaks a tie). */
  async charges(intentId: string): Promise<Charge[]> {
    const list = await orNotFound(intentId, this.stripe.charges.list({ payment_intent: intentId, limit: 100 }));
    return list.data
      .map(toCharge)
      .reverse()
      .sort((a, b) => a.created - b.created);
  }

  async createSession(s: SessionInput): Promise<{ id: string; url: string }> {
    const cs = await this.stripe.checkout.sessions.create({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      wallet_options: { link: { display: "never" } },
      adaptive_pricing: { enabled: false },
      customer_email: s.email,
      line_items: s.lines.map((l) => ({ quantity: l.qty, price_data: { currency: "usd", unit_amount: l.unitCents, product_data: { name: l.name } } })),
      success_url: s.successUrl,
      cancel_url: s.cancelUrl,
      // On the session for the store, and on its PaymentIntent so Stripe's payment records carry the run too.
      metadata: s.metadata,
      payment_intent_data: { metadata: s.metadata, receipt_email: s.email, statement_descriptor_suffix: s.statementDescriptor },
    });
    if (!cs.url) throw new Error(`Stripe returned checkout session ${cs.id} without a URL`);
    return { id: cs.id, url: cs.url };
  }

  /** Stripe expires only an open session: anything else refused is read back — expired already (true) or complete (false). */
  async expireSession(id: string): Promise<boolean> {
    try {
      await orNotFound(id, this.stripe.checkout.sessions.expire(id));
      return true;
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
      const cs = await orNotFound(id, this.stripe.checkout.sessions.retrieve(id));
      if (cs.status === "expired") return true;
      if (cs.status === "complete") return false;
      throw err;
    }
  }

  /** With its PaymentIntent expanded: the attempts made on the page, in the same call. */
  async getSession(id: string): Promise<Session> {
    const cs = await orNotFound(id, this.stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent"] }));
    const pi = cs.payment_intent;
    return {
      id: cs.id,
      url: cs.url ?? "",
      paid: cs.payment_status === "paid",
      amountCents: cs.amount_total ?? 0,
      paymentIntentId: idOf(pi),
      metadata: { ...(cs.metadata ?? {}) },
      intent: pi && typeof pi === "object" ? toIntent(pi) : null,
    };
  }
}
