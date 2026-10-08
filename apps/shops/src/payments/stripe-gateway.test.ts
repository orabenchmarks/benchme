import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { PaymentNotFoundError } from "./gateway.js";
import { STRIPE_MAX_NETWORK_RETRIES, STRIPE_TIMEOUT_MS, StripePaymentGateway } from "./stripe-gateway.js";

const meta = { workspace: "ws_0123456789ab", store: "halden", scenario: "fixture-plain", checkout_token: "c0ffee" };

type Call = { method: string; path: string; params: URLSearchParams };
type Reply = { status?: number; body: unknown };

/**
 * The real Stripe SDK over a recording fetch: proves what the gateway sends and
 * how it reads Stripe's answers, without a network or a key.
 */
function offline(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const call = { method: init?.method ?? "GET", path: u.pathname, params: new URLSearchParams(typeof init?.body === "string" ? init.body : u.search) };
    calls.push(call);
    const r = reply(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", "request-id": "req_offline" } });
  };
  const gateway = new StripePaymentGateway("sk_test_offline", "pk_test_offline", { httpClient: Stripe.createFetchHttpClient(fetchFn), maxNetworkRetries: 0, telemetry: false });
  return { gateway, calls };
}

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return "";
};

describe("StripePaymentGateway (offline)", () => {
  it("accepts only test-mode keys, and never echoes a refused key", () => {
    expect(messageOf(() => new StripePaymentGateway("sk_live_51abcdef", "pk_test_x"))).toMatch(/test/);
    expect(messageOf(() => new StripePaymentGateway("rk_live_51abcdef", "pk_test_x"))).toMatch(/test/);
    expect(messageOf(() => new StripePaymentGateway("rk_test_51abcdef", "pk_test_x"))).toMatch(/sk_test_/);
    expect(messageOf(() => new StripePaymentGateway("", "pk_test_x"))).toMatch(/sk_test_/);
    expect(messageOf(() => new StripePaymentGateway("sk_test_x", "pk_live_51abcdef"))).toMatch(/pk_test_/);
    for (const key of ["sk_live_51abcdef", "rk_live_51abcdef", "pk_live_51abcdef"]) {
      expect(messageOf(() => new StripePaymentGateway(key, key))).not.toContain(key);
    }
    const g = new StripePaymentGateway("sk_test_x", "pk_test_y");
    expect(g.mode).toBe("stripe");
    expect(g.publishableKey).toBe("pk_test_y");
  });

  it("creates a USD intent restricted to the requested methods, with the buyer's receipt email, the store's statement descriptor and the run's metadata", async () => {
    const { gateway, calls } = offline(() => ({ body: { id: "pi_123", object: "payment_intent", client_secret: "pi_123_secret_456", amount: 6499, currency: "usd", status: "requires_payment_method", metadata: meta } }));
    expect(await gateway.createIntent({ amountCents: 6499, metadata: meta, methods: ["card", "link"], email: "buyer@example.com", statementDescriptor: "HALDEN AUDIO" })).toEqual({ id: "pi_123", clientSecret: "pi_123_secret_456" });
    expect(calls).toHaveLength(1);
    const { method, path, params } = calls[0]!;
    expect([method, path]).toEqual(["POST", "/v1/payment_intents"]);
    expect(Object.fromEntries(params)).toEqual({
      amount: "6499",
      currency: "usd",
      "allowed_payment_method_types[0]": "card",
      "allowed_payment_method_types[1]": "link",
      receipt_email: "buyer@example.com",
      statement_descriptor_suffix: "HALDEN AUDIO",
      "metadata[workspace]": meta.workspace,
      "metadata[store]": meta.store,
      "metadata[scenario]": meta.scenario,
      "metadata[checkout_token]": meta.checkout_token,
    });
  });

  it("calls Stripe with a short timeout and at most one network retry, whatever the caller asks for", async () => {
    expect(STRIPE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(STRIPE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(STRIPE_MAX_NETWORK_RETRIES).toBe(1);
    const plain = new StripePaymentGateway("sk_test_x", "pk_test_y");
    expect([plain.timeoutMs, plain.maxNetworkRetries]).toEqual([STRIPE_TIMEOUT_MS, 1]);
    const asked = new StripePaymentGateway("sk_test_x", "pk_test_y", { timeout: 80_000, maxNetworkRetries: 5 });
    expect([asked.timeoutMs, asked.maxNetworkRetries]).toEqual([15_000, 1]);

    // A network that never answers: the request is abandoned at the timeout and tried once more, then fails.
    let tries = 0;
    const hang = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_ok, ko) => {
        tries++;
        init?.signal?.addEventListener("abort", () => ko(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const slow = new StripePaymentGateway("sk_test_x", "pk_test_y", { httpClient: Stripe.createFetchHttpClient(hang), timeout: 40, maxNetworkRetries: 5, telemetry: false });
    const t0 = Date.now();
    const err = await slow.getIntent("pi_123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stripe.errors.StripeConnectionError);
    expect(tries).toBe(2);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("updates only an intent's amount", async () => {
    const { gateway, calls } = offline(() => ({ body: { id: "pi_123", object: "payment_intent", amount: 7099, status: "requires_payment_method", metadata: meta } }));
    await gateway.updateIntentAmount("pi_123", 7099);
    expect([calls[0]!.method, calls[0]!.path]).toEqual(["POST", "/v1/payment_intents/pi_123"]);
    expect(Object.fromEntries(calls[0]!.params)).toEqual({ amount: "7099" });
  });

  it("reads an intent's status, amount, metadata, the last card error, the card of the attempt under way and its latest charge", async () => {
    let body: Record<string, unknown> = {};
    const { gateway, calls } = offline(() => ({ body }));
    body = {
      id: "pi_123",
      object: "payment_intent",
      amount: 6499,
      status: "requires_payment_method",
      metadata: meta,
      payment_method: null,
      latest_charge: "ch_1",
      last_payment_error: { type: "card_error", code: "card_declined", message: "Your card was declined.", payment_method: { id: "pm_8", object: "payment_method" } },
    };
    expect(await gateway.getIntent("pi_123")).toEqual({
      id: "pi_123",
      status: "requires_payment_method",
      amountCents: 6499,
      metadata: meta,
      lastError: "Your card was declined.",
      lastErrorCode: "card_declined",
      attemptMethod: "pm_8",
      latestCharge: "ch_1",
    });
    expect([calls[0]!.method, calls[0]!.path]).toEqual(["GET", "/v1/payment_intents/pi_123"]);

    // Waiting for 3-D Secure: the card awaiting it; a latest charge may come back expanded.
    body = { id: "pi_123", object: "payment_intent", amount: 6499, status: "requires_action", metadata: meta, payment_method: "pm_9", latest_charge: { id: "ch_0", object: "charge" }, last_payment_error: null };
    expect(await gateway.getIntent("pi_123")).toMatchObject({ status: "requires_action", lastError: null, lastErrorCode: null, attemptMethod: "pm_9", latestCharge: "ch_0" });

    body = { id: "pi_123", object: "payment_intent", amount: 6499, status: "succeeded", metadata: meta, payment_method: "pm_9", latest_charge: "ch_2", last_payment_error: null };
    expect(await gateway.getIntent("pi_123")).toMatchObject({ status: "succeeded", lastError: null, attemptMethod: null, latestCharge: "ch_2" });
    // Never treated as paid: an uncaptured authorisation, or a status this code does not know.
    body = { ...body, status: "requires_capture" };
    expect((await gateway.getIntent("pi_123")).status).toBe("processing");
    body = { ...body, status: "some_future_status" };
    expect((await gateway.getIntent("pi_123")).status).toBe("processing");
  });

  it("creates a hosted session that takes cards only, in US dollars, with the cart's lines, the buyer's email, the return URLs, the store's statement descriptor and the metadata on the session and its payment", async () => {
    const { gateway, calls } = offline(() => ({ body: { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1", payment_status: "unpaid", amount_total: 21343, payment_intent: null, metadata: meta } }));
    const s = await gateway.createSession({
      lines: [
        { name: "Fixture item — Large", unitCents: 19900, qty: 1 },
        { name: "Sales tax", unitCents: 1443, qty: 1 },
      ],
      email: "buyer@example.com",
      successUrl: "https://gw.test/w/ws_0123456789ab/halden/checkout/c0ffee/complete?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://gw.test/w/ws_0123456789ab/halden/checkout/c0ffee/payment",
      metadata: meta,
      statementDescriptor: "HALDEN AUDIO",
    });
    expect(s).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const { method, path, params } = calls[0]!;
    expect([method, path]).toEqual(["POST", "/v1/checkout/sessions"]);
    expect(Object.fromEntries(params)).toEqual({
      mode: "payment",
      "allowed_payment_method_types[0]": "card",
      // No Link on the page (it offered a bank account and Klarna beside the card), and no other currency first.
      "wallet_options[link][display]": "never",
      "adaptive_pricing[enabled]": "false",
      customer_email: "buyer@example.com",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "19900",
      "line_items[0][price_data][product_data][name]": "Fixture item — Large",
      "line_items[1][quantity]": "1",
      "line_items[1][price_data][currency]": "usd",
      "line_items[1][price_data][unit_amount]": "1443",
      "line_items[1][price_data][product_data][name]": "Sales tax",
      success_url: "https://gw.test/w/ws_0123456789ab/halden/checkout/c0ffee/complete?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://gw.test/w/ws_0123456789ab/halden/checkout/c0ffee/payment",
      "metadata[workspace]": meta.workspace,
      "metadata[store]": meta.store,
      "metadata[scenario]": meta.scenario,
      "metadata[checkout_token]": meta.checkout_token,
      "payment_intent_data[metadata][workspace]": meta.workspace,
      "payment_intent_data[metadata][store]": meta.store,
      "payment_intent_data[metadata][scenario]": meta.scenario,
      "payment_intent_data[metadata][checkout_token]": meta.checkout_token,
      "payment_intent_data[receipt_email]": "buyer@example.com",
      "payment_intent_data[statement_descriptor_suffix]": "HALDEN AUDIO",
    });
  });

  it("reads a session as paid only when Stripe says so, with its payment intent (expanded: the attempts made on the page)", async () => {
    let body: Record<string, unknown> = {};
    const { gateway, calls } = offline(() => ({ body }));
    body = { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1", payment_status: "unpaid", amount_total: 21343, payment_intent: null, metadata: meta };
    expect(await gateway.getSession("cs_test_1")).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", paid: false, amountCents: 21343, paymentIntentId: null, metadata: meta, intent: null });
    expect([calls[0]!.method, calls[0]!.path]).toEqual(["GET", "/v1/checkout/sessions/cs_test_1"]);
    expect(calls[0]!.params.getAll("expand[]").concat(calls[0]!.params.getAll("expand[0]"))).toEqual(["payment_intent"]);

    // A card declined on the page: the session is still open, its PaymentIntent holds the attempt.
    const declined = {
      id: "pi_9",
      object: "payment_intent",
      amount: 21343,
      status: "requires_payment_method",
      metadata: meta,
      payment_method: null,
      latest_charge: "ch_7",
      last_payment_error: { code: "card_declined", message: "Your card was declined.", payment_method: { id: "pm_7", object: "payment_method" } },
    };
    body = { ...body, payment_intent: declined };
    expect(await gateway.getSession("cs_test_1")).toMatchObject({
      paid: false,
      paymentIntentId: "pi_9",
      intent: { id: "pi_9", status: "requires_payment_method", amountCents: 21343, lastErrorCode: "card_declined", attemptMethod: "pm_7", latestCharge: "ch_7" },
    });

    // A completed session has no URL any more; its payment may come back as an id or an expanded object.
    body = { ...body, url: null, payment_status: "paid", payment_intent: "pi_9" };
    expect(await gateway.getSession("cs_test_1")).toMatchObject({ url: "", paid: true, paymentIntentId: "pi_9", intent: null });
    body = { ...body, payment_intent: { ...declined, status: "succeeded", latest_charge: "ch_8", last_payment_error: null } };
    expect(await gateway.getSession("cs_test_1")).toMatchObject({ paymentIntentId: "pi_9", intent: { status: "succeeded", latestCharge: "ch_8" } });
    body = { ...body, payment_status: "no_payment_required" };
    expect((await gateway.getSession("cs_test_1")).paid).toBe(false);
  });

  it("lists an intent's charges oldest first: status, the card, and 3-D Secure as Stripe recorded it", async () => {
    const charge = (id: string, created: number, o: Record<string, unknown> = {}) => ({
      id,
      object: "charge",
      created,
      status: "succeeded",
      payment_method: `pm_${id}`,
      payment_method_details: { type: "card", card: { brand: "visa", last4: "0002", three_d_secure: null } },
      ...o,
    });
    const { gateway, calls } = offline((call) =>
      call.path === "/v1/charges"
        ? {
            body: {
              object: "list",
              has_more: false,
              url: "/v1/charges",
              // Stripe lists the newest first.
              data: [
                charge("c3", 300, { payment_method_details: { type: "card", card: { last4: "3184", three_d_secure: { authentication_flow: "challenge", result: "authenticated", version: "2.2.0" } } } }),
                charge("c2", 200, { status: "pending", payment_method_details: { type: "link", link: { country: "US" } } }),
                charge("c1", 100, { status: "failed", failure_code: "card_declined" }),
              ],
            },
          }
        : { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such payment_intent: 'pi_nope'" } } },
    );
    expect(await gateway.charges("pi_123")).toEqual([
      { id: "c1", status: "failed", paymentMethod: "pm_c1", threeDSecure: null, card: { last4: "0002" }, created: 100 },
      { id: "c2", status: "pending", paymentMethod: "pm_c2", threeDSecure: null, card: null, created: 200 }, // Link: no card
      { id: "c3", status: "succeeded", paymentMethod: "pm_c3", threeDSecure: { flow: "challenge", result: "authenticated" }, card: { last4: "3184" }, created: 300 },
    ]);
    expect([calls[0]!.method, calls[0]!.path, calls[0]!.params.get("payment_intent"), calls[0]!.params.get("limit")]).toEqual(["GET", "/v1/charges", "pi_123", "100"]);
  });

  it("expires an open session; one Stripe will not expire is read back: expired already, or completed (paid)", async () => {
    let state = "open";
    const { gateway, calls } = offline((call) => {
      const session = { id: "cs_test_1", object: "checkout.session", url: null, payment_status: state === "complete" ? "paid" : "unpaid", amount_total: 4900, payment_intent: null, metadata: meta };
      if (call.method === "POST" && call.path === "/v1/checkout/sessions/cs_test_1/expire") {
        if (state !== "open") {
          return { status: 400, body: { error: { type: "invalid_request_error", message: `Only Checkout Sessions with a status in ["open"] can be expired. This Checkout Session has a status of "${state}".` } } };
        }
        state = "expired";
        return { body: { ...session, status: "expired" } };
      }
      if (call.method === "GET" && call.path === "/v1/checkout/sessions/cs_test_1") return { body: { ...session, status: state } };
      if (call.path.includes("cs_nope")) return { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such checkout.session: 'cs_nope'" } } };
      return { status: 500, body: { error: { type: "api_error", message: "unexpected call" } } };
    });
    expect(await gateway.expireSession("cs_test_1")).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v1/checkout/sessions/cs_test_1/expire"]);
    expect(await gateway.expireSession("cs_test_1")).toBe(true); // already expired
    state = "complete";
    expect(await gateway.expireSession("cs_test_1")).toBe(false); // paid a moment before
    expect(calls.slice(1).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/checkout/sessions/cs_test_1/expire",
      "GET /v1/checkout/sessions/cs_test_1",
      "POST /v1/checkout/sessions/cs_test_1/expire",
      "GET /v1/checkout/sessions/cs_test_1",
    ]);
    await expect(gateway.expireSession("cs_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("answers Stripe's resource_missing as not found and passes every other error through", async () => {
    let status = 404;
    const { gateway } = offline(() => ({
      status,
      body: { error: status === 404 ? { type: "invalid_request_error", code: "resource_missing", message: "No such payment_intent: 'pi_nope'", param: "intent" } : { type: "invalid_request_error", message: "Invalid API Key provided" } },
    }));
    await expect(gateway.getIntent("pi_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
    await expect(gateway.getSession("cs_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
    await expect(gateway.updateIntentAmount("pi_nope", 100)).rejects.toBeInstanceOf(PaymentNotFoundError);
    status = 401;
    const err = await gateway.getIntent("pi_123").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PaymentNotFoundError);
    expect(err).toBeInstanceOf(Stripe.errors.StripeAuthenticationError);
  });
});

/** Runs only against a real Stripe account in test mode (STRIPE_SECRET_KEY=sk_test_…); skipped otherwise. */
const KEY = process.env.STRIPE_SECRET_KEY ?? "";
describe.skipIf(!KEY.startsWith("sk_test_"))("StripePaymentGateway (Stripe test mode)", () => {
  const gateway = () => new StripePaymentGateway(KEY, process.env.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_") ? process.env.STRIPE_PUBLISHABLE_KEY : "pk_test_contract");
  const contractMeta = { ...meta, scenario: "fixture-contract" };

  it("creates a $1.00 intent named for the store, confirms it server-side with a test card, and reads it and its charge succeeded", async () => {
    const g = gateway();
    const { id, clientSecret } = await g.createIntent({ amountCents: 100, metadata: contractMeta, methods: ["card"], email: "buyer@example.com", statementDescriptor: "HALDEN AUDIO" });
    expect(clientSecret.startsWith(id)).toBe(true);
    expect((await g.getIntent(id)).status).toBe("requires_payment_method");
    expect(await g.charges(id)).toEqual([]);
    const stripe = new Stripe(KEY);
    await stripe.paymentIntents.confirm(id, { payment_method: "pm_card_visa" });
    const paid = await g.getIntent(id);
    expect(paid).toMatchObject({ id, status: "succeeded", amountCents: 100, metadata: contractMeta, lastError: null, lastErrorCode: null, attemptMethod: null });
    const charges = await g.charges(id);
    expect(charges).toEqual([{ id: paid.latestCharge, status: "succeeded", paymentMethod: expect.stringMatching(/^pm_/), threeDSecure: null, card: { last4: "4242" }, created: expect.any(Number) }]); // the card's last four, as the store reads it to ask the wallet
    expect((await stripe.paymentIntents.retrieve(id)).statement_descriptor_suffix).toBe("HALDEN AUDIO");
  });

  it("reads a declined card as a failed charge, then the card that paid", async () => {
    const g = gateway();
    const { id } = await g.createIntent({ amountCents: 100, metadata: contractMeta, methods: ["card"], email: "buyer@example.com", statementDescriptor: "QUILLFEATHER" });
    const stripe = new Stripe(KEY);
    await stripe.paymentIntents.confirm(id, { payment_method: "pm_card_chargeDeclined" }).catch(() => undefined);
    const declined = await g.getIntent(id);
    expect(declined).toMatchObject({ status: "requires_payment_method", lastErrorCode: "card_declined", attemptMethod: expect.stringMatching(/^pm_/) });
    await stripe.paymentIntents.confirm(id, { payment_method: "pm_card_visa" });
    const charges = await g.charges(id);
    expect(charges.map((c) => [c.status, c.paymentMethod === declined.attemptMethod])).toEqual([
      ["failed", true],
      ["succeeded", false],
    ]);
  });

  it("creates a hosted session and reads it unpaid", async () => {
    const g = gateway();
    const s = await g.createSession({ lines: [{ name: "Contract test item", unitCents: 100, qty: 1 }], email: "buyer@example.com", successUrl: "https://example.com/complete?session_id={CHECKOUT_SESSION_ID}", cancelUrl: "https://example.com/payment", metadata: contractMeta, statementDescriptor: "HALDEN AUDIO" });
    expect(s.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(await g.getSession(s.id)).toMatchObject({ id: s.id, paid: false, amountCents: 100, paymentIntentId: null, metadata: contractMeta, intent: null });
    // Cards only, in dollars: Link is off the page and Adaptive Pricing is off for the session.
    const cs = await new Stripe(KEY).checkout.sessions.retrieve(s.id);
    expect(cs.wallet_options?.link?.display).toBe("never");
    expect(cs.adaptive_pricing?.enabled).toBe(false);
    expect(cs.currency).toBe("usd");
    // Superseded by a newer session of its checkout: expired, and expiring it again is not an error.
    expect(await g.expireSession(s.id)).toBe(true);
    expect(await g.expireSession(s.id)).toBe(true);
    expect((await g.getSession(s.id)).paid).toBe(false);
  });
});
