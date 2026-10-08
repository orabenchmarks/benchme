import { describe, expect, it } from "vitest";
import type { Binder } from "./binding/binder.js";
import type { EventsRepo } from "./db/events-repo.js";
import type { RequestsRepo } from "./db/requests-repo.js";
import { expiryKey, SPEND_REQUEST_EXPIRY } from "./domain/cards.js";
import type { SpendRequestRow } from "./domain/types.js";
import { LabPolicy } from "./policy/approval-policy.js";
import { SpendRequestService } from "./service/spend-requests.js";

/** The service's card issuance, its repositories stubbed: what it asks for, and what the decision issues. */
describe("issuing a spend request's card", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  const all = SPEND_REQUEST_EXPIRY.years.flatMap((y) => SPEND_REQUEST_EXPIRY.months.map((m) => expiryKey({ expMonth: m, expYear: 2026 + y })));
  const pending = { id: "lsrq_0", sessionId: "lwses_1", status: "pending_approval", amount: 2_000, merchantUrl: "https://benchme.example/", merchantName: "Quillfeather Coffee", approvalRequestedAt: now, createdAt: now } as SpendRequestRow;

  function service(taken: Set<string>) {
    const asked: { session: string; kind: string; since: Date }[] = [];
    let patched: Partial<SpendRequestRow> | null = null;
    const requests = {
      expiriesInUse: async (session: string, kind: string, since: Date) => {
        asked.push({ session, kind, since });
        return taken;
      },
      change: async (_id: string, _from: unknown, patch: Partial<SpendRequestRow>) => {
        patched = patch;
        return { ...pending, ...patch };
      },
    } as unknown as RequestsRepo;
    const binder = { bind: async () => ({ rule: "fallback", reason: "no rule applied" }), merchant: () => ({ origin: "https://benchme.example", workspace: null, app: null, store: "quillfeather", session: null, host: "benchme.example", path: [], name: "quillfeather coffee" }) } as unknown as Binder;
    const events = { record: async () => undefined } as unknown as EventsRepo;
    const svc = new SpendRequestService({
      requests,
      events,
      binder,
      policy: new LabPolicy({ merchantOrigins: ["https://benchme.example"], hostedCheckoutOrigins: [], stores: ["quillfeather"] }),
      timing: { approvalDelayMs: 0, approvalWindowMs: 30 * 60_000, credentialTtlMs: 12 * 3_600_000 },
      limits: { perHour: 50, active: 30 },
      bindingRetryMs: 60_000,
      claimWindowMs: 60 * 60_000,
      now: () => now,
    });
    return { svc, asked, patched: () => patched };
  }

  it("gives the card the one expiry the session's cards and the window's recent cards of its kind leave free", async () => {
    const free = "7/2028";
    const { svc, asked, patched } = service(new Set(all.filter((k) => k !== free)));
    await svc.decide(pending);
    const card = patched()?.card;
    expect(card && expiryKey(card)).toBe(free);
    // Asked about this session's cards of this kind, and every session's approved within the binding window.
    expect(asked).toEqual([{ session: "lwses_1", kind: "success", since: new Date(now.getTime() - 60 * 60_000) }]);
  });
});
