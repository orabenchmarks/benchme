import type { SpendRequestRow, Status } from "./types.js";

/**
 * When a spend request changes on its own (pure: the clock is an argument). Link's documented timings: the user
 * has 30 minutes from the approval request to approve, and a credential is valid for 12 hours from the request's
 * creation. The wallet's approval policy answers `approvalDelayMs` after the approval request, the way a person
 * answers a push notification a moment later — so a retrieve right after create sees `pending_approval`, as with
 * real Link, and link-cli's own polling sees the decision.
 */
export type Timing = {
  approvalDelayMs: number;
  approvalWindowMs: number;
  credentialTtlMs: number;
};

export const LINK_TIMING: Omit<Timing, "approvalDelayMs"> = {
  approvalWindowMs: 30 * 60_000,
  credentialTtlMs: 12 * 3_600_000,
};

export type Due = { kind: "decide" } | { kind: "expire"; reason: "approval_window" | "credential" } | null;

/** The transition `r` is due at `now`, if any. Final statuses never move. */
export function dueTransition(r: Pick<SpendRequestRow, "status" | "approvalRequestedAt" | "expiresAt">, now: Date, t: Timing): Due {
  const at = now.getTime();
  if (r.status === "pending_approval") {
    const requested = (r.approvalRequestedAt ?? now).getTime();
    if (t.approvalDelayMs < t.approvalWindowMs && at >= requested + t.approvalDelayMs) return { kind: "decide" };
    if (at >= requested + t.approvalWindowMs) return { kind: "expire", reason: "approval_window" };
    return null;
  }
  if ((r.status === "created" || r.status === "approved" || r.status === "requires_action") && at >= r.expiresAt.getTime()) {
    return { kind: "expire", reason: "credential" };
  }
  return null;
}

/** The calls each status accepts (Link: update before approval; cancel from created, pending_approval or approved). */
const ALLOWED: Record<"update" | "request_approval" | "cancel", readonly Status[]> = {
  update: ["created", "pending_approval"],
  request_approval: ["created", "pending_approval"],
  cancel: ["created", "pending_approval", "approved"],
};

export function allows(call: keyof typeof ALLOWED, status: Status): boolean {
  return ALLOWED[call].includes(status);
}
