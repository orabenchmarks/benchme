/**
 * The payment processor behind every store: Stripe in test mode (StripePaymentGateway)
 * or an in-process fake for tests and local stacks (FakePaymentGateway). Amounts are
 * integer US cents. Metadata is how a caller proves an intent or session belongs to
 * its own workspace and checkout before it trusts the payment — never skip that check.
 */
/**
 * `requires_capture`: the card was authorized and the funds are held, but the store has not taken them yet — it asks
 * the shopper's wallet first (routes/authorization.ts), then captures the payment or cancels it as a decline.
 */
export type IntentStatus = "requires_payment_method" | "requires_confirmation" | "requires_action" | "requires_capture" | "processing" | "succeeded" | "canceled";

/** When the processor takes a confirmed payment: at once (automatic), or when the store captures it (manual). */
export type CaptureMethod = "automatic" | "manual";

/** What the stores may request: a card, plus Link on the Express Checkout surface. */
export type PaymentMethodType = "card" | "link";

export type Intent = {
  id: string;
  status: IntentStatus;
  amountCents: number;
  metadata: Record<string, string>;
  /** The processor's message for the last failed attempt ("Your card was declined."), shown to the shopper. */
  lastError: string | null;
  /** The processor's code for it ("card_declined", "payment_intent_authentication_failure"), or null. */
  lastErrorCode: string | null;
  /**
   * The card (payment method) of the attempt under way or just failed: the one waiting for 3-D Secure
   * (requires_action), else the one of the last failed attempt; null otherwise. Every card submitted is a
   * payment method of its own, so it names one attempt even before (or without) a charge.
   */
  attemptMethod: string | null;
  /** The newest charge, or null before any card reached the network. */
  latestCharge: string | null;
};

/** One card submission that reached the card network (Stripe's Charge), as the processor recorded it. */
export type Charge = {
  id: string;
  /** "succeeded": authorized — and taken once `captured` (a manual-capture payment's charge is held until then). */
  status: "succeeded" | "failed" | "pending";
  captured: boolean;
  /** The card it was made with: one payment method per submission. */
  paymentMethod: string | null;
  /** 3-D Secure on it in the processor's words (flow "challenge" | "frictionless", result "authenticated" | "failed" | …), or null without. */
  threeDSecure: { flow: string | null; result: string | null } | null;
  /**
   * The card it was made with as the processor recorded it — its last four digits and its expiry, all a store ever reads
   * of a card (which card the shopper's wallet issued it is) — or null for a payment made without a card (a wallet
   * button such as Link). The expiry is null when the processor did not record one.
   */
  card: PaidCard | null;
  /** When it was made (Unix seconds). */
  created: number;
};

/** A card as the processor recorded it on a charge: its last four and its expiry (null: not recorded). */
export type PaidCard = { last4: string; expMonth: number | null; expYear: number | null };

export type Session = {
  id: string;
  /** Where the shopper pays; empty once Stripe has completed the session. */
  url: string;
  /** The payment was taken (captured). A completed session whose payment is only authorized is not paid yet: see `intent`. */
  paid: boolean;
  amountCents: number;
  paymentIntentId: string | null;
  metadata: Record<string, string>;
  /** The PaymentIntent the page's card attempts were made on, as it stands (the processor makes it with the first attempt), or null. */
  intent: Intent | null;
};

/**
 * `statementDescriptor`: what the buyer's card statement names the payment by: the store's short name (Stripe's
 * statement_descriptor_suffix, joined to the account's prefix). See descriptor.ts.
 */
export type IntentInput = { amountCents: number; metadata: Record<string, string>; methods: PaymentMethodType[]; email: string; statementDescriptor: string; captureMethod?: CaptureMethod };
export type SessionLine = { name: string; unitCents: number; qty: number };
export type SessionInput = { lines: SessionLine[]; email: string; successUrl: string; cancelUrl: string; metadata: Record<string, string>; statementDescriptor: string; captureMethod?: CaptureMethod };

export interface PaymentGateway {
  readonly mode: "stripe" | "fake";
  /** For Stripe.js on the payment page; "pk_test_fake" in fake mode. */
  readonly publishableKey: string;
  createIntent(i: IntentInput): Promise<{ id: string; clientSecret: string }>;
  updateIntentAmount(id: string, amountCents: number): Promise<void>;
  getIntent(id: string): Promise<Intent>;
  /** An intent's charges, oldest first: every card of it that reached the network (attempts.ts reads them as attempts). */
  charges(intentId: string): Promise<Charge[]>;
  /** A hosted Checkout Session (the Halden default surface). */
  createSession(s: SessionInput): Promise<{ id: string; url: string }>;
  getSession(id: string): Promise<Session>;
  /**
   * Expires an open session so it can no longer be paid (a newer one of its checkout replaces it).
   * True once it is expired (or was already); false when it cannot be, because it completed — it was
   * paid a moment before, and the caller records that payment instead.
   */
  expireSession(id: string): Promise<boolean>;
  /** Takes an authorized payment (requires_capture → succeeded); one already taken is answered as it stands. */
  capture(intentId: string): Promise<Intent>;
  /** Releases an authorized payment the store will not take (→ canceled); one already canceled is answered as it stands. */
  cancel(intentId: string): Promise<Intent>;
}

/** No intent or session with that id (a stale or forged id in a return URL): answer 404, never 500. */
export class PaymentNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no payment ${id}`);
    this.name = "PaymentNotFoundError";
  }
}

/** Stripe's minimum charge in USD: refused there, so refused by the fake too. */
export const MIN_CHARGE_CENTS = 50;
