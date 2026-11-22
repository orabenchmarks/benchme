import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import { SPORTS_TODAY, webmcpV1, scenarios, searchSportsVariants, sportsOrderTotals, sportsReturnDeadline, sportsReturnedQty, type SportsRows } from "@benchme/scenarios";
import { SIGN_IN_TOOLS, type LedgerEntry, type Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSports } from "./build-app.js";
import { ordersList } from "./ui/order-pages.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let mailer: CapturingMailer;
let ws: string;
let rows: SportsRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/sports` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
/** The site's ledger as the verifier reads it: every entry after `from`. */
const ledger = async (from = 0) => (await app.inject(scoped({ url: `/internal/workspaces/${ws}/ledger?cursor=${from}&limit=1000`, headers: { [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } }))).json().items as LedgerEntry[];
const ledgerEnd = async () => Number((await pool.query("SELECT COALESCE(max(seq), 0) AS seq FROM sports.ledger WHERE workspace_id = $1", [ws])).rows[0].seq);
const form = (url: string, body: Record<string, string>) =>
  app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `sp_session=${cookie}` } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; session: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "sp_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `sp_session=${session}` } }, wsId));
  const token = /spt_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `sp_session=${session}` } }, wsId))).body)![0];
  return { token, session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "sports", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildSports({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).sports;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, session: cookie } = await signIn(ws, "buyer@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const linesOf = (no: string) => rows.lines.filter((l) => l.orderNo === no);
const windowOf = (sku: string) => {
  const p = rows.products.find((x) => x.code === rows.variants.find((v) => v.sku === sku)!.productCode)!;
  return rows.categories.find((c) => c.key === p.category)!.returnWindowDays;
};

describe.skipIf(!DB)("sports (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_products"');
    expect(res.body).not.toContain('"$ref"');
    expect(res.body).toContain("Brackenford Sports");
  });

  it("serves the seeded catalog, policies, customers, orders and returns as the generator made them", async () => {
    const pol = await get("/api/v1/policies");
    expect(pol).toMatchObject({ today: SPORTS_TODAY, shipping: rows.shipping });
    expect([...pol.categories].sort((a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key))).toEqual([...rows.categories].sort((a, b) => a.key.localeCompare(b.key)));
    expect((await get("/api/v1/products")).length).toBe(rows.products.length);
    const p = rows.products[0]!;
    expect(await get(`/api/v1/products/${p.code}`)).toEqual({ ...p, variants: rows.variants.filter((v) => v.productCode === p.code).sort((a, b) => a.sku.localeCompare(b.sku)) });
    const o = rows.orders.find((x) => x.status === "delivered" && rows.returns.some((r) => r.orderNo === x.orderNo))!;
    const detail = await get(`/api/v1/orders/${o.orderNo}`);
    expect(detail).toMatchObject({ ...o, lineCount: linesOf(o.orderNo).length, returns: rows.returns.filter((r) => r.orderNo === o.orderNo) });
    expect(detail.address.city).toBe(rows.addresses.find((a) => a.code === o.addressCode)!.city);
    expect(detail.lines.map((l: { sku: string; qty: number; returnedQty: number }) => [l.sku, l.qty, l.returnedQty])).toEqual(linesOf(o.orderNo).map((l) => [l.sku, l.qty, sportsReturnedQty(rows.returns, o.orderNo, l.sku)]));
    const mine = await get(`/api/v1/orders?customerEmail=${encodeURIComponent(o.customerEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { orderNo: string }) => x.orderNo)).toEqual(rows.orders.filter((x) => x.customerEmail === o.customerEmail).map((x) => x.orderNo).sort());
    const month = await get(`/api/v1/orders?placedFrom=2027-03-01&placedTo=2027-03-31&limit=200`);
    expect(month.items.map((x: { orderNo: string }) => x.orderNo)).toEqual(rows.orders.filter((x) => x.placedOn.startsWith("2027-03")).map((x) => x.orderNo).sort());
    const c = await get(`/api/v1/customers/${encodeURIComponent(o.customerEmail)}`);
    expect(c.addresses.map((a: { code: string }) => a.code).sort()).toEqual(rows.addresses.filter((a) => a.customerEmail === o.customerEmail).map((a) => a.code).sort());
    expect((await get("/api/v1/returns")).length).toBe(rows.returns.length);
  });

  it("answers every search the way searchSportsVariants does, a sold-out trap included", async () => {
    const trap = rows.variants.find((v) => v.stock === 0 && v.size !== "one size")!;
    const cap = Math.ceil(trap.weightGrams / 10) * 10 + 40;
    for (const q of [
      { size: trap.size, colour: trap.colour },
      { size: trap.size, colour: trap.colour, maxWeightGrams: cap, inStock: true },
      { category: "running", maxPriceCents: 9000 },
      { query: "shoe", size: "42" },
    ]) {
      const qs = new URLSearchParams({
        ...(q.query ? { query: q.query } : {}), ...(q.category ? { category: q.category } : {}), ...(q.size ? { size: q.size } : {}), ...(q.colour ? { colour: q.colour } : {}),
        ...(q.maxPriceCents ? { maxPrice: String(q.maxPriceCents / 100) } : {}), ...(q.maxWeightGrams ? { maxWeight: String(q.maxWeightGrams) } : {}), ...(q.inStock ? { inStock: "true" } : {}),
      });
      expect(await get(`/api/v1/search?${qs}`)).toEqual(searchSportsVariants(rows, q));
    }
    expect((await get(`/api/v1/search?size=${encodeURIComponent(trap.size)}&colour=${trap.colour}`)).some((o: { sku: string }) => o.sku === trap.sku)).toBe(true);
    expect((await get(`/api/v1/search?size=${encodeURIComponent(trap.size)}&colour=${trap.colour}&inStock=1`)).some((o: { sku: string }) => o.sku === trap.sku)).toBe(false);
    expect((await app.inject(scoped({ method: "GET", url: "/api/v1/search?maxWeight=heavy" }))).statusCode).toBe(400);
    expect((await app.inject(scoped({ method: "GET", url: "/api/v1/orders?placedFrom=2027-02-30" }))).statusCode).toBe(400);
  });

  it("places an order, refuses what the rules refuse, cancels once and gives the stock back", async () => {
    const v = rows.variants.find((x) => x.stock >= 3 && x.priceCents < rows.shipping.freeFromCents)!;
    const sold = rows.variants.find((x) => x.stock === 0)!;
    const customer = rows.customers[0]!;
    const address = rows.addresses.find((a) => a.customerEmail === customer.email)!;
    const other = rows.addresses.find((a) => a.customerEmail !== customer.email)!;
    const order = { customerEmail: customer.email.toUpperCase(), addressCode: address.code, lines: [{ sku: v.sku, qty: 2 }] };
    expect((await post("/api/v1/orders", order, false)).statusCode).toBe(401);
    const made = await post("/api/v1/orders", order);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ customerEmail: customer.email, status: "processing", placedOn: SPORTS_TODAY, addressCode: address.code, lineCount: 1, ...sportsOrderTotals(rows.shipping, [{ qty: 2, unitPriceCents: v.priceCents }]) });
    expect((await get(`/api/v1/variants/${v.sku}`)).stock).toBe(v.stock - 2);
    const refused = async (body: unknown) => {
      const r = await post("/api/v1/orders", body);
      return [r.statusCode, r.json().error];
    };
    expect(await refused({ ...order, lines: [{ sku: sold.sku, qty: 1 }] })).toEqual([409, "OUT_OF_STOCK"]);
    expect(await refused({ ...order, lines: [{ sku: v.sku, qty: v.stock }] })).toEqual([409, "OUT_OF_STOCK"]);
    expect(await refused({ ...order, addressCode: other.code })).toEqual([422, "NOT_THEIR_ADDRESS"]);
    expect(await refused({ ...order, lines: [{ sku: "SP-999-BLK-42", qty: 1 }] })).toEqual([404, "UNKNOWN_SKU"]);
    expect(await refused({ ...order, lines: [{ sku: v.sku, qty: 11 }] })).toEqual([422, "BAD_QTY"]);
    expect(await refused({ ...order, customerEmail: "nobody@example.org" })).toEqual([404, "UNKNOWN_CUSTOMER"]);
    expect((await post("/api/v1/orders", { ...order, lines: "none" })).statusCode).toBe(400);
    const no = made.json().orderNo;
    expect((await post(`/api/v1/orders/${no}/cancel`, {})).json()).toMatchObject({ status: "cancelled", cancelledOn: SPORTS_TODAY });
    expect((await get(`/api/v1/variants/${v.sku}`)).stock).toBe(v.stock);
    expect([(await post(`/api/v1/orders/${no}/cancel`, {})).statusCode, (await post(`/api/v1/orders/${no}/cancel`, {})).json().error]).toEqual([409, "ALREADY_CANCELLED"]);
    const shipped = rows.orders.find((o) => o.status === "shipped")!;
    expect([(await post(`/api/v1/orders/${shipped.orderNo}/cancel`, {})).statusCode, (await get(`/api/v1/orders/${shipped.orderNo}`)).status]).toEqual([422, "shipped"]);
  });

  it("reorders the same lines to the same address", async () => {
    const source = rows.orders.find((o) => o.status === "delivered" && linesOf(o.orderNo).every((l) => rows.variants.find((v) => v.sku === l.sku)!.stock >= l.qty))!;
    const r = await post(`/api/v1/orders/${source.orderNo}/reorder`, {});
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ customerEmail: source.customerEmail, addressCode: source.addressCode, status: "processing", lineCount: linesOf(source.orderNo).length });
    expect(r.json().lines.map((l: { sku: string; qty: number }) => [l.sku, l.qty])).toEqual(linesOf(source.orderNo).map((l) => [l.sku, l.qty]));
    expect((await post(`/api/v1/orders/ORD-1/reorder`, {})).statusCode).toBe(404);
  });

  it("reads a blank address code on a reorder as the earlier order's own address, at every door", async () => {
    const inStock = async (no: string) => (await Promise.all(linesOf(no).map(async (l) => (await get(`/api/v1/variants/${l.sku}`)).stock >= l.qty))).every(Boolean);
    const second = (o: { customerEmail: string; addressCode: string }) => rows.addresses.find((a) => a.customerEmail === o.customerEmail && a.code !== o.addressCode);
    let source = rows.orders[0]!;
    for (const o of rows.orders) if (second(o) && (await inStock(o.orderNo))) { source = o; break; }
    const other = second(source)!;
    const foreign = rows.addresses.find((a) => a.customerEmail !== source.customerEmail)!;
    const client = new Client({ name: "test", version: "0" });
    // A write through a tool needs the sign-in every door asks: this client carries the account's api token.
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), authorization: `Bearer ${bearer}` } } }));
    /** One reorder, [refusal, the address it ships to]; the new order is cancelled so the next one finds the same stock. */
    const shipsTo = async (made: { error?: string; orderNo?: string; addressCode?: string }) => {
      if (made.orderNo) expect((await post(`/api/v1/orders/${made.orderNo}/cancel`, {})).json().status).toBe("cancelled");
      return [made.error, made.addressCode];
    };
    const tool = async (addressCode?: string) => JSON.parse(((await client.callTool({ name: "reorder", arguments: { orderNo: source.orderNo, ...(addressCode === undefined ? {} : { addressCode }) } })) as { content: { text: string }[] }).content[0]!.text);
    try {
      expect(await shipsTo(await tool())).toEqual([undefined, source.addressCode]);
      expect(await shipsTo(await tool(""))).toEqual([undefined, source.addressCode]);
      expect(await shipsTo(await tool("  "))).toEqual([undefined, source.addressCode]);
      expect(await shipsTo((await post(`/api/v1/orders/${source.orderNo}/reorder`, { addressCode: "" })).json())).toEqual([undefined, source.addressCode]);
      // A code that is given still decides: another of their addresses is used, someone else's is refused.
      expect(await shipsTo(await tool(other.code))).toEqual([undefined, other.code]);
      expect(await shipsTo(await tool(foreign.code))).toEqual(["NOT_THEIR_ADDRESS", undefined]);
    } finally {
      await client.close();
    }
  });

  it("takes a return within the window, and refuses too many units, a closed window, an undelivered order and an unknown reason", async () => {
    const open = rows.orders
      .filter((o) => o.status === "delivered")
      .flatMap((o) => linesOf(o.orderNo).map((l) => ({ o, l })))
      .find(({ o, l }) => SPORTS_TODAY <= sportsReturnDeadline(o.deliveredOn!, windowOf(l.sku)) && l.qty - sportsReturnedQty(rows.returns, o.orderNo, l.sku) >= 1)!;
    const left = open.l.qty - sportsReturnedQty(rows.returns, open.o.orderNo, open.l.sku);
    const ask = { orderNo: open.o.orderNo, sku: open.l.sku, qty: left, reason: "Too Small" };
    expect((await post("/api/v1/returns", ask, false)).statusCode).toBe(401);
    const made = await post("/api/v1/returns", ask);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ orderNo: open.o.orderNo, sku: open.l.sku, qty: left, reason: "too small", requestedOn: SPORTS_TODAY, refundCents: left * open.l.unitPriceCents });
    expect((await get(`/api/v1/returns?orderNo=${open.o.orderNo}`)).some((r: { returnNo: string }) => r.returnNo === made.json().returnNo)).toBe(true);
    const refused = async (body: unknown) => {
      const r = await post("/api/v1/returns", body);
      return [r.statusCode, r.json().error];
    };
    expect(await refused({ ...ask, qty: 1 })).toEqual([422, "RETURN_QTY"]);
    const closed = rows.orders.filter((o) => o.status === "delivered").flatMap((o) => linesOf(o.orderNo).map((l) => ({ o, l }))).find(({ o, l }) => SPORTS_TODAY > sportsReturnDeadline(o.deliveredOn!, windowOf(l.sku)))!;
    expect(await refused({ ...ask, orderNo: closed.o.orderNo, sku: closed.l.sku, qty: 1 })).toEqual([422, "RETURN_WINDOW_CLOSED"]);
    const shipped = rows.orders.find((o) => o.status === "shipped")!;
    expect(await refused({ ...ask, orderNo: shipped.orderNo, sku: linesOf(shipped.orderNo)[0]!.sku, qty: 1 })).toEqual([422, "NOT_DELIVERED"]);
    expect(await refused({ ...ask, reason: "bored" })).toEqual([422, "BAD_REASON"]);
    expect(await refused({ ...ask, sku: "SP-999-BLK-42" })).toEqual([422, "NOT_IN_ORDER"]);
    expect(await refused({ ...ask, orderNo: "ORD-1" })).toEqual([404, "UNKNOWN_ORDER"]);
  });

  it("orders through the page form, shows a refusal's reason on the page, and cancels from the order page", async () => {
    const v = rows.variants.find((x) => x.stock >= 2)!;
    const customer = rows.customers[1]!;
    const address = rows.addresses.find((a) => a.customerEmail === customer.email)!;
    const page = await app.inject(scoped({ url: `/orders/new?customerEmail=${encodeURIComponent(customer.email)}&sku=${v.sku}`, headers: { cookie: `sp_session=${cookie}` } }));
    expect(page.body).toContain(`value="${address.code}"`);
    const made = await form("/orders", { customerEmail: customer.email, addressCode: address.code, sku1: v.sku, qty1: "1" });
    expect(made.statusCode).toBe(303);
    const at = made.headers.location as string;
    expect(at).toMatch(new RegExp(`^/w/${ws}/sports/orders/ORD-6\\d{4}$`));
    const no = at.split("/").pop()!;
    expect((await app.inject(scoped({ url: `/orders/${no}`, headers: { cookie: `sp_session=${cookie}` } }))).body).toContain("Cancel this order");
    const sold = rows.variants.find((x) => x.stock === 0)!;
    const refused = await form("/orders", { customerEmail: customer.email, addressCode: address.code, sku1: sold.sku, qty1: "1" });
    expect([refused.statusCode, refused.body.includes(`${sold.sku} is out of stock`)]).toEqual([409, true]);
    expect((await form(`/orders/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/orders/${no}`)).status).toBe("cancelled");
    const again = await form(`/orders/${no}/cancel`, {});
    expect([again.statusCode, again.body.includes("already cancelled")]).toEqual([409, true]);
  });

  it("carries only the orders page's own filters into its Next link, encoded, and never a query key the request made up", async () => {
    const delivered = rows.orders.filter((o) => o.status === "delivered").map((o) => o.orderNo).sort();
    expect(delivered.length).toBeGreaterThan(25);
    const hostile = `a"><script>alert(9471)</script>`;
    const res = await app.inject(scoped({ method: "GET", url: `/orders?status=delivered&${encodeURIComponent(hostile)}=1&placedFrom=2027-01-01` }));
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>alert(9471)");
    expect(res.body).not.toContain("9471");
    const href = /<nav class="pager"><a href="([^"]*)">Next page/.exec(res.body)?.[1];
    expect(href).toBe(`/w/${ws}/sports/orders?cursor=${delivered[24]}&status=delivered&placedFrom=2027-01-01`);
    const next = await app.inject(scoped({ method: "GET", url: href!.replace(`/w/${ws}/sports`, "") }));
    expect([...next.body.matchAll(/<td><a href="[^"]*">(ORD-\d+)<\/a>/g)].map((m) => m[1])).toEqual(delivered.slice(25));
    // The page itself, whatever it is handed: a value is encoded, a key that is not a filter is left out.
    const html = ordersList("/p", [], "ORD-1", { customerEmail: `a&b"<i>@example.com`, placedTo: "2027-06-30", cursor: "ORD-0", limit: "5", 'x"><b>': "1" });
    expect(/<nav class="pager"><a href="([^"]*)">/.exec(html)?.[1]).toBe(`/p/orders?cursor=ORD-1&customerEmail=${encodeURIComponent(`a&b"<i>@example.com`)}&placedTo=2027-06-30`);
    expect(html).not.toContain("<b>");
  });

  it("keeps its ledger: a read through REST and through a page, a write nobody may make, a write and a rule's refusal, each with its door and who was signed in", async () => {
    const no = [...rows.orders].reverse().find((x) => x.status === "processing")!.orderNo;
    const from = await ledgerEnd();
    await get(`/api/v1/orders/${no}`);
    await app.inject(scoped({ method: "GET", url: `/orders/${no}` }));
    // Nobody signed in: REST says 401, the page sends the visitor to sign in, and neither reaches the rules.
    expect((await post(`/api/v1/orders/${no}/cancel`, {}, false)).json()).toEqual({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    const sent = await app.inject(scoped({ method: "POST", url: `/orders/${no}/cancel` }));
    expect([sent.statusCode, sent.headers.location]).toEqual([302, `/w/${ws}/sports/login`]);
    expect((await post(`/api/v1/orders/${no}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/orders/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    const kept = (await ledger(from)).filter((e) => e.entity.type === "order");
    expect(kept.map((e) => [e.app, e.kind, e.entity.id, e.action, e.door, e.actor, e.outcome, e.code])).toEqual([
      ["sports", "read", no, "read", "rest", null, "ok", null],
      ["sports", "read", no, "read", "page", null, "ok", null],
      ["sports", "write", no, "cancel", "rest", null, "refused", "UNAUTHORIZED"],
      ["sports", "write", no, "cancel", "page", null, "refused", "UNAUTHORIZED"],
      ["sports", "write", no, "cancel", "rest", "buyer@example.com", "ok", null],
      ["sports", "write", no, "cancel", "rest", "buyer@example.com", "refused", "ALREADY_CANCELLED"],
    ]);
    // Each is stamped when it happened, in order.
    expect(kept.map((e) => Date.parse(e.at))).toEqual(kept.map((e) => Date.parse(e.at)).sort((a, b) => a - b));
    expect(Math.abs(Date.now() - Date.parse(kept[0]!.at))).toBeLessThan(60_000);
  });

  it("keeps a write and its ledger entry together: a cancel, or a sign-up, whose entry cannot be kept does not happen", async () => {
    const no = rows.orders.find((x) => x.status === "processing")!.orderNo;
    const email = "unkept@example.com";
    // For this test only, the ledger refuses the entry of a cancel and of a sign-up.
    await pool.query("ALTER TABLE sports.ledger ADD CONSTRAINT test_unkept CHECK (action NOT IN ('cancel', 'sign_up')) NOT VALID");
    try {
      expect((await post(`/api/v1/orders/${no}/cancel`, {})).statusCode).toBe(500);
      const signup = await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=U&email=${encodeURIComponent(email)}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }));
      expect(signup.statusCode).toBe(500);
    } finally {
      await pool.query("ALTER TABLE sports.ledger DROP CONSTRAINT test_unkept");
    }
    expect((await get(`/api/v1/orders/${no}`)).status).toBe("processing");
    expect((await pool.query("SELECT 1 FROM sports.users WHERE workspace_id = $1 AND email = $2", [ws, email])).rowCount).toBe(0);
  });

  it("names what a refused create was about: it has no entity id yet, and its subject says which one it was for", async () => {
    const order = rows.orders.find((o) => o.status === "processing")!.orderNo;
    const from = await ledgerEnd();
    const res = await post("/api/v1/returns", { orderNo: order, sku: rows.lines.find((l) => l.orderNo === order)!.sku, qty: 1, reason: "too small" });
    expect([res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 400, res.json().error]).toEqual([true, "NOT_DELIVERED"]);
    expect((await ledger(from)).map((e) => [e.kind, e.entity, e.subject, e.outcome, e.code])).toEqual([["write", { type: "return", id: null }, { type: "order", id: order }, "refused", "NOT_DELIVERED"]]);
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // The site's own tools, and the kit's for signing up and in.
      expect(names).toEqual(["cancel_order", "get_customer", "get_order", "get_product", "get_store_policies", "list_orders", "place_order", "reorder", "request_return", "search_products", ...SIGN_IN_TOOLS].sort());
      // A product the writes above never touched, so its stock is still the seed's.
      const res = (await client.callTool({ name: "search_products", arguments: { category: "climbing", inStock: true } })) as { content: { text: string }[] };
      const touched = new Set((await get("/api/v1/orders?status=processing&limit=200")).items.flatMap((o: { lines: { sku: string }[] }) => o.lines.map((l) => l.sku)));
      const live = JSON.parse(res.content[0]!.text) as { sku: string }[];
      expect(live.filter((o) => !touched.has(o.sku))).toEqual(searchSportsVariants(rows, { category: "climbing", inStock: true }).filter((o) => !touched.has(o.sku)));
      // A rule's refusal is the tool's answer for a caller who is signed in (here by the account's api token); nobody is refused before the rule is asked (below).
      const member = new Client({ name: "test", version: "0" });
      await member.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), authorization: `Bearer ${bearer}` } } }));
      const locked = (await member.callTool({ name: "cancel_order", arguments: { orderNo: rows.orders.find((o) => o.status === "delivered")!.orderNo } })) as { isError?: boolean; content: { text: string }[] };
      await member.close();
      expect([locked.isError, JSON.parse(locked.content[0]!.text).error]).toEqual([true, "NOT_CANCELLABLE"]);
      // A tool call is a door of its own in the ledger.
      const from = await ledgerEnd();
      await client.callTool({ name: "get_product", arguments: { productCode: rows.products[0]!.code } });
      expect((await ledger(from)).map((e) => [e.kind, e.entity.type, e.entity.id, e.door, e.outcome])).toEqual([["read", "product", rows.products[0]!.code, "mcp", "ok"]]);
      // The sign-in the pages and REST ask, asked here too: a write by nobody is refused before the rules are, and the ledger keeps it.
      const mark = await ledgerEnd();
      const refused = (await client.callTool({ name: "cancel_order", arguments: { orderNo: "NO-SUCH" } })) as { isError?: boolean; content: { text: string }[] };
      expect([refused.isError, JSON.parse(refused.content[0]!.text).error]).toEqual([true, "UNAUTHORIZED"]);
      expect((await ledger(mark)).map((e) => [e.door, e.kind, e.entity.type, e.entity.id, e.action, e.actor, e.outcome, e.code])).toEqual([["mcp", "write", "order", "NO-SUCH", "cancel", null, "refused", "UNAUTHORIZED"]]);
    } finally {
      await client.close();
    }
  });
});
