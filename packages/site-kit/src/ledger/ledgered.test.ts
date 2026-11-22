import { describe, expect, it } from "vitest";
import { AuthError } from "../auth-service.js";
import { CallerScope, type Caller } from "../doors/caller.js";
import { DOORS } from "../doors/door.js";
import { NoCarrier } from "../doors/session-carrier.js";
import { SIGN_IN_REQUIRED_CODE, SignInRequired } from "../doors/sign-in.js";
import { DomainError } from "../mcp-server.js";
import { MemoryLedger } from "./ledger.js";
import { ledgered } from "./ledgered.js";
import { read, unrecorded, write, type LedgerRules } from "./rules.js";

type Order = { orderNo: string; status: string };

/** A site's rules in miniature: one list, one read, two writes, and a method that fails for no rule's reason. */
interface OrdersRepo {
  listOrders(ws: string): Promise<Order[]>;
  getOrder(ws: string, orderNo: string): Promise<Order | null>;
  placeOrder(ws: string, sku: string): Promise<Order>;
  cancelOrder(ws: string, orderNo: string): Promise<Order>;
  crash(ws: string): Promise<Order>;
}

class FakeOrders implements OrdersRepo {
  private readonly orders = new Map<string, Order>([["SO-1", { orderNo: "SO-1", status: "shipped" }]]);
  async listOrders() {
    return [...this.orders.values()];
  }
  async getOrder(_ws: string, orderNo: string) {
    return this.orders.get(orderNo) ?? null;
  }
  async placeOrder(_ws: string, sku: string) {
    if (sku === "GONE") throw new DomainError("OUT_OF_STOCK", "none left", 409);
    const order = { orderNo: `SO-${this.orders.size + 1}`, status: "processing" };
    this.orders.set(order.orderNo, order);
    return order;
  }
  async cancelOrder(ws: string, orderNo: string) {
    // Reads its own row the way a real repository does: through `this`, which no door sees.
    const order = await this.getOrder(ws, orderNo);
    if (!order) throw new DomainError("UNKNOWN_ORDER", `no order ${orderNo}`, 404);
    if (order.status === "shipped") throw new DomainError("ORDER_LOCKED", "a shipped order cannot be cancelled", 409);
    order.status = "cancelled";
    return order;
  }
  async crash(): Promise<Order> {
    throw new Error("connection lost");
  }
}

const RULES: LedgerRules<OrdersRepo> = {
  listOrders: unrecorded,
  getOrder: read("order", ([orderNo]) => orderNo),
  placeOrder: write("order", "create", (_args, order) => order?.orderNo),
  cancelOrder: write("order", "cancel", ([orderNo]) => orderNo),
  crash: write("order", "crash", () => null),
};

const WS = "ws_0123456789ab";
const AT = "2027-03-01T10:02:11.482Z";
const caller = (over: Partial<Caller> = {}): Caller => ({ door: "rest", observer: false, actor: async () => "ilsa@example.com", session: new NoCarrier(), ...over });
const nobody = (over: Partial<Caller> = {}): Caller => caller({ actor: async () => null, ...over });

function site() {
  const ledger = new MemoryLedger("shop", () => new Date(AT));
  const callers = new CallerScope();
  const orders = ledgered<OrdersRepo>(new FakeOrders(), RULES, { ledger, callers });
  const as = <T>(who: Caller, fn: () => Promise<T>) => callers.run(who, fn);
  return { ledger, orders, as, entries: () => ledger.list(WS) };
}

