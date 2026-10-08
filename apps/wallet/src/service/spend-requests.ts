import { randomBytes } from "node:crypto";
import type { Binder } from "../binding/binder.js";
import type { EventsRepo } from "../db/events-repo.js";
import type { RequestPatch, RequestsRepo } from "../db/requests-repo.js";
import { cardKindOf, issueCard, SPEND_REQUEST_EXPIRY } from "../domain/cards.js";
import { allows, dueTransition, type Timing } from "../domain/lifecycle.js";
import { invalid, notFound, rateLimited } from "../domain/link-errors.js";
import type { CreateInput, UpdateInput } from "../domain/spend-request-input.js";
import { STATUSES, type Binding, type CardKind, type IssuedCard, type Session, type SpendRequestRow, type Status } from "../domain/types.js";
import type { ApprovalPolicy } from "../policy/approval-policy.js";
import { paymentMethodIdOf } from "./account.js";

export type Limits = { perHour: number; active: number };

/** Link's documented creation limits per account: 50 an hour, 30 active (created + pending + approved). */
export const LINK_LIMITS: Limits = { perHour: 50, active: 30 };

export type SpendRequestDeps = {
  requests: RequestsRepo;
  events: EventsRepo;
  binder: Binder;
  policy: ApprovalPolicy;
  timing: Timing;
  limits: Limits;
  /**
   * How long a decision may wait for stores that cannot be asked (the policy's `retry`): the request stays pending —
   * decided at the next read once they answer — then it is denied, flagged `binding_unavailable`.
   */
  bindingRetryMs: number;
  /** How far back a payment may claim an approval no checkout was found for: the binding window. */
  claimWindowMs: number;
  now: () => Date;
};

/** The denial a request gets when the stores could not be asked in time: temporary — asking again may be approved. */
export const BINDING_UNAVAILABLE = "the store could not be checked just now; request a new approval";

/**
 * The spend-request lifecycle (DESIGN §6.1–6.3): create → request approval → the policy's decision, bound to a
 * store checkout → the card. Every read first applies what fell due on the clock (the decision, an expired
 * approval window or credential), so the state is the same whoever asks — link-cli polling, the records, or the
 * store checking an approval. A session only ever sees its own requests; another's id is "no such request".
 */
export class SpendRequestService {
  constructor(private readonly d: SpendRequestDeps) {}

  async create(session: Session, input: CreateInput, opts: { decideNow: boolean }): Promise<SpendRequestRow> {
    const now = this.d.now();
    const counts = await this.d.requests.counts(session.id, new Date(now.getTime() - 3_600_000));
    if (counts.lastHour >= this.d.limits.perHour) throw rateLimited(`At most ${this.d.limits.perHour} spend requests can be created per hour.`);
    if (counts.active >= this.d.limits.active) throw rateLimited(`At most ${this.d.limits.active} spend requests can be active at once; cancel one first.`);
    const pending = input.requestApproval || opts.decideNow;
    const { row, created } = await this.d.requests.insert({
      id: `lsrq_${randomBytes(12).toString("hex")}`,
      sessionId: session.id,
      status: pending ? "pending_approval" : "created",
      credentialType: "card",
      paymentDetails: this.paymentMethod(session, input.paymentDetails),
      amount: input.amount,
      currency: input.currency,
      merchantName: input.merchantName,
      merchantUrl: input.merchantUrl,
      context: input.context,
      lineItems: input.lineItems,
      totals: input.totals,
      metadata: input.metadata,
      recurring: input.recurring,
      test: input.test,
      idempotencyKey: input.idempotencyKey,
      approvalRequestedAt: pending ? now : null,
      expiresAt: new Date(now.getTime() + this.d.timing.credentialTtlMs),
      createdAt: now,
    });
    if (!created) return this.refresh(row);
    await this.statusEvent(row, null, "create");
    return opts.decideNow ? this.decide(row) : this.refresh(row);
  }

  async retrieve(session: Session, id: string): Promise<SpendRequestRow> {
    return this.refresh(await this.own(session, id));
  }

  async list(session: Session, history: boolean): Promise<SpendRequestRow[]> {
    const rows = await Promise.all((await this.d.requests.ofSession(session.id, true)).map((r) => this.refresh(r)));
    return history ? rows : rows.filter((r) => r.status === "created" || r.status === "pending_approval" || r.status === "approved");
  }

  async update(session: Session, id: string, patch: UpdateInput, opts: { decideNow: boolean }): Promise<SpendRequestRow> {
    const row = await this.retrieve(session, id);
    if (!allows("update", row.status)) throw invalid("spend_request_unexpected_state", `Spend request ${id} is ${row.status}: only a created or pending_approval request can be updated.`);
    const change: RequestPatch = { ...patch, paymentDetails: patch.paymentDetails === undefined ? undefined : this.paymentMethod(session, patch.paymentDetails) };
    // The person approves what they are shown: a pending request's approval starts over on its new details.
    if (row.status === "pending_approval") change.approvalRequestedAt = this.d.now();
    const updated = await this.d.requests.change(id, ["created", "pending_approval"], change);
    if (!updated) return this.update(session, id, patch, opts);
    await this.d.events.record({ session: session.id, request: id, kind: "status", data: { call: "update", status: updated.status, changed: Object.keys(patch) } });
    return opts.decideNow && updated.status === "pending_approval" ? this.decide(updated) : this.refresh(updated);
  }

