import { randomBytes } from "node:crypto";
import type { Binder } from "../binding/binder.js";
import type { EventsRepo } from "../db/events-repo.js";
import type { RequestPatch, RequestsRepo } from "../db/requests-repo.js";
import { issueCard } from "../domain/cards.js";
import { allows, dueTransition, type Timing } from "../domain/lifecycle.js";
import { invalid, notFound, rateLimited } from "../domain/link-errors.js";
import type { CreateInput, UpdateInput } from "../domain/spend-request-input.js";
import { STATUSES, type Session, type SpendRequestRow, type Status } from "../domain/types.js";
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
  now: () => Date;
};

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

  /** Applies whatever fell due on the clock, in order (a decision, then an expiry). */
  async refresh(row: SpendRequestRow): Promise<SpendRequestRow> {
    let current = row;
    for (let step = 0; step < 3; step++) {
      const due = dueTransition(current, this.d.now(), this.d.timing);
      if (!due) return current;
      current = due.kind === "decide" ? await this.decide(current) : await this.expire(current, due.reason);
    }
    return current;
  }

  /** The policy's decision on a pending request, bound to the checkout it pays for; once (a concurrent reader gets the same). */
  async decide(row: SpendRequestRow): Promise<SpendRequestRow> {
    const input = { amount: row.amount, merchantUrl: row.merchantUrl, merchantName: row.merchantName };
    const binding = await this.d.binder.bind(input);
    const decision = this.d.policy.decide({ request: row, binding, merchant: this.d.binder.merchant(input) });
    const now = this.d.now();
    const patch: RequestPatch =
      decision.status === "approved"
        ? { status: "approved", binding, card: issueCard(decision.card, now), decidedAt: now, approvedAt: now }
        : { status: "denied", binding, denialReason: decision.reason, decidedAt: now };
    const moved = await this.d.requests.change(row.id, ["pending_approval"], patch);
    if (!moved) return (await this.d.requests.get(row.id)) ?? row;
    await this.statusEvent(moved, row.status, `policy:${this.d.policy.name}`, { binding, ...(decision.status === "denied" ? { reason: decision.reason } : { card: decision.card }) });
    return moved;
  }

  /** Sets a status by hand — the internal control the contract checks use to reach every status link-cli knows. */
  async force(id: string, status: Status, actionUrl: string | null): Promise<SpendRequestRow> {
    const row = await this.d.requests.get(id);
    if (!row) throw notFound("spend request", id);
    const now = this.d.now();
    let patch: RequestPatch = { status, statusDetails: null };
    if (status === "approved" && !row.card) {
      const binding = await this.d.binder.bind({ amount: row.amount, merchantUrl: row.merchantUrl, merchantName: row.merchantName });
      patch = { ...patch, binding, card: issueCard(binding.rule === "fallback" ? "success" : binding.card, now), decidedAt: now, approvedAt: now };
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

  /** What was approved for a workspace's store: the largest live approval (DESIGN §8.2 "paid above approval"). */
  async approvals(workspace: string, store: string): Promise<{ approvedCents: number | null; requests: SpendRequestRow[] }> {
    const rows = await Promise.all((await this.d.requests.bound(workspace, store)).map((r) => this.refresh(r)));
    const approved = rows.filter((r) => r.approvedAt !== null && r.canceledAt === null).map((r) => r.amount);
    return { approvedCents: approved.length ? Math.max(...approved) : null, requests: rows };
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
