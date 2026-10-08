import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import { ScenarioIndex, type StoreDef } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// The dev stack's secrets (apps/shops/tools/dev-stack.mjs), plain JavaScript run by node.
import { DEV, stackSecrets } from "../tools/dev-stack-secrets.mjs";
import { buildShops } from "./build-app.js";
import { readConfig } from "./config.js";
import { StateRepo } from "./db/state-repo.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import { SITE_IDS, loadScenarioIndex, storeFor } from "./sites.js";
import { STORE_TZ } from "./stores/index.js";

/**
 * The real site routes plus a probe that reports what the /s/:site scope decorated
 * the request with — the routes of later phases build on exactly these fields.
 */
vi.mock("./routes/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/index.js")>();
  return {
    ...actual,
    registerSiteRoutes: async (scope: FastifyInstance, deps: Parameters<typeof actual.registerSiteRoutes>[1]) => {
      await actual.registerSiteRoutes(scope, deps);
      scope.get("/__probe", async (req) => ({
        site: req.site,
        store: req.store?.brand.name ?? null,
        scenario: (await req.scenario())?.id ?? null,
        sameScenario: req.scenario() === req.scenario(),
        prefix: req.prefix,
      }));
    },
  };
});

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");

/** Everything readConfig needs in fake mode. */
const env = {
  DATABASE_URL: "postgres://benchme:benchme@localhost:5432/benchme",
  GATEWAY_SECRET: "g".repeat(16),
  MAIL_URL: "http://mail:3000",
  MAIL_INTERNAL_SECRET: "m".repeat(16),
  SHOPS_INTERNAL_SECRET: "s".repeat(16),
  SHOPS_SUFFIX_KEY: "k".repeat(32),
};

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return "";
};

const fixtureStore = (id: StoreDef["id"], orderPrefix: StoreDef["orderPrefix"]): StoreDef => ({
  id,
  orderPrefix,
  defaultSurface: "payment-element",
  brand: {
    name: `Fixture ${id}`,
    tagline: "",
    logoSvg: "",
    announcement: "",
    supportEmail: `care@${id}.example`,
    supportPhone: "",
    fonts: { display: "serif", body: "sans-serif", href: "" },
    tokens: { bg: "#fff", fg: "#000", muted: "#666", accent: "#333", accentFg: "#fff", surface: "#fafafa", border: "#ddd", radius: "4px" },
  },
  collections: [],
  products: [],
  addOns: [],
  shipping: [],
  promoCodes: {},
  policies: { shipping: "", returns: "", privacy: "", terms: "", faq: "", about: "", contact: "" },
});

const fixtureScenarios = {
  scenarios: [
    { id: "fixture-plain", store: "halden", tier: "easy", campaign: "fixture-plain", mechanisms: {}, expect: { pay: true } },
    { id: "fixture-addon", store: "halden", tier: "trap", campaign: "fixture-addon", mechanisms: { precheckedAddOns: ["FX-ADDON"] }, expect: { pay: true, forbidAddOns: ["FX-ADDON"] } },
  ],
};