  async requestApproval(session: Session, id: string): Promise<SpendRequestRow> {
    const row = await this.retrieve(session, id);
    if (row.status === "pending_approval") return row;
    if (!allows("request_approval", row.status)) throw invalid("spend_request_unexpected_state", `Spend request ${id} is ${row.status}: approval can be requested only for a created request.`);
    const moved = await this.d.requests.change(id, ["created"], { status: "pending_approval", approvalRequestedAt: this.d.now() });
    if (!moved) return this.requestApproval(session, id);
    await this.statusEvent(moved, row.status, "request_approval");
    return this.refresh(moved);
  }

  async cancel(session: Session, id: string): Promise<SpendRequestRow> {
    const row = await this.retrieve(session, id);
    if (!allows("cancel", row.status)) throw invalid("spend_request_unexpected_state", `Spend request ${id} is ${row.status} and can no longer be canceled.`);
    const moved = await this.d.requests.change(id, ["created", "pending_approval", "approved"], { status: "canceled", canceledAt: this.d.now() });
    if (!moved) return this.cancel(session, id);
    await this.statusEvent(moved, row.status, "cancel");
    return moved;
  }

  /** Applies whatever fell due on the clock, in order (a decision, then an expiry). A decision put off leaves the request as it is. */
  async refresh(row: SpendRequestRow): Promise<SpendRequestRow> {
    let current = row;
    for (let step = 0; step < 3; step++) {
      const due = dueTransition(current, this.d.now(), this.d.timing);
      if (!due) return current;
      const next = due.kind === "decide" ? await this.decide(current) : await this.expire(current, due.reason);
      if (next.status === current.status) return next;
      current = next;
    }
    return current;
  }

  /**
   * The policy's decision on a pending request, bound to the checkout it pays for; once (a concurrent reader gets the
   * same). A `retry` (the stores could not be asked) is recorded and leaves the request pending while it is young —
   * the next read decides again — and denies it, flagged, once `bindingRetryMs` has passed since approval was asked.
   */
  async decide(row: SpendRequestRow): Promise<SpendRequestRow> {
    const input = { amount: row.amount, merchantUrl: row.merchantUrl, merchantName: row.merchantName, sessionId: row.sessionId };
    const binding = await this.d.binder.bind(input);
    const decision = this.d.policy.decide({ request: row, binding, merchant: this.d.binder.merchant(input) });
    const now = this.d.now();
    if (decision.status === "retry") {
      await this.d.events.record({ session: row.sessionId, request: row.id, kind: "binding_unavailable", data: { reason: decision.reason } });
      const asked = (row.approvalRequestedAt ?? row.createdAt).getTime();
      if (now.getTime() - asked < this.d.bindingRetryMs) return row;
    }
    // A request the policy denies on its own grounds is merely unbound, whether or not the stores answered: only a
    // denial the outage caused keeps the `unavailable` binding (flagged binding_unavailable — infrastructure).
    const kept: Binding = binding.rule === "unavailable" && decision.status !== "retry" ? { rule: "fallback", reason: binding.reason } : binding;
    const patch: RequestPatch =
      decision.status === "approved"
        ? { status: "approved", binding: kept, card: await this.newCard(row, decision.card, now), decidedAt: now, approvedAt: now }
        : { status: "denied", binding: kept, denialReason: decision.status === "retry" ? `${BINDING_UNAVAILABLE} (${decision.reason})` : decision.reason, decidedAt: now };
    const moved = await this.d.requests.change(row.id, ["pending_approval"], patch);
    if (!moved) return (await this.d.requests.get(row.id)) ?? row;
    await this.statusEvent(moved, row.status, `policy:${this.d.policy.name}`, { binding: kept, ...(decision.status === "approved" ? { card: decision.card } : { reason: decision.reason }) });
    return moved;
  }

  /** Sets a status by hand — the internal control the contract checks use to reach every status link-cli knows. */
  async force(id: string, status: Status, actionUrl: string | null): Promise<SpendRequestRow> {
    const row = await this.d.requests.get(id);
    if (!row) throw notFound("spend request", id);
    const now = this.d.now();
    let patch: RequestPatch = { status, statusDetails: null };
    if (status === "approved" && !row.card) {
      const binding = await this.d.binder.bind({ amount: row.amount, merchantUrl: row.merchantUrl, merchantName: row.merchantName, sessionId: row.sessionId });
      patch = { ...patch, binding, card: await this.newCard(row, cardKindOf(binding), now), decidedAt: now, approvedAt: now };
    }
    if (status === "pending_approval") patch.approvalRequestedAt = now;
    if (status === "denied") patch = { ...patch, denialReason: "declined by the user", decidedAt: now };
    if (status === "canceled") patch.canceledAt = now;
    if (status === "requires_action") {
      patch.statusDetails = {
        requires_action: { next_action: { type: "three_d_secure", resolution: "auto_resume", display_message: "Complete the 3D Secure verification for your card to continue.", action_url: actionUrl } },
      };
    }
    const moved = (await this.d.requests.change(id, STATUSES, patch)) as SpendRequestRow;
    await this.statusEvent(moved, row.status, "internal:force");
    return moved;
  }

