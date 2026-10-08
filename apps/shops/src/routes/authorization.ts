import type { FastifyRequest } from "fastify";
import type { Intent, PaidCard } from "../payments/gateway.js";
import type { SpendVerdict } from "../payments/spend-control.js";
import type { RouteDeps } from "./index.js";

/** Where a payment's attempts are logged: its workspace, store and checkout, and the store's payment (an intent, or a session). */
export type AttemptsAt = { ws: string; site: string; token: string; ref: string };

/** What the shopper is told when the wallet declines the card: an issuer's decline, word for word (Stripe's card_declined). */
export const CARD_DECLINED = "Your card was declined.";

/** A payment that was authorized, after the store's decision: taken (the intent succeeded), or declined and released. */
export type Taken = { taken: true; intent: Intent } | { taken: false; intent: Intent; message: string };

/**
 * Takes a payment the processor authorized (requires_capture: every payment is confirmed with manual capture, so its
 * funds are held, not taken) — after asking the shopper's wallet whether the card may pay this much (Link's spend
 * controls, payments/spend-control.ts). A spend request's card used above its approval, or a second time, is declined:
 * the decline is recorded as the card's failed attempt (payment_attempt, result "declined", reason above_approval |
 * reused), the authorization is released, and the shopper is told what an issuer's decline says, on the surface it
 * paid on. Any other card is taken. A wallet that cannot be asked does not stop the payment: it is taken, and an
 * event (spend_control_unknown) records the infrastructure failure — the only way a spend request's card is ever
 * charged above its approval (paid_above_approval). Every reading of the payment comes to the same answer: the wallet
 * answers one payment the same way twice, and the processor refuses to take a released payment or release a taken
 * one, which is then read back as it stands.
 */
export async function takeAuthorized(req: FastifyRequest, deps: RouteDeps, at: AttemptsAt, intent: Intent): Promise<Taken> {
  const held = (await deps.payments.charges(intent.id)).filter((c) => c.status === "succeeded" && !c.captured).at(-1) ?? null;
  const verdict: SpendVerdict = held?.card ? await askWallet(req, deps, at, intent, held.card) : { decision: "accept" };
  if (verdict.decision === "decline") {
    if (held) await deps.repos.events.recordAttempts(at.ws, at.site, { token: at.token, ref: at.ref }, [{ attempt: held.id, result: "declined", reason: verdict.reason }]);
    const released = await deps.payments.cancel(intent.id);
    if (released.status === "succeeded") return { taken: true, intent: released };
    // Released, it can never go through: no longer one of the store's open payments for the reconcile step to read.
    await deps.repos.payments.markExpired(at.ws, at.ref);
    return { taken: false, intent: released, message: CARD_DECLINED };
  }
  const taken = await deps.payments.capture(intent.id);
  if (taken.status !== "succeeded") return { taken: false, intent: taken, message: CARD_DECLINED };
  // Fake mode has no processor record to read attempts back from (Stripe mode logs them from its charges): the card
  // that paid is logged here, in fake mode's words — once, by the charge.
  if (deps.payments.mode === "fake" && held) {
    await deps.repos.events.recordAttempts(at.ws, at.site, { token: at.token, ref: at.ref }, [{ attempt: held.id, result: held.threeDSecure?.flow === "challenge" ? "authenticated" : "succeeded" }]);
  }
  return { taken: true, intent: taken };
}

/** The wallet's verdict on the card; when it cannot be asked, the payment is taken and the failure recorded (infrastructure). */
async function askWallet(req: FastifyRequest, deps: RouteDeps, at: AttemptsAt, intent: Intent, card: PaidCard): Promise<SpendVerdict> {
  try {
    return await deps.spendControl.check(at.ws, at.site, { payment: intent.id, amountCents: intent.amountCents, card });
  } catch (err) {
    req.log.warn({ err: (err as Error).message, payment: intent.id }, "the wallet's spend controls could not be asked: the payment is taken");
    await deps.repos.events.record(at.ws, at.site, "spend_control_unknown", { token: at.token, ref: at.ref, payment: intent.id, error: (err as Error).message });
    return { decision: "accept" };
  }
}
