import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, signWorkspaceHeader } from "@benchme/core";
import { AuthService, DomainError, MemoryLedger, MemoryUsersRepo, read, registerDoors, registerWorkspaceScope, unrecorded, untransacted, write, type LedgerRules } from "@benchme/site-kit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StateOracle } from "./oracles/state-oracle.js";
import { HttpWorkspaceStateReader } from "./oracles/state-reader.js";
import { stateSpec } from "./specs/spec.js";

// The seam the unit tests fake: the verifier's own reader against a site built with the kit's own doors and ledger.
// What is proven here is what neither side can prove alone: the reader's signature opens the ledger route, its reads
// of the site's REST API leave no entry, and the checks read the entries the site really wrote.

const SECRET = "gateway-secret-for-tests";
const WS = "ws_0123456789ab";
const AT = "2027-03-01T10:02:11.482Z";

type Order = { orderNo: string; status: string };
interface OrdersRepo {
  listOrders(ws: string): Promise<Order[]>;
  getOrder(ws: string, orderNo: string): Promise<Order | null>;
  cancelOrder(ws: string, orderNo: string): Promise<Order>;
}
const RULES: LedgerRules<OrdersRepo> = { listOrders: unrecorded, getOrder: read("order", ([orderNo]) => orderNo), cancelOrder: write("order", "cancel", ([orderNo]) => orderNo) };

let site: FastifyInstance;
let ledger: MemoryLedger;
let apiToken = "";
const orders = new Map<string, Order>([["SO-7", { orderNo: "SO-7", status: "shipped" }], ["SO-8", { orderNo: "SO-8", status: "processing" }]]);

/** What the gateway forwards for a visitor: the workspace, signed, and nothing of the verifier's. */
const visitor = (headers: Record<string, string> = {}) => ({ [WORKSPACE_HEADER]: WS, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, WS), ...headers });
/** The verifier's reader, its fetch landing on the site as a request to the site's own address would. */
const reader = () =>
  new HttpWorkspaceStateReader({ shop: "http://shop.internal" }, SECRET, (async (url: string | URL | Request, init?: RequestInit) => {
    const res = await site.inject({ method: "GET", url: String(url).replace("http://shop.internal", ""), headers: init?.headers as Record<string, string> });
    return new Response(res.body, { status: res.statusCode });
  }) as typeof fetch);
const judge = async (checks: unknown[]) => new StateOracle(reader()).check(Buffer.alloc(0), stateSpec.parse({ kind: "state", checks }), { workspaceId: WS, taskId: "seam" });

