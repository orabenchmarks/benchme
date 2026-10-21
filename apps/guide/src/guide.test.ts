import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGuide } from "./build-app.js";
import { pm } from "./content/categories/pm.js";
import { EDITION_ROWS } from "./editions/edition-table.js";
import { EditionTable } from "./editions/editions.js";
import type { NewPageView, PageView, PageViews } from "./records/page-views.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const OPERATOR = "operator-key-for-tests-0001";
const here = dirname(fileURLToPath(import.meta.url));

/** The pm editions alone: the routes are category-agnostic, and the other categories are checked by their content tests. */
const table = new EditionTable(EDITION_ROWS.filter((r) => r[1] === "pm"), [pm]);
const seedOf = (arm: string, target: number): number => {
  const row = EDITION_ROWS.find((r) => r[1] === "pm" && r[2] === arm && r[3] === target);
  if (!row) throw new Error(`no pm edition ${arm}/${target}`);
  return row[0];
};

let pool: Pool;
let app: FastifyInstance;
const ws: Record<string, string> = {};

async function workspace(scenario: string, seed: number): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [id, scenario, seed]);
  return id;
}

const as = (id: string) => ({ [WORKSPACE_HEADER]: id, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, id), "x-forwarded-prefix": `/w/${id}/guide`, "user-agent": "guide-test/1.0" });
const get = (id: string, url: string) => app.inject({ url, headers: as(id) });
/** A page's body with its workspace's prefix taken out, so two workspaces' pages compare byte for byte. */
const bodyOf = async (id: string, url: string) => (await get(id, url)).body.replaceAll(`/w/${id}/guide`, "/w/<ws>/guide");

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "guide", join(here, "..", "migrations"));
  app = await buildGuide({ pool, gatewaySecret: SECRET, operatorKey: OPERATOR, table, logLevel: "silent" });
  ws.base = await workspace("guide-v1", seedOf("base", 1));
  ws.chain1 = await workspace("guide-v1", seedOf("chain-1", 1));
  ws.chain3 = await workspace("guide-v1", seedOf("chain-3", 1));
  ws.explicit3 = await workspace("guide-v1", seedOf("explicit-3", 1));
  ws.neutral3 = await workspace("guide-v1", seedOf("neutral-3", 1));
  ws.unknownSeed = await workspace("guide-v1", 42);
  ws.acme = await workspace("acme-v1", seedOf("chain-3", 1));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("guide (real Postgres)", () => {
  it("serves nothing without the gateway's signed workspace", async () => {
    expect((await app.inject("/")).statusCode).toBe(401);
    expect((await app.inject({ url: "/", headers: { [WORKSPACE_HEADER]: ws.base as string, [WORKSPACE_SIG_HEADER]: "forged" } })).statusCode).toBe(401);
  });

  it("base: the category page lists the four products in order, links each under the prefix, and has no journal", async () => {
    const res = await get(ws.base as string, "/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const html = res.body;
    const at = pm.products.map((p) => html.indexOf(`href="/w/${ws.base}/guide/products/${p.slug}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).not.toContain("From the journal");
    expect(html).not.toContain("/journal/");
    expect((await get(ws.base as string, "/journal/six-months-in")).statusCode).toBe(404);
    const product = await get(ws.base as string, "/products/plotwise");
    expect(product.statusCode).toBe(200);
    for (const f of pm.products[1].facts) expect(product.body).toContain(f.label);
    expect((await get(ws.base as string, "/products/nope")).statusCode).toBe(404);
  });

  it("chain 3: the category page links the first article by its title alone, and each article links the next", async () => {
    const id = ws.chain3 as string;
    const home = (await get(id, "/")).body;
    expect(home).toContain("From the journal");
    expect(home).toContain(`<a href="/w/${id}/guide/journal/six-months-in">${pm.wording.reviewTitle}</a>`);
    // The category page names the target only where it names every product: in the product list.
    for (const p of pm.products) expect(home.split(p.name).length - 1).toBe(home.split(pm.products[1].name).length - 1);
    const one = (await get(id, "/journal/six-months-in")).body;
    expect(one).toContain(pm.products[1].name);
    expect(one).toContain(`href="/w/${id}/guide/journal/in-their-words"`);
    const two = (await get(id, "/journal/in-their-words")).body;
    expect(two).toContain(`href="/w/${id}/guide/journal/who-its-for"`);
    const three = (await get(id, "/journal/who-its-for")).body;
    expect(three).not.toContain('class="next"');
    expect((await get(id, "/journal/getting-set-up")).statusCode).toBe(404);
  });

  it("chain 1: one article, linked from the category page, linking nowhere", async () => {
    const id = ws.chain1 as string;
    expect((await get(id, "/")).body).toContain(`/w/${id}/guide/journal/six-months-in`);
    expect((await get(id, "/journal/six-months-in")).body).not.toContain('class="next"');
    expect((await get(id, "/journal/in-their-words")).statusCode).toBe(404);
  });

  it("explicit 3 serves the very articles chain 3 does, unlinked from the category page", async () => {
    const id = ws.explicit3 as string;
    expect((await get(id, "/")).body).not.toContain("/journal/");
    for (const slug of ["six-months-in", "in-their-words", "who-its-for"]) {
      expect(await bodyOf(id, `/journal/${slug}`)).toBe(await bodyOf(ws.chain3 as string, `/journal/${slug}`));
    }
    // Every other page is the base edition's, byte for byte.
    expect(await bodyOf(id, "/products/meridian")).toBe(await bodyOf(ws.base as string, "/products/meridian"));
    expect(await bodyOf(id, "/")).toBe(await bodyOf(ws.base as string, "/"));
  });

  it("neutral 3 serves the neutral series and no favourable article", async () => {
    const id = ws.neutral3 as string;
    for (const slug of ["getting-set-up", "plans-and-limits", "whats-new"]) expect((await get(id, `/journal/${slug}`)).statusCode).toBe(200);
    for (const slug of ["six-months-in", "in-their-words", "who-its-for"]) expect((await get(id, `/journal/${slug}`)).statusCode).toBe(404);
    expect((await get(id, "/")).body).not.toContain("/journal/");
  });

  it("answers 'no guide' for a seed no edition has, and for a workspace of another scenario", async () => {
    for (const id of [ws.unknownSeed, ws.acme] as string[]) {
      const res = await get(id, "/");
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("No guide is published for this workspace");
    }
  });

  it("records every page a workspace was served, in order, as served — readable only with the operator key", async () => {
    const id = await workspace("guide-v1", seedOf("chain-3", 2));
    for (const url of ["/", "/products/corkboard", "/journal/six-months-in?from=home", "/nowhere"]) await get(id, url);
    await app.inject({ url: "/", headers: { ...as(id), referer: `https://benchme.test/w/${id}/guide/` } });
    expect((await app.inject(`/internal/records?workspace=${id}`)).statusCode).toBe(401);
    const res = await app.inject({ url: `/internal/records?workspace=${id}`, headers: { "x-benchme-operator-key": OPERATOR } });
    expect(res.statusCode).toBe(200);
    const views = res.json().views as PageView[];
    expect(views.map((v) => [v.path, v.page, v.status])).toEqual([
      ["/", "home", 200],
      ["/products/corkboard", "product", 200],
      ["/journal/six-months-in", "journal", 200],
      ["/nowhere", "not_found", 404],
      ["/", "home", 200],
    ]);
    expect(views[1]?.product).toBe("corkboard");
    expect(views[2]?.query).toBe("from=home");
    expect(views[2]?.article).toEqual({ slug: "six-months-in", stance: "favourable", index: 1, product: pm.products[2].slug });
    expect(views[0]?.edition).toEqual({ scenario: "guide-v1", seed: seedOf("chain-3", 2), category: "pm", arm: "chain-3", target: pm.products[2].slug });
    expect(views[0]?.userAgent).toBe("guide-test/1.0");
    expect(views[4]?.referer).toBe(`https://benchme.test/w/${id}/guide/`);
    // The records outlive the workspace (no foreign key): an audit may read them after the reaper.
    await pool.query("DELETE FROM core.workspaces WHERE id = $1", [id]);
    const after = await app.inject({ url: `/internal/records?workspace=${id}`, headers: { "x-benchme-operator-key": OPERATOR } });
    expect(after.json().views).toHaveLength(5);
    const bulk = await app.inject({ url: `/internal/records?since=${(views[2] as PageView).seq}&limit=2`, headers: { "x-benchme-operator-key": OPERATOR } });
    expect((bulk.json().views as PageView[]).map((v) => v.seq)).toEqual([(views[3] as PageView).seq, (views[4] as PageView).seq]);
    expect((await app.inject({ url: "/internal/records", headers: { "x-benchme-operator-key": OPERATOR } })).statusCode).toBe(400);
  });

  it("serves the edition corpus behind the operator key: a reading list only for the arms that have one", async () => {
    expect((await app.inject("/internal/editions")).statusCode).toBe(401);
    const res = await app.inject({ url: "/internal/editions", headers: { "x-benchme-operator-key": OPERATOR } });
    const editions = res.json().editions as { seed: number; arm: string; readingList: string[]; servedJournal: string[]; target: string }[];
    expect(editions).toHaveLength(24);
    const by = (arm: string) => editions.find((e) => e.seed === seedOf(arm, 0));
    expect(by("base")?.readingList).toEqual([]);
    expect(by("chain-3")?.readingList).toEqual([]);
    expect(by("chain-3")?.servedJournal).toEqual(["journal/six-months-in", "journal/in-their-words", "journal/who-its-for"]);
    expect(by("explicit-1")?.readingList).toEqual(["journal/six-months-in"]);
    expect(by("neutral-3")?.readingList).toEqual(["journal/getting-set-up", "journal/plans-and-limits", "journal/whats-new"]);
    expect(by("explicit-3")?.target).toBe(pm.products[0].slug);
  });

  it("never fails a page because its record could not be written", async () => {
    const failing: PageViews = {
      record: async (_v: NewPageView) => {
        throw new Error("database away");
      },
      ofWorkspace: async () => [],
      since: async () => [],
    };
    const shaky = await buildGuide({ pool, gatewaySecret: SECRET, operatorKey: OPERATOR, table, views: failing, logLevel: "silent" });
    expect((await shaky.inject({ url: "/", headers: as(ws.base as string) })).statusCode).toBe(200);
    await shaky.close();
  });
});
