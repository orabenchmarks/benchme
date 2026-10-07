import { newCheckoutToken } from "../db/checkouts-repo.js";
import {
  MIN_CHARGE_CENTS,
  PaymentNotFoundError,
  type Charge,
  type Intent,
  type IntentInput,
  type PaymentGateway,
  type Session,
  type SessionInput,
} from "./gateway.js";

type StoredIntent = Intent & { clientSecret: string; methods: IntentInput["methods"]; email: string; statementDescriptor: string; charges: Charge[] };
type StoredSession = Omit<Session, "intent"> & {
  lines: SessionInput["lines"];
  email: string;
  successUrl: string;
  cancelUrl: string;
  statementDescriptor: string;
  expired: boolean;
};

/** What the store asked the fake for — a test hook, like settle(). A session also says whether it has expired. */
export type FakeRequest =
  | { kind: "intent"; methods: IntentInput["methods"]; email: string; amountCents: number; metadata: Record<string, string>; statementDescriptor: string }
  | {
      kind: "session";
      lines: SessionInput["lines"];
      email: string;
      successUrl: string;
      cancelUrl: string;
      amountCents: number;
      metadata: Record<string, string>;
      statementDescriptor: string;
      expired: boolean;
    };

/** How a card settles: it pays, it is declined, it needs 3-D Secure — and then the shopper completes it (succeed) or fails it. */
export type FakeOutcome = "succeed" | "decline" | "require_action" | "fail_authentication";

export type FakeGatewayOptions = {
  /** Where a hosted session's shopper pays. Default: a path under the site, "/fake-pay/session/<id>". */
  sessionUrl?: (id: string) => string;
};

const DECLINED = "Your card was declined.";
/** Stripe's message for a 3-D Secure step the shopper did not complete. */
export const AUTHENTICATION_FAILED = "We are unable to authenticate your payment method. Please choose a different payment method and try again.";
/** Stripe refuses to change the amount once a payment is under way or over. */
const AMOUNT_LOCKED: ReadonlySet<Intent["status"]> = new Set(["processing", "succeeded", "canceled"]);

/**
 * An id: Stripe's prefix, then a token minted as a checkout's is (24 characters of [0-9a-z] with a letter at every
 * sixth place). Ids and client secrets sit in URLs and rows a card-leak scan reads: no run of digits in one is long
 * enough to pass for a card number.
 */
const newId = (prefix: string) => `${prefix}_${newCheckoutToken()}`;
const secretOf = (id: string) => `${id}_secret_${newCheckoutToken()}`;
const copyIntent = (i: StoredIntent): Intent => ({
  id: i.id,
  status: i.status,
  amountCents: i.amountCents,
  metadata: { ...i.metadata },
  lastError: i.lastError,
  lastErrorCode: i.lastErrorCode,
  attemptMethod: i.attemptMethod,
  latestCharge: i.latestCharge,
});
const copyCharge = (c: Charge): Charge => ({ ...c, threeDSecure: c.threeDSecure ? { ...c.threeDSecure } : null });

function checkAmount(cents: number): void {
  if (!Number.isInteger(cents)) throw new Error(`amount must be a whole number of cents, got ${cents}`);
  if (cents < MIN_CHARGE_CENTS) throw new Error(`Amount must be at least $0.50 usd (got ${cents} cents)`);
}