beforeAll(async () => {
  ledger = new MemoryLedger("shop", () => new Date(AT));
  const accounts = new AuthService({ users: new MemoryUsersRepo(), mailer: { deliver: async () => undefined }, sessionTtlSeconds: 60, tokenPrefix: "shp", verification: { subject: "s", body: (code) => code } });
  site = Fastify();
  // This site has no cookies: an api token is its only sign-in.
  site.decorateRequest("cookies", null);
  site.addHook("onRequest", async (req) => {
    req.cookies = {};
  });
  registerWorkspaceScope(site, SECRET);
  const doors = registerDoors(site, { ledger, transactions: untransacted, auth: accounts, cookie: "shop_session", gatewaySecret: SECRET });
  const repo = doors.ledgered<OrdersRepo>(
    {
      listOrders: async () => [...orders.values()],
      getOrder: async (_ws, orderNo) => orders.get(orderNo) ?? null,
      cancelOrder: async (_ws, orderNo) => {
        const order = orders.get(orderNo);
        if (!order) throw new DomainError("UNKNOWN_ORDER", `no order ${orderNo}`, 404);
        if (order.status !== "processing") throw new DomainError("ORDER_LOCKED", "only an order still processing can be cancelled", 409);
        order.status = "cancelled";
        return order;
      },
    },
    RULES,
  );
  site.get("/api/v1/orders", async (req) => repo.listOrders(req.workspaceId));
  site.get<{ Params: { no: string } }>("/api/v1/orders/:no", async (req, reply) => (await repo.getOrder(req.workspaceId, req.params.no)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  site.post<{ Params: { no: string } }>("/api/v1/orders/:no/cancel", async (req, reply) =>
    repo.cancelOrder(req.workspaceId, req.params.no).catch((err: unknown) => {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }),
  );
  await accounts.signup(WS, "ilsa@example.com", "correct-horse-9", "Ilsa");
  apiToken = await accounts.issueApiToken(WS, "ilsa@example.com");
});
afterAll(async () => {
  await site?.close();
});

const unchanged = { kind: "unchanged", name: "nothing changed", scope: { apps: ["shop"] } };
const lookedOrRefused = { kind: "ledger", name: "looked, or was refused for the reason", match: [{ app: "shop", entity: { type: "order", id: "SO-7" }, action: "read" }, { app: "shop", entity: { type: "order", id: "SO-7" }, outcome: "refused", code: "ORDER_LOCKED" }] };
const stillShipped = { name: "still shipped", app: "shop", path: "/api/v1/orders/SO-7", expect: { status: "shipped" } };

describe("the verifier against a site's real ledger", () => {
  it("fails an impossible task nobody attempted, however often it is asked: its own reads leave no entry to pass on", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await judge([stillShipped, unchanged, lookedOrRefused]);
      expect(result.checks.map((c) => [c.name, c.ok])).toEqual([["still shipped", true], ["nothing changed", true], ["looked, or was refused for the reason", false]]);
    }
    // Three submissions read SO-7 through the site's REST API three times; none of them is in the ledger.
    expect(await ledger.list(WS)).toEqual([]);
  });

  it("passes it once a visitor was refused by the rule, with the time the site recorded", async () => {
    const refused = await site.inject({ method: "POST", url: "/api/v1/orders/SO-7/cancel", headers: visitor({ authorization: `Bearer ${apiToken}` }) });
    expect([refused.statusCode, refused.json().error]).toEqual([409, "ORDER_LOCKED"]);
    const result = await judge([stillShipped, unchanged, lookedOrRefused]);
    expect(result.verdict).toBe("OK");
    expect(result.checks).toEqual([{ name: "still shipped", ok: true }, { name: "nothing changed", ok: true }, { name: "looked, or was refused for the reason", ok: true, at: AT }]);
  });

  it("does not take a refusal for want of a sign-in for the rule's refusal", async () => {
    const before = (await ledger.list(WS)).length;
    expect((await site.inject({ method: "POST", url: "/api/v1/orders/SO-8/cancel", headers: visitor() })).statusCode).toBe(401);
    expect((await ledger.list(WS)).slice(before).map((e) => [e.entity.id, e.actor, e.outcome, e.code])).toEqual([["SO-8", null, "refused", "UNAUTHORIZED"]]);
    const locked = { kind: "ledger", name: "refused as locked", match: { app: "shop", entity: { type: "order", id: "SO-8" }, outcome: "refused", code: "ORDER_LOCKED" } };
    expect((await judge([locked])).verdict).toBe("FAIL");
  });

  it("sees a change the moment there is one: who made it, through which door, and that the row is gone from where it was", async () => {
    expect((await site.inject({ method: "POST", url: "/api/v1/orders/SO-8/cancel", headers: visitor({ authorization: `Bearer ${apiToken}` }) })).statusCode).toBe(200);
    const result = await judge([
      unchanged,
      { ...unchanged, name: "nothing but the cancel", except: [{ app: "shop", entity: { type: "order", id: "SO-8" }, action: "cancel" }] },
      { kind: "ledger", name: "cancelled by Ilsa over REST", match: { app: "shop", entity: { type: "order", id: "SO-8" }, action: "cancel", outcome: "ok", door: "rest", actor: "ilsa@example.com" } },
      { kind: "absent", name: "no order still processing", app: "shop", path: "/api/v1/orders", where: { status: "processing" } },
      { name: "cancelled", app: "shop", path: "/api/v1/orders", where: { orderNo: "SO-8" }, expect: { status: "cancelled" }, entity: { type: "order", id: "{orderNo}" } },
    ]);
    expect(result.checks.map((c) => [c.name, c.ok, c.at])).toEqual([
      ["nothing changed", false, undefined],
      ["nothing but the cancel", true, undefined],
      ["cancelled by Ilsa over REST", true, AT],
      ["no order still processing", true, undefined],
      ["cancelled", true, AT],
    ]);
  });
});