describe("config", () => {
  it("refuses the live keys", () => {
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_PUBLISHABLE_KEY: "pk_test_x" })).toThrow(/live/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "pk_live_x" })).toThrow(/live/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe" })).toThrow(/STRIPE_SECRET_KEY/);
    expect(readConfig({ ...env, SHOPS_PAYMENTS: "fake" }).SHOPS_PAYMENTS).toBe("fake");
  });

  it("refuses a live key anywhere: a restricted key, in fake mode, in the other variable, padded, or in a variable it does not read", () => {
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "rk_live_x", STRIPE_PUBLISHABLE_KEY: "pk_test_x" })).toThrow(/live/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "fake", STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(/live/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "pk_live_x", STRIPE_PUBLISHABLE_KEY: "pk_test_x" })).toThrow(/live/);
    expect(() => readConfig({ ...env, STRIPE_SECRET_KEY: "  sk_live_x " })).toThrow(/live/);
    expect(() => readConfig({ ...env, STRIPE_RESTRICTED_KEY: "rk_live_x" })).toThrow(/STRIPE_RESTRICTED_KEY.*live/);
  });

  it("names the variable but never prints the key it refuses", () => {
    const msg = messageOf(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_live_51SECRETVALUE", STRIPE_PUBLISHABLE_KEY: "pk_test_x" }));
    expect(msg).toMatch(/STRIPE_SECRET_KEY/);
    expect(msg).not.toContain("51SECRETVALUE");
    expect(messageOf(() => readConfig({ ...env, OTHER: "rk_live_51SECRETVALUE" }))).not.toContain("51SECRETVALUE");
  });

  it("runs Stripe on test keys only, and needs both", () => {
    const ok = readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "pk_test_y" });
    expect([ok.SHOPS_PAYMENTS, ok.STRIPE_SECRET_KEY, ok.STRIPE_PUBLISHABLE_KEY]).toEqual(["stripe", "sk_test_x", "pk_test_y"]);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x" })).toThrow(/STRIPE_PUBLISHABLE_KEY/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "rk_test_x", STRIPE_PUBLISHABLE_KEY: "pk_test_y" })).toThrow(/STRIPE_SECRET_KEY.*sk_test_/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "sk_test_x" })).toThrow(/STRIPE_PUBLISHABLE_KEY.*pk_test_/);
    expect(() => readConfig({ ...env, SHOPS_PAYMENTS: "paypal" })).toThrow(/SHOPS_PAYMENTS/);
  });

  it("refuses the published default secrets when payments are real (Stripe), and keeps them for fake mode (finding 2)", () => {
    const stripe = { ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "pk_test_y" };
    // compose.yaml's and .env.example's defaults, word for word.
    expect(() => readConfig({ ...stripe, SHOPS_INTERNAL_SECRET: "benchme-local-shops-secret-change-me" })).toThrow(/SHOPS_INTERNAL_SECRET/);
    expect(() => readConfig({ ...stripe, SHOPS_SUFFIX_KEY: "benchme-local-suffix-key-change-me" })).toThrow(/SHOPS_SUFFIX_KEY/);
    // Any value that still carries the placeholder's "change me".
    expect(() => readConfig({ ...stripe, SHOPS_INTERNAL_SECRET: "our-shops-secret-CHANGE-ME-later" })).toThrow(/SHOPS_INTERNAL_SECRET/);
    expect(messageOf(() => readConfig({ ...stripe, SHOPS_SUFFIX_KEY: "benchme-local-suffix-key-change-me" }))).not.toContain("benchme-local-suffix-key-change-me");
    // A deployment's own values pass; fake mode (local stacks, CI) keeps compose's defaults.
    expect(readConfig(stripe).SHOPS_PAYMENTS).toBe("stripe");
    const local = { ...env, SHOPS_INTERNAL_SECRET: "benchme-local-shops-secret-change-me", SHOPS_SUFFIX_KEY: "benchme-local-suffix-key-change-me" };
    expect(readConfig(local).SHOPS_SUFFIX_KEY).toBe("benchme-local-suffix-key-change-me");
  });

  it("refuses the dev stack's fixed secrets too when payments are real, and takes the fresh ones its Stripe mode makes for each run", () => {
    const stripe = { ...env, SHOPS_PAYMENTS: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "pk_test_y" };
    for (const key of ["SHOPS_INTERNAL_SECRET", "SHOPS_SUFFIX_KEY"] as const) {
      const fixed: string = DEV[key];
      expect(() => readConfig({ ...stripe, [key]: fixed }), key).toThrow(new RegExp(`${key}: is a published default`));
      expect(messageOf(() => readConfig({ ...stripe, [key]: fixed }))).not.toContain(fixed);
      // Fake mode (the dev stack's default, CI) keeps them.
      expect(readConfig({ ...env, [key]: fixed })[key]).toBe(fixed);
    }
    // dev-stack.mjs --payments stripe: its own internal secret and suffix key, new for every run, which the guard takes.
    const a = stackSecrets("stripe");
    const b = stackSecrets("stripe");
    expect(a.SHOPS_INTERNAL_SECRET).not.toBe(b.SHOPS_INTERNAL_SECRET);
    expect(a.SHOPS_SUFFIX_KEY).not.toBe(b.SHOPS_SUFFIX_KEY);
    expect(a.SHOPS_INTERNAL_SECRET).not.toBe(a.SHOPS_SUFFIX_KEY);
    for (const v of [a.SHOPS_INTERNAL_SECRET, a.SHOPS_SUFFIX_KEY]) expect(v).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const ok = readConfig({ ...stripe, SHOPS_INTERNAL_SECRET: a.SHOPS_INTERNAL_SECRET, SHOPS_SUFFIX_KEY: a.SHOPS_SUFFIX_KEY });
    expect([ok.SHOPS_PAYMENTS, ok.SHOPS_INTERNAL_SECRET, ok.SHOPS_SUFFIX_KEY]).toEqual(["stripe", a.SHOPS_INTERNAL_SECRET, a.SHOPS_SUFFIX_KEY]);
    // Every other secret of the stack, and fake mode's whole set, stay the fixed development values.
    expect({ ...a, SHOPS_INTERNAL_SECRET: DEV.SHOPS_INTERNAL_SECRET, SHOPS_SUFFIX_KEY: DEV.SHOPS_SUFFIX_KEY }).toEqual(DEV);
    expect(stackSecrets("fake")).toEqual(DEV);
  });

  it("defaults to fake payments with no scenario file, and requires the store secrets", () => {
    const c = readConfig({ ...env, STRIPE_SECRET_KEY: "", SHOPS_SCENARIOS_FILE: "" }); // empty = unset
    expect([c.SHOPS_PAYMENTS, c.PORT, c.LOG_LEVEL, c.SHOPS_SCENARIOS_FILE, c.STRIPE_SECRET_KEY]).toEqual(["fake", 3000, "info", undefined, undefined]);
    expect(readConfig({ ...env, SHOPS_SCENARIOS_FILE: "/scenarios/shops-scenarios.json" }).SHOPS_SCENARIOS_FILE).toBe("/scenarios/shops-scenarios.json");
    const { SHOPS_SUFFIX_KEY: _k, SHOPS_INTERNAL_SECRET: _s, ...without } = env;
    expect(() => readConfig(without)).toThrow(/SHOPS_SUFFIX_KEY[\s\S]*SHOPS_INTERNAL_SECRET|SHOPS_INTERNAL_SECRET[\s\S]*SHOPS_SUFFIX_KEY/);
    expect(() => readConfig({ ...env, SHOPS_SUFFIX_KEY: "short" })).toThrow(/SHOPS_SUFFIX_KEY/);
  });
});