  /** The requests bound to a workspace's store (every store when null), each as it now stands. */
  async boundTo(workspace: string, store: string | null): Promise<SpendRequestRow[]> {
    return Promise.all((await this.d.requests.bound(workspace, store)).map((r) => this.refresh(r)));
  }

  /**
   * The approvals a payment at `store` may claim: approved within the binding window with no checkout found when
   * decided (fallback), never used or canceled, with an issued card ending `last4` (for exactly `amountCents` when
   * given), naming no other store. Oldest approval first.
   */
  async claimable(store: string, last4: string, amountCents: number | null = null): Promise<SpendRequestRow[]> {
    const since = new Date(this.d.now().getTime() - this.d.claimWindowMs);
    const rows = await this.d.requests.claimable(last4, since, amountCents);
    return rows.filter((r) => {
      const named = this.d.binder.merchant({ merchantUrl: r.merchantUrl, merchantName: r.merchantName }).store;
      return (named === null || named === store) && r.card !== null && r.binding?.rule === "fallback";
    });
  }

  /** Of `sessionIds`, the logins bound to another workspace than `workspace` (RequestsRepo.boundElsewhere): another run's. */
  async loginsElsewhere(sessionIds: readonly string[], workspace: string): Promise<Set<string>> {
    return this.d.requests.boundElsewhere(sessionIds, workspace);
  }

  /** Binds a fallback request to the workspace's store a payment with its card was made at (claimed_at_payment); null when another payment bound it first. */
  async claim(r: SpendRequestRow, workspace: string, store: string): Promise<SpendRequestRow | null> {
    if (r.binding?.rule !== "fallback" || !r.card) return null;
    const binding: Binding = { rule: "payment", fellBack: r.binding.reason, workspace, store, checkout: null, scenarioId: null, card: r.card.kind };
    const moved = await this.d.requests.claim(r.id, binding);
    if (moved) await this.d.events.record({ session: moved.sessionId, request: moved.id, kind: "status", data: { from: moved.status, to: moved.status, by: "payment:claim", binding } });
    return moved;
  }

  /** Marks the request's card used by `payment` — the one payment it pays; null when another payment used it first. */
  async use(r: SpendRequestRow, payment: string): Promise<SpendRequestRow | null> {
    const moved = await this.d.requests.use(r.id, payment, this.d.now());
    if (moved) await this.d.events.record({ session: moved.sessionId, request: moved.id, kind: "status", data: { from: moved.status, to: moved.status, by: "payment:use", payment } });
    return moved;
  }

  /** A payment the spend controls declined against the request's card, on the request's record. */
  async declined(r: SpendRequestRow, payment: string | null, reason: string, amountCents: number): Promise<void> {
    await this.d.events.record({ session: r.sessionId, request: r.id, kind: "status", data: { from: r.status, to: r.status, by: `payment:decline:${reason}`, payment, amountCents } });
  }

  /**
   * A card for the request: an expiry no card of its kind the session holds has — and, while one is free, none recently
   * issued to any session either (cards.ts).
   */
  private async newCard(row: SpendRequestRow, kind: CardKind, now: Date): Promise<IssuedCard> {
    const taken = await this.d.requests.expiriesInUse(row.sessionId, kind, new Date(now.getTime() - this.d.claimWindowMs));
    return issueCard(kind, now, SPEND_REQUEST_EXPIRY, taken.session, taken.recent);
  }

  private async expire(row: SpendRequestRow, reason: string): Promise<SpendRequestRow> {
    const moved = await this.d.requests.change(row.id, [row.status], { status: "expired" });
    if (!moved) return (await this.d.requests.get(row.id)) ?? row;
    await this.statusEvent(moved, row.status, `expired:${reason}`);
    return moved;
  }

  private async own(session: Session, id: string): Promise<SpendRequestRow> {
    const row = await this.d.requests.get(id);
    if (!row || row.sessionId !== session.id) throw notFound("spend request", id);
    return row;
  }

  private paymentMethod(session: Session, given: string | null): string {
    const mine = paymentMethodIdOf(session);
    if (given !== null && given !== mine) throw invalid("resource_missing", `No such payment method: '${given}'`, "payment_details");
    return mine;
  }

  private async statusEvent(row: SpendRequestRow, from: Status | null, by: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.d.events.record({ session: row.sessionId, request: row.id, kind: "status", data: { from, to: row.status, by, ...extra } });
  }
}
