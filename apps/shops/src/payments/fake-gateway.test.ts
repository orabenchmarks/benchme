import { describe, expect, it } from "vitest";
import { FakePaymentGateway } from "./fake-gateway.js";
import { PaymentNotFoundError } from "./gateway.js";

const meta = { workspace: "ws_0123456789ab", store: "halden", scenario: "fixture-plain", checkout_token: "c0ffee" };
const intentInput = { amountCents: 6499, metadata: meta, methods: ["card"] as ("card" | "link")[], email: "buyer@example.com", statementDescriptor: "HALDEN AUDIO" };
/** A fresh intent as the fake reads it back: nothing tried yet. */
const untouched = { lastError: null, lastErrorCode: null, attemptMethod: null, latestCharge: null };

describe("FakePaymentGateway", () => {
  it("is test mode only, with a fake publishable key", () => {
    const g = new FakePaymentGateway();
    expect(g.mode).toBe("fake");
    expect(g.publishableKey).toBe("pk_test_fake");
  });

  it("mints ids and client secrets as checkout tokens are minted: never a run of digits a card-number scan could take for a card", async () => {
    const g = new FakePaymentGateway();
    const lines = [{ name: "Fixture item", unitCents: 4900, qty: 1 }];
    // 24 characters of [0-9a-z] with a letter at every sixth place: no run of digits longer than five.
    const TOKEN = "(?:[0-9a-z]{5}[a-z]){4}";
    for (let n = 0; n < 500; n++) {
      const i = await g.createIntent(intentInput);
      const s = await g.createSession({ lines, email: "b@example.com", successUrl: "s", cancelUrl: "c", metadata: meta, statementDescriptor: "HALDEN AUDIO" });
      g.settle(i.id, "decline");
      g.settleSession(s.id);
      const paid = (await g.getSession(s.id)).paymentIntentId as string;
      const charges = [...(await g.charges(i.id)), ...(await g.charges(paid))];
      expect(i.id).toMatch(new RegExp(`^pi_fake_${TOKEN}$`));
      expect(i.clientSecret).toMatch(new RegExp(`^${i.id}_secret_${TOKEN}$`));
      expect(s.id).toMatch(new RegExp(`^cs_fake_${TOKEN}$`));
      expect(paid).toMatch(new RegExp(`^pi_fake_${TOKEN}$`));
      expect(charges).toHaveLength(2);
      for (const c of charges) {
        expect(c.id).toMatch(new RegExp(`^ch_fake_${TOKEN}$`));
        expect(c.paymentMethod).toMatch(new RegExp(`^pm_fake_${TOKEN}$`));
      }
      for (const v of [i.id, i.clientSecret, s.id, paid, ...charges.flatMap((c) => [c.id, c.paymentMethod as string])]) expect(v).not.toMatch(/\d{6}/);
    }
  });

  it("creates an intent waiting for a payment method, with a client secret bound to it", async () => {
    const g = new FakePaymentGateway();
    const { id, clientSecret } = await g.createIntent(intentInput);
    expect(id).toMatch(/^pi_fake_[0-9a-z]{24}$/);
    expect(clientSecret.startsWith(`${id}_secret_`)).toBe(true);
    expect(await g.getIntent(id)).toEqual({ id, status: "requires_payment_method", amountCents: 6499, metadata: meta, ...untouched });
    expect(g.inspect(id)).toMatchObject({ methods: ["card"], email: "buyer@example.com", statementDescriptor: "HALDEN AUDIO" });
    expect(await g.charges(id)).toEqual([]);
  });

  it("succeeds, declines with Stripe's message, and needs authentication before succeeding", async () => {
    const g = new FakePaymentGateway();
    const ok = (await g.createIntent(intentInput)).id;
    g.settle(ok, "succeed");
    expect((await g.getIntent(ok)).status).toBe("succeeded");

    const declined = (await g.createIntent(intentInput)).id;
    g.settle(declined, "decline");
    expect(await g.getIntent(declined)).toMatchObject({ status: "requires_payment_method", lastError: "Your card was declined." });
    g.settle(declined, "succeed"); // a second card works and clears the error
    expect(await g.getIntent(declined)).toMatchObject({ status: "succeeded", lastError: null });

    const threeDs = (await g.createIntent(intentInput)).id;
    g.settle(threeDs, "require_action");
    expect((await g.getIntent(threeDs)).status).toBe("requires_action");
    g.settle(threeDs, "succeed");
    expect((await g.getIntent(threeDs)).status).toBe("succeeded");
  });

  it("records each card that reaches the network as a charge, as Stripe does: success, decline, and 3-D Secure (challenge then charge)", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent(intentInput);
    g.settle(id, "decline", "0002");
    const declined = await g.getIntent(id);
    expect(declined).toMatchObject({ status: "requires_payment_method", lastError: "Your card was declined.", lastErrorCode: "card_declined", attemptMethod: expect.stringMatching(/^pm_fake_/) });
    const [first] = await g.charges(id);
    expect(first).toEqual({ id: declined.latestCharge, status: "failed", captured: false, paymentMethod: declined.attemptMethod, threeDSecure: null, card: { last4: "0002", expMonth: null, expYear: null }, created: expect.any(Number) });

    // A 3-D Secure card: no charge until the shopper completes the bank's step, then one with the card that waited.
    g.settle(id, "require_action", "3184");
    const waiting = await g.getIntent(id);
    expect(waiting).toMatchObject({ status: "requires_action", lastError: null, lastErrorCode: null, latestCharge: first?.id });
    expect(waiting.attemptMethod).toMatch(/^pm_fake_/);
    expect(waiting.attemptMethod).not.toBe(declined.attemptMethod);
    expect(await g.charges(id)).toHaveLength(1);
    g.settle(id, "succeed");
    const charges = await g.charges(id);
    expect(charges.map((c) => [c.status, c.threeDSecure, c.card])).toEqual([
      ["failed", null, { last4: "0002", expMonth: null, expYear: null }],
      ["succeeded", { flow: "challenge", result: "authenticated" }, { last4: "3184", expMonth: null, expYear: null }], // the card that waited, not a new one
    ]);
    // A card settled without its number records none (null: what a store reads as "not a card").
    const bare = (await g.createIntent(intentInput)).id;
    g.settle(bare, "succeed");
    expect((await g.charges(bare))[0]?.card).toBeNull();
    expect(charges[1]?.paymentMethod).toBe(waiting.attemptMethod);
    expect(await g.getIntent(id)).toMatchObject({ status: "succeeded", lastErrorCode: null, attemptMethod: null, latestCharge: charges[1]?.id });
  });

  it("with manual capture, only authorizes a card that pays — its expiry on the charge — until capture takes it or cancel releases it", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent({ ...intentInput, captureMethod: "manual" });
    g.settle(id, "succeed", { last4: "4242", expMonth: 7, expYear: 2029 });
    expect((await g.getIntent(id)).status).toBe("requires_capture");
    expect(await g.charges(id)).toEqual([expect.objectContaining({ status: "succeeded", captured: false, card: { last4: "4242", expMonth: 7, expYear: 2029 } })]);
    expect(() => g.settle(id, "succeed", "4242")).toThrow(/requires_capture/); // authorized: not confirmed again
    await expect(g.updateIntentAmount(id, 7_000)).rejects.toThrow(/requires_capture/);
    expect((await g.capture(id)).status).toBe("succeeded");
    expect((await g.charges(id))[0]).toMatchObject({ captured: true });
    expect((await g.capture(id)).status).toBe("succeeded"); // taken already: it stands
    expect((await g.cancel(id)).status).toBe("succeeded"); // a taken payment is never released

    const other = (await g.createIntent({ ...intentInput, captureMethod: "manual" })).id;
    g.settle(other, "succeed", "4242");
    expect((await g.cancel(other)).status).toBe("canceled");
    expect((await g.charges(other))[0]).toMatchObject({ status: "succeeded", captured: false });
    await expect(g.capture(other)).rejects.toThrow(/canceled/);
  });

  it("with manual capture, completes a hosted session on an authorized payment — paid once taken, never expired meanwhile", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createSession({ lines: [{ name: "x", unitCents: 4_000, qty: 1 }], email: "b@example.com", successUrl: "/s", cancelUrl: "/c", metadata: {}, statementDescriptor: "X", captureMethod: "manual" });
    g.settleSession(id, "succeed", "4242");
    const s = await g.getSession(id);
    expect(s).toMatchObject({ paid: false, intent: { status: "requires_capture" } });
    expect(await g.expireSession(id)).toBe(false);
    await g.capture(s.paymentIntentId as string);
    expect((await g.getSession(id)).paid).toBe(true);
  });

  it("fails a 3-D Secure step the shopper did not complete without a charge, as Stripe does, and only while one is waiting", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent(intentInput);
    expect(() => g.settle(id, "fail_authentication")).toThrow(/authentication/);
    g.settle(id, "require_action");
    const waiting = (await g.getIntent(id)).attemptMethod;
    g.settle(id, "fail_authentication");
    expect(await g.getIntent(id)).toEqual({
      id,
      status: "requires_payment_method",
      amountCents: 6499,
      metadata: meta,
      lastError: "We are unable to authenticate your payment method. Please choose a different payment method and try again.",
      lastErrorCode: "payment_intent_authentication_failure",
      attemptMethod: waiting,
      latestCharge: null,
    });
    expect(await g.charges(id)).toEqual([]);
    g.settle(id, "succeed"); // another card, no 3-D Secure
    expect((await g.charges(id)).map((c) => [c.status, c.threeDSecure, c.paymentMethod === waiting])).toEqual([["succeeded", null, false]]);
  });

  it("makes a hosted session's attempts on one PaymentIntent, created with the first: a decline leaves the session open, then a card pays it", async () => {
    const g = new FakePaymentGateway();
    const s = await g.createSession({ lines: [{ name: "Fixture item", unitCents: 4900, qty: 1 }], email: "b@example.com", successUrl: "s", cancelUrl: "c", metadata: meta, statementDescriptor: "HALDEN AUDIO" });
    g.settleSession(s.id, "decline");
    const open = await g.getSession(s.id);
    expect(open).toMatchObject({ paid: false, paymentIntentId: expect.stringMatching(/^pi_fake_/), intent: { status: "requires_payment_method", amountCents: 4900, metadata: meta, lastErrorCode: "card_declined" } });
    g.settleSession(s.id, "require_action");
    expect((await g.getSession(s.id)).intent?.status).toBe("requires_action");
    g.settleSession(s.id);
    const paid = await g.getSession(s.id);
    expect(paid).toMatchObject({ paid: true, paymentIntentId: open.paymentIntentId, intent: { status: "succeeded" } });
    expect((await g.charges(paid.paymentIntentId as string)).map((c) => [c.status, c.threeDSecure?.result ?? null])).toEqual([
      ["failed", null],
      ["succeeded", "authenticated"],
    ]);
    g.settleSession(s.id); // paid already: the one payment stays
    expect(await g.charges(paid.paymentIntentId as string)).toHaveLength(2);
    await expect(g.charges("pi_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("refuses to settle a payment that already succeeded, as Stripe refuses to confirm it again", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent(intentInput);
    g.settle(id, "succeed");
    expect(() => g.settle(id, "decline")).toThrow(/succeeded/);
    expect(() => g.settle(id, "succeed")).toThrow(/succeeded/);
    expect(await g.getIntent(id)).toMatchObject({ status: "succeeded", lastError: null });
  });

  it("updates the amount of an unpaid intent, and refuses once it has succeeded", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent(intentInput);
    await g.updateIntentAmount(id, 7099);
    expect((await g.getIntent(id)).amountCents).toBe(7099);
    g.settle(id, "succeed");
    await expect(g.updateIntentAmount(id, 9999)).rejects.toThrow(/succeeded/);
    expect((await g.getIntent(id)).amountCents).toBe(7099);
  });

  it("refuses amounts Stripe refuses: below $0.50 or not whole cents", async () => {
    const g = new FakePaymentGateway();
    await expect(g.createIntent({ ...intentInput, amountCents: 49 })).rejects.toThrow(/at least/);
    await expect(g.createIntent({ ...intentInput, amountCents: 10.5 })).rejects.toThrow();
    const { id } = await g.createIntent(intentInput);
    await expect(g.updateIntentAmount(id, 0)).rejects.toThrow(/at least/);
  });

  it("starts a hosted session unpaid and settles it with a fresh succeeded intent carrying its metadata", async () => {
    const g = new FakePaymentGateway();
    const lines = [
      { name: "Fixture item", unitCents: 19900, qty: 1 },
      { name: "Sales tax", unitCents: 1443, qty: 1 },
    ];
    const s = await g.createSession({ lines, email: "buyer@example.com", successUrl: "https://shop.test/complete?session_id={CHECKOUT_SESSION_ID}", cancelUrl: "https://shop.test/payment", metadata: meta, statementDescriptor: "HALDEN AUDIO" });
    expect(s.id).toMatch(/^cs_fake_[0-9a-z]{24}$/);
    expect(s.url).toBe(`/fake-pay/session/${s.id}`);
    expect(await g.getSession(s.id)).toEqual({ id: s.id, url: s.url, paid: false, amountCents: 21343, paymentIntentId: null, metadata: meta, intent: null });
    expect(g.inspect(s.id)).toMatchObject({ kind: "session", statementDescriptor: "HALDEN AUDIO" });

    g.settleSession(s.id);
    const paid = await g.getSession(s.id);
    expect(paid.paid).toBe(true);
    expect(paid.paymentIntentId).toMatch(/^pi_fake_[0-9a-z]{24}$/);
    const [charge] = await g.charges(paid.paymentIntentId!);
    expect(await g.getIntent(paid.paymentIntentId!)).toEqual({ id: paid.paymentIntentId, status: "succeeded", amountCents: 21343, metadata: meta, ...untouched, latestCharge: charge?.id });
    expect(paid.intent).toEqual(await g.getIntent(paid.paymentIntentId!));
    g.settleSession(s.id); // settling twice keeps the one payment
    expect((await g.getSession(s.id)).paymentIntentId).toBe(paid.paymentIntentId);
  });

  it("expires an open session, which can no longer be paid, and refuses to expire a paid one", async () => {
    const g = new FakePaymentGateway();
    const lines = [{ name: "Fixture item", unitCents: 4900, qty: 1 }];
    const input = { lines, email: "buyer@example.com", successUrl: "s", cancelUrl: "c", metadata: meta, statementDescriptor: "HALDEN AUDIO" };
    const old = await g.createSession(input);
    expect(g.inspect(old.id)).toMatchObject({ kind: "session", expired: false });
    expect(await g.expireSession(old.id)).toBe(true);
    expect(g.inspect(old.id)).toMatchObject({ kind: "session", expired: true });
    expect(await g.expireSession(old.id)).toBe(true); // already expired: still expired
    expect(() => g.settleSession(old.id)).toThrow(/expired/);
    expect(await g.getSession(old.id)).toMatchObject({ paid: false, paymentIntentId: null });
    // A session paid a moment before: it stays paid, and the caller learns it went through.
    const paid = await g.createSession(input);
    g.settleSession(paid.id);
    expect(await g.expireSession(paid.id)).toBe(false);
    expect(await g.getSession(paid.id)).toMatchObject({ paid: true });
    await expect(g.expireSession("cs_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("builds the session URL the store asks for", async () => {
    const g = new FakePaymentGateway({ sessionUrl: (id) => `/w/ws_0123456789ab/halden/fake-pay/session/${id}` });
    const s = await g.createSession({ lines: [{ name: "Fixture accessory", unitCents: 2900, qty: 1 }], email: "b@example.com", successUrl: "s", cancelUrl: "c", metadata: {}, statementDescriptor: "HALDEN AUDIO" });
    expect(s.url).toBe(`/w/ws_0123456789ab/halden/fake-pay/session/${s.id}`);
  });

  it("answers an unknown id as not found, like Stripe's resource_missing", async () => {
    const g = new FakePaymentGateway();
    await expect(g.getIntent("pi_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
    await expect(g.getSession("cs_nope")).rejects.toBeInstanceOf(PaymentNotFoundError);
    await expect(g.updateIntentAmount("pi_nope", 100)).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(() => g.settle("pi_nope", "succeed")).toThrow(PaymentNotFoundError);
    expect(() => g.settleSession("cs_nope")).toThrow(PaymentNotFoundError);
  });

  it("returns copies, so a caller cannot change a stored intent", async () => {
    const g = new FakePaymentGateway();
    const { id } = await g.createIntent(intentInput);
    (await g.getIntent(id)).metadata.workspace = "ws_tampered0000";
    expect((await g.getIntent(id)).metadata.workspace).toBe(meta.workspace);
  });
});