describe("ledgered", () => {
  it("records a write that succeeded: the app, the entity and its new id, the action, the door, who was signed in, and when", async () => {
    const s = site();
    const made = await s.as(caller(), () => s.orders.placeOrder(WS, "TENT"));
    expect(made).toEqual({ orderNo: "SO-2", status: "processing" });
    expect(await s.entries()).toEqual([
      { seq: 1, at: AT, app: "shop", kind: "write", entity: { type: "order", id: "SO-2" }, action: "create", door: "rest", actor: "ilsa@example.com", outcome: "ok", code: null },
    ]);
  });

  it("records a write the rules refused, with the rule's reason code, and still refuses it", async () => {
    const s = site();
    await expect(s.as(caller(), () => s.orders.cancelOrder(WS, "SO-1"))).rejects.toMatchObject({ code: "ORDER_LOCKED" });
    await expect(s.as(caller(), () => s.orders.placeOrder(WS, "GONE"))).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect((await s.entries()).map((e) => [e.entity.id, e.action, e.outcome, e.code])).toEqual([
      ["SO-1", "cancel", "refused", "ORDER_LOCKED"],
      // A refused create has no entity yet.
      [null, "create", "refused", "OUT_OF_STOCK"],
    ]);
  });

  it("records a read of one entity, and a read that found nothing as refused with NOT_FOUND", async () => {
    const s = site();
    expect(await s.as(caller(), () => s.orders.getOrder(WS, "SO-1"))).toMatchObject({ orderNo: "SO-1" });
    expect(await s.as(caller(), () => s.orders.getOrder(WS, "SO-404"))).toBeNull();
    expect((await s.entries()).map((e) => [e.kind, e.entity.id, e.action, e.outcome, e.code])).toEqual([
      ["read", "SO-1", "read", "ok", null],
      ["read", "SO-404", "read", "refused", "NOT_FOUND"],
    ]);
  });

  it.each(DOORS)("names the door the call came through: %s", async (door) => {
    const s = site();
    await s.as(caller({ door }), () => s.orders.getOrder(WS, "SO-1"));
    expect((await s.entries()).map((e) => e.door)).toEqual([door]);
  });

  it("names nobody when nobody is signed in", async () => {
    const s = site();
    await s.as(caller({ actor: async () => null }), () => s.orders.getOrder(WS, "SO-1"));
    expect((await s.entries()).map((e) => e.actor)).toEqual([null]);
  });

  it("leaves out what is not a read of one entity or a write: a list, and a rule's own lookups", async () => {
    const s = site();
    await s.as(caller(), () => s.orders.listOrders(WS));
    expect(await s.entries()).toEqual([]);
    // cancelOrder reads the order itself before refusing: one entry, the cancel, and no read beside it.
    await s.as(caller(), () => s.orders.cancelOrder(WS, "SO-1")).catch(() => undefined);
    expect((await s.entries()).map((e) => e.action)).toEqual(["cancel"]);
  });

  it("records a refusal and not a failure: an error that is no rule's answer leaves no entry", async () => {
    const s = site();
    await expect(s.as(caller(), () => s.orders.crash(WS))).rejects.toThrow("connection lost");
    expect(await s.entries()).toEqual([]);
  });

  it("takes a sign-in refusal for a refusal too", async () => {
    const ledger = new MemoryLedger("shop");
    const callers = new CallerScope();
    const repo = ledgered({ verify: async (_ws: string, _email: string): Promise<void> => Promise.reject(new AuthError("BAD_CODE", "that code is wrong")) }, { verify: write("account", "verify", ([email]) => email) }, { ledger, callers });
    await expect(callers.run(caller(), () => repo.verify(WS, "ilsa@example.com"))).rejects.toMatchObject({ code: "BAD_CODE" });
    expect((await ledger.list(WS)).map((e) => [e.entity.id, e.outcome, e.code])).toEqual([["ilsa@example.com", "refused", "BAD_CODE"]]);
  });

  it("shows the verifier the rows without recording that it looked, and lets it change nothing", async () => {
    const s = site();
    expect(await s.as(caller({ observer: true }), () => s.orders.getOrder(WS, "SO-1"))).toMatchObject({ orderNo: "SO-1" });
    await expect(s.as(caller({ observer: true }), () => s.orders.placeOrder(WS, "TENT"))).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(await s.entries()).toEqual([]);
    expect(await s.as(caller(), () => s.orders.listOrders(WS))).toHaveLength(1);
  });

  it("refuses to run a recorded method with no caller in scope: a door that never said which one it is", async () => {
    const s = site();
    await expect(s.orders.getOrder(WS, "SO-1")).rejects.toThrow(/outside a door/);
    await expect(s.orders.placeOrder(WS, "TENT")).rejects.toThrow(/outside a door/);
    expect(await s.entries()).toEqual([]);
  });

  it("refuses a method nobody gave a rule", async () => {
    const callers = new CallerScope();
    const repo = ledgered(new FakeOrders() as OrdersRepo, { ...RULES, cancelOrder: undefined } as unknown as LedgerRules<OrdersRepo>, { ledger: new MemoryLedger("shop"), callers });
    expect(() => callers.run(caller(), () => repo.cancelOrder(WS, "SO-1"))).toThrow(/no ledger rule/);
  });

  // The sign-in rule. One fixture, one thing varied per case: who is signed in, then the door, then the kind of method.
  describe("asks a sign-in of every write", () => {
    it("refuses a write by nobody with the one sign-in code, records the refusal, and never reaches the repository", async () => {
      const s = site();
      const refused = await s.as(nobody(), () => s.orders.placeOrder(WS, "TENT")).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(SignInRequired);
      expect(refused).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
      expect(SIGN_IN_REQUIRED_CODE).toBe("UNAUTHORIZED");
      expect(await s.entries()).toEqual([
        { seq: 1, at: AT, app: "shop", kind: "write", entity: { type: "order", id: null }, action: "create", door: "rest", actor: null, outcome: "refused", code: "UNAUTHORIZED" },
      ]);
      // Nothing was placed: the same call, signed in, makes the shop's second order and not its third.
      expect(await s.as(caller(), () => s.orders.placeOrder(WS, "TENT"))).toMatchObject({ orderNo: "SO-2" });
    });

    it("lets the same write through for someone signed in", async () => {
      const s = site();
      await s.as(caller(), () => s.orders.placeOrder(WS, "TENT"));
      expect((await s.entries()).map((e) => [e.actor, e.outcome, e.code])).toEqual([["ilsa@example.com", "ok", null]]);
    });

    it.each(DOORS)("asks it through every door alike: %s", async (door) => {
      const s = site();
      const refused = await s.as(nobody({ door }), () => s.orders.cancelOrder(WS, "SO-1")).catch((err: unknown) => err);
      expect(refused).toMatchObject({ code: "UNAUTHORIZED", door });
      // The rule that would have refused it for its own reason (a shipped order) was never asked.
      expect((await s.entries()).map((e) => [e.door, e.entity.id, e.action, e.outcome, e.code])).toEqual([[door, "SO-1", "cancel", "refused", "UNAUTHORIZED"]]);
    });

    it("asks nothing of a read", async () => {
      const s = site();
      expect(await s.as(nobody(), () => s.orders.getOrder(WS, "SO-1"))).toMatchObject({ orderNo: "SO-1" });
      expect(await s.as(nobody(), () => s.orders.listOrders(WS))).toHaveLength(1);
      expect((await s.entries()).map((e) => [e.kind, e.actor, e.outcome])).toEqual([["read", null, "ok"]]);
    });
  });

  it("keeps each workspace's entries to itself", async () => {
    const s = site();
    await s.as(caller(), () => s.orders.getOrder(WS, "SO-1"));
    expect(await s.ledger.list("ws_ffffffffffff")).toEqual([]);
  });
});