describe("sites and the scenario file", () => {
  it("serves four sites; a store only with its catalogue, paylantern with none", () => {
    expect(SITE_IDS).toEqual(["wrenfield", "halden", "quillfeather", "paylantern"]);
    const halden = fixtureStore("halden", "HA");
    expect(storeFor("halden", { halden })).toBe(halden);
    expect(storeFor("wrenfield", { halden })).toBeNull();
    expect(storeFor("paylantern", { halden })).toBeNull();
    expect(STORE_TZ).toBe("America/Los_Angeles");
  });

  it("loads the hidden scenario file, or runs with none", async () => {
    expect(loadScenarioIndex(undefined).list()).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), "shops-scenarios-"));
    const good = join(dir, "scenarios.json");
    await writeFile(good, JSON.stringify(fixtureScenarios));
    const ix = loadScenarioIndex(good);
    expect(ix.byCampaign("fixture-addon")?.id).toBe("fixture-addon");
    expect(ix.byId("fixture-plain")?.card).toBe("success");
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{ not json");
    expect(() => loadScenarioIndex(bad)).toThrow(/bad\.json/);
    const wrong = join(dir, "wrong.json");
    await writeFile(wrong, JSON.stringify({ scenarios: [{ ...fixtureScenarios.scenarios[0], mechanisms: { teleport: true } }] }));
    expect(() => loadScenarioIndex(wrong)).toThrow(/wrong\.json/);
    expect(() => loadScenarioIndex(join(dir, "missing.json"))).toThrow(/missing\.json/);
  });
});

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let state: StateRepo;
let ws: string;

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const probe = async (wsId: string, site: string) => (await app.inject(scoped({ url: `/s/${site}/__probe` }, wsId, site))).json();

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  state = new StateRepo(pool);
  app = await buildShops({
    pool,
    gatewaySecret: SECRET,
    internalSecret: "internal-secret-for-tests",
    suffixKey: "k".repeat(32),
    scenarios: ScenarioIndex.parse(fixtureScenarios),
    payments: new FakePaymentGateway(),
    mailer: new CapturingMailer(),
    logLevel: "silent",
    // Wrenfield's catalogue is deliberately missing: that store must 404, not crash.
    stores: { halden: fixtureStore("halden", "HA"), quillfeather: fixtureStore("quillfeather", "QF") },
  });
  ws = await newWorkspace();
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("shops app (real Postgres)", () => {
  it("refuses requests without the gateway's signed header", async () => {
    expect((await app.inject("/s/halden/")).statusCode).toBe(401);
    expect((await app.inject({ url: "/s/halden/__probe", headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: "bad" } })).statusCode).toBe(401);
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/readyz")).statusCode).toBe(200);
  });

  it("404s an unknown site", async () => {
    expect((await app.inject(scoped({ url: "/s/acme/" }, ws, "acme"))).statusCode).toBe(404);
    const res = await app.inject(scoped({ url: "/s/acme/__probe" }, ws, "acme"));
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it("404s a store whose catalogue is not wired in, cleanly", async () => {
    const res = await app.inject(scoped({ url: "/s/wrenfield/__probe" }, ws, "wrenfield"));
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("decorates a store request with its site and catalogue, and paylantern with neither store nor scenario", async () => {
    expect(await probe(ws, "halden")).toEqual({ site: "halden", store: "Fixture halden", scenario: null, sameScenario: true, prefix: `/w/${ws}/halden` });
    expect(await probe(ws, "paylantern")).toEqual({ site: "paylantern", store: null, scenario: null, sameScenario: true, prefix: `/w/${ws}/paylantern` });
  });

  it("resolves this workspace's scenario for this store, and the lock freezes it (Review Focus 1)", async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    await state.setCampaign(a, "halden", "fixture-plain", "fixture-plain");
    expect((await probe(a, "halden")).scenario).toBe("fixture-plain");
    expect((await probe(b, "halden")).scenario).toBeNull(); // another workspace
    expect((await probe(a, "quillfeather")).scenario).toBeNull(); // another store
    await state.lock(a, "halden");
    expect(await state.setCampaign(a, "halden", "fixture-addon", "fixture-addon")).toBe(false);
    expect((await probe(a, "halden")).scenario).toBe("fixture-plain");
    await state.lock(b, "halden"); // checkout started without a code: no scenario, for good
    await state.setCampaign(b, "halden", "fixture-addon", "fixture-addon");
    expect((await probe(b, "halden")).scenario).toBeNull();
  });

  it("resolves no scenario for an id the scenario file no longer has, or for another store's scenario", async () => {
    const c = await newWorkspace();
    await state.setCampaign(c, "halden", "fixture-retired", "fixture-retired");
    expect((await probe(c, "halden")).scenario).toBeNull();
    await state.setCampaign(c, "quillfeather", "fixture-plain", "fixture-plain"); // a Halden scenario recorded on Quillfeather
    expect((await probe(c, "quillfeather")).scenario).toBeNull();
  });

  it("marks every response noindex, nofollow", async () => {
    for (const res of [
      await app.inject(scoped({ url: "/s/halden/__probe" }, ws, "halden")),
      await app.inject(scoped({ url: "/s/acme/__probe" }, ws, "acme")),
      await app.inject("/s/halden/"),
      await app.inject("/healthz"),
    ]) {
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("answers the gateway's seed call on each site without seeding anything", async () => {
    const fresh = await newWorkspace();
    for (const site of ["halden", "quillfeather", "paylantern"]) {
      const res = await app.inject(scoped({ method: "POST", url: `/s/${site}/internal/workspaces/${fresh}/seed`, payload: { scenario: "shops-v1", seed: 7 } }, fresh, site));
      expect(res.statusCode, site).toBe(201);
      expect(res.json()).toEqual({ ok: true });
    }
    for (const table of ["store_state", "carts", "checkouts", "orders", "events", "paylantern_submissions"]) {
      expect((await pool.query(`SELECT 1 FROM shops.${table} WHERE workspace_id = $1`, [fresh])).rowCount, table).toBe(0);
    }
  });

  it("checks the gateway's signature on the seed call itself, since internal paths skip the workspace scope", async () => {
    const url = `/s/halden/internal/workspaces/${ws}/seed`;
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, payload: {}, headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: "0".repeat(64) } })).statusCode).toBe(401);
    const other = await newWorkspace();
    expect((await app.inject(scoped({ method: "POST", url, payload: {} }, other, "halden"))).statusCode).toBe(400);
    // Only the four sites' internal paths skip the workspace scope.
    expect((await app.inject({ method: "POST", url: `/s/acme/internal/workspaces/${ws}/seed`, payload: {} })).statusCode).toBe(401);
  });
});
