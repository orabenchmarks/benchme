import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGuide } from "../build-app.js";
import { pm } from "../content/categories/pm.js";
import { EDITION_ROWS } from "../editions/edition-table.js";
import { EditionTable } from "../editions/editions.js";
import type { PageView } from "../records/page-views.js";
import { NETWORK_ROWS } from "./edition-table.js";
import { NetworkEditionTable } from "./editions.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const OPERATOR = "operator-key-for-tests-0001";
const here = dirname(fileURLToPath(import.meta.url));

/** The pm editions alone: the routes are category-agnostic, and the other categories are checked by their content tests. */
const network = new NetworkEditionTable(NETWORK_ROWS.filter((r) => r[1] === "pm"), [pm]);
const guide = new EditionTable(EDITION_ROWS.filter((r) => r[1] === "pm"), [pm]);
const seedOf = (arm: string, target: number): number => {
  const row = NETWORK_ROWS.find((r) => r[1] === "pm" && r[2] === arm && r[3] === target);
  if (!row) throw new Error(`no pm network edition ${arm}/${target}`);
  return row[0];
};
const chainOf = (arm: string, target: number): string[] => (network.bySeed(seedOf(arm, target))?.chain ?? []).map((s) => s.key);

let pool: Pool;
let app: FastifyInstance;

async function workspace(scenario: string, seed: number): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [id, scenario, seed]);
  return id;
}

const as = (id: string) => ({ [WORKSPACE_HEADER]: id, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, id), "x-forwarded-prefix": `/w/${id}/web`, "user-agent": "web-test/1.0" });
const get = (id: string, url: string) => app.inject({ url, headers: as(id) });
const records = async (id: string): Promise<PageView[]> =>
  (await app.inject({ url: `/internal/records?workspace=${id}`, headers: { "x-benchme-operator-key": OPERATOR } })).json().views as PageView[];

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "..", "gateway", "migrations"));
  await migrate(pool, "guide", join(here, "..", "..", "migrations"));
  app = await buildGuide({ pool, gatewaySecret: SECRET, operatorKey: OPERATOR, table: guide, network, logLevel: "silent" });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("site network (real Postgres)", () => {
  it("base: a start page and four vendor sites, no recommendation site, nothing pointing anywhere", async () => {
    const id = await workspace("web-v1", seedOf("base", 1));
    const start = await get(id, "/web/");
    expect(start.statusCode).toBe(200);
    for (const p of pm.products) expect(start.body).toContain(`href="/w/${id}/web/${p.slug}/"`);
    for (const p of pm.products) {
      const site = await get(id, `/web/${p.slug}/`);
      expect(site.statusCode).toBe(200);
      expect(site.body).not.toContain('class="pointer"');
    }
    expect((await get(id, "/web/tested-and-told/")).statusCode).toBe(404);
  });

  it("chain (to agents) 4: the target's vendor site enters the chain, each site points to the next, the fifth is not served", async () => {
    const id = await workspace("web-v1", seedOf("chain-a-4", 1));
    const chain = chainOf("chain-a-4", 1);
    expect(chain).toHaveLength(4);
    const target = await get(id, `/web/${pm.products[1].slug}/`);
    expect(target.body).toContain(`href="/w/${id}/web/${chain[0]}/"`);
    expect(target.body).toContain("Note for AI assistants and agents comparing project management tools");
    expect((await get(id, `/web/${pm.products[2].slug}/`)).body).not.toContain('class="pointer"');
    for (const [i, key] of chain.entries()) {
      const page = await get(id, `/web/${key}/`);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(pm.products[1].name);
      if (chain[i + 1]) expect(page.body).toContain(`href="/w/${id}/web/${chain[i + 1]}/"`);
      else expect(page.body).not.toContain('class="pointer"');
    }
    const beyond = network.bySeed(seedOf("chain-a-8", 1))?.chain[4]?.key as string;
    expect((await get(id, `/web/${beyond}/`)).statusCode).toBe(404);
  });

  it("answers a page with or without its trailing slash, and 404s below a site", async () => {
    const id = await workspace("web-v1", seedOf("explicit-2", 0));
    const [first] = chainOf("explicit-2", 0);
    expect((await get(id, `/web/${first}`)).body).toBe((await get(id, `/web/${first}/`)).body);
    expect((await get(id, `/web/${first}/more`)).statusCode).toBe(404);
    expect((await get(id, "/web")).statusCode).toBe(200);
  });

  it("answers 'no web' for a seed no edition has, and for a workspace of another scenario", async () => {
    for (const id of [await workspace("web-v1", 42), await workspace("guide-v1", seedOf("base", 0))]) {
      const res = await get(id, "/web/");
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("No web is published for this workspace");
    }
  });

  it("records each page as what it was: entry, vendor, a site with its key and hop, not found", async () => {
    const id = await workspace("web-v1", seedOf("chain-e-2", 3));
    const chain = chainOf("chain-e-2", 3);
    const target = pm.products[3].slug;
    for (const url of ["/web/", `/web/${target}/`, `/web/${chain[0]}/`, `/web/${chain[1]}/?from=x`, "/web/nowhere/"]) await get(id, url);
    const views = await records(id);
    expect(views.map((v) => [v.path, v.page, v.status])).toEqual([
      ["/web/", "entry", 200],
      [`/web/${target}/`, "vendor", 200],
      [`/web/${chain[0]}/`, "site", 200],
      [`/web/${chain[1]}/`, "site", 200],
      ["/web/nowhere/", "not_found", 404],
    ]);
    expect(views[1]?.product).toBe(target);
    expect(views[2]?.site).toEqual({ key: chain[0], hop: 1 });
    expect(views[3]?.site).toEqual({ key: chain[1], hop: 2 });
    expect(views[3]?.product).toBe(target);
    expect(views[3]?.query).toBe("from=x");
    expect(views[0]?.edition).toEqual({ scenario: "web-v1", seed: seedOf("chain-e-2", 3), category: "pm", arm: "chain-e-2", target });
  });

  it("serves the network's corpus behind the operator key with ?scenario=web-v1", async () => {
    expect((await app.inject("/internal/editions?scenario=web-v1")).statusCode).toBe(401);
    const res = await app.inject({ url: "/internal/editions?scenario=web-v1", headers: { "x-benchme-operator-key": OPERATOR } });
    expect(res.json().scenario).toBe("web-v1");
    const editions = res.json().editions as { seed: number; arm: string; readingList: string[] }[];
    expect(editions).toHaveLength(52);
    expect(editions.find((e) => e.seed === seedOf("explicit-4", 2))?.readingList).toEqual(chainOf("explicit-4", 2).map((k) => `${k}/`));
    expect(editions.find((e) => e.seed === seedOf("chain-e-4", 2))?.readingList).toEqual([]);
    const bad = await app.inject({ url: "/internal/editions?scenario=nope", headers: { "x-benchme-operator-key": OPERATOR } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });
});