/**
 * An in-process stand-in for Stripe test mode: intents and sessions live in memory
 * (lost on restart) and move only when a test — or the fake card page — settles them.
 * The state machine mirrors Stripe's for the cards the stores use: success, decline
 * (back to requires_payment_method with Stripe's message), and 3D Secure
 * (requires_action until a second settle succeeds, or fails the authentication).
 * Like Stripe it keeps a charge for every card that reached the network — a 3-D Secure
 * card only once the shopper completed the bank's step — each with the card (payment
 * method) it was made with, so a Stripe-mode test can read attempts back as Stripe has them.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly mode = "fake" as const;
  readonly publishableKey = "pk_test_fake";
  private readonly intents = new Map<string, StoredIntent>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly sessionUrl: (id: string) => string;

  constructor(opts: FakeGatewayOptions = {}) {
    this.sessionUrl = opts.sessionUrl ?? ((id) => `/fake-pay/session/${id}`);
  }

  async createIntent(i: IntentInput): Promise<{ id: string; clientSecret: string }> {
    checkAmount(i.amountCents);
    return this.newIntent(i.amountCents, i.metadata, [...i.methods], i.email, i.statementDescriptor);
  }

  async updateIntentAmount(id: string, amountCents: number): Promise<void> {
    const intent = this.intent(id);
    if (AMOUNT_LOCKED.has(intent.status)) throw new Error(`You cannot update this PaymentIntent because it has a status of ${intent.status}.`);
    checkAmount(amountCents);
    intent.amountCents = amountCents;
  }

  async getIntent(id: string): Promise<Intent> {
    return copyIntent(this.intent(id));
  }

  async charges(intentId: string): Promise<Charge[]> {
    return this.intent(intentId).charges.map(copyCharge);
  }

  async createSession(s: SessionInput): Promise<{ id: string; url: string }> {
    const amountCents = s.lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
    checkAmount(amountCents);
    const id = newId("cs_fake");
    const url = this.sessionUrl(id);
    this.sessions.set(id, {
      id,
      url,
      paid: false,
      amountCents,
      paymentIntentId: null,
      metadata: { ...s.metadata },
      lines: s.lines.map((l) => ({ ...l })),
      email: s.email,
      successUrl: s.successUrl,
      cancelUrl: s.cancelUrl,
      statementDescriptor: s.statementDescriptor,
      expired: false,
    });
    return { id, url };
  }

  async getSession(id: string): Promise<Session> {
    const s = this.session(id);
    const pi = s.paymentIntentId ? this.intents.get(s.paymentIntentId) : undefined;
    return { id: s.id, url: s.url, paid: s.paid, amountCents: s.amountCents, paymentIntentId: s.paymentIntentId, metadata: { ...s.metadata }, intent: pi ? copyIntent(pi) : null };
  }

  /** As Stripe: an open session expires (and stays expired); a paid one cannot. */
  async expireSession(id: string): Promise<boolean> {
    const s = this.session(id);
    if (s.paid) return false;
    s.expired = true;
    return true;
  }

  /**
   * Test hook: settle an intent as a card would — success, decline, or 3D Secure (a
   * later "succeed" completes it, "fail_authentication" fails it). A succeeded or canceled
   * intent cannot be confirmed again: refused, as Stripe refuses it, so a double-submitted
   * card form never un-pays an order. Each settle but the second step of 3-D Secure is a
   * new card (payment method); a card that reaches the network leaves a charge.
   */
  settle(id: string, outcome: FakeOutcome): void {
    const intent = this.intent(id);
    if (intent.status === "succeeded" || intent.status === "canceled") throw new Error(`This PaymentIntent's status is ${intent.status}, which means it can't be confirmed.`);
    const waiting = intent.status === "requires_action" ? intent.attemptMethod : null;
    if (outcome === "fail_authentication") {
      if (!waiting) throw new Error("There is no 3D Secure authentication waiting on this PaymentIntent.");
      Object.assign(intent, { status: "requires_payment_method", lastError: AUTHENTICATION_FAILED, lastErrorCode: "payment_intent_authentication_failure", attemptMethod: waiting });
      return;
    }
    if (outcome === "require_action") {
      Object.assign(intent, { status: "requires_action", lastError: null, lastErrorCode: null, attemptMethod: newId("pm_fake") });
      return;
    }
    // "succeed" after 3-D Secure completes the card that waited; anything else is a new card.
    const card = outcome === "succeed" && waiting ? waiting : newId("pm_fake");
    const charge: Charge = {
      id: newId("ch_fake"),
      status: outcome === "succeed" ? "succeeded" : "failed",
      paymentMethod: card,
      threeDSecure: outcome === "succeed" && waiting ? { flow: "challenge", result: "authenticated" } : null,
      created: Math.floor(Date.now() / 1000),
    };
    intent.charges.push(charge);
    intent.latestCharge = charge.id;
    if (outcome === "succeed") Object.assign(intent, { status: "succeeded", lastError: null, lastErrorCode: null, attemptMethod: null });
    else Object.assign(intent, { status: "requires_payment_method", lastError: DECLINED, lastErrorCode: "card_declined", attemptMethod: card });
  }

  /**
   * Test hook: a card on a hosted session's page. Its attempts are made on one PaymentIntent, created with the
   * first and carrying the session's metadata (as Stripe Checkout makes one); a card that pays pays the session.
   * Paying a paid session again keeps the one payment. An expired session is refused, as Stripe refuses it.
   */
  settleSession(id: string, outcome: FakeOutcome = "succeed"): void {
    const s = this.session(id);
    if (s.paid) return;
    if (s.expired) throw new Error(`Checkout Session ${id} has expired and can no longer be paid.`);
    const pi = s.paymentIntentId ?? this.newIntent(s.amountCents, s.metadata, ["card"], s.email, s.statementDescriptor).id;
    s.paymentIntentId = pi;
    this.settle(pi, outcome);
    if (this.intent(pi).status === "succeeded") s.paid = true;
  }

  /** Test hook: what the store asked for when it created this intent or session (methods, email, lines, URLs). */
  inspect(id: string): FakeRequest {
    const i = this.intents.get(id);
    if (i) return { kind: "intent", methods: [...i.methods], email: i.email, amountCents: i.amountCents, metadata: { ...i.metadata }, statementDescriptor: i.statementDescriptor };
    const s = this.session(id);
    return {
      kind: "session",
      lines: s.lines.map((l) => ({ ...l })),
      email: s.email,
      successUrl: s.successUrl,
      cancelUrl: s.cancelUrl,
      amountCents: s.amountCents,
      metadata: { ...s.metadata },
      statementDescriptor: s.statementDescriptor,
      expired: s.expired,
    };
  }

  private newIntent(amountCents: number, metadata: Record<string, string>, methods: IntentInput["methods"], email: string, statementDescriptor: string): { id: string; clientSecret: string } {
    const id = newId("pi_fake");
    const clientSecret = secretOf(id);
    this.intents.set(id, {
      id,
      status: "requires_payment_method",
      amountCents,
      metadata: { ...metadata },
      lastError: null,
      lastErrorCode: null,
      attemptMethod: null,
      latestCharge: null,
      clientSecret,
      methods,
      email,
      statementDescriptor,
      charges: [],
    });
    return { id, clientSecret };
  }

  private intent(id: string): StoredIntent {
    const i = this.intents.get(id);
    if (!i) throw new PaymentNotFoundError(id);
    return i;
  }

  private session(id: string): StoredSession {
    const s = this.sessions.get(id);
    if (!s) throw new PaymentNotFoundError(id);
    return s;
  }
}
