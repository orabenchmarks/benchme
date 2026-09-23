import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { acmeV1, documentsMatching, scenarios, type ScenarioRows } from "@benchme/scenarios";
import { LexicalRanker } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVaultdocs } from "./build-app.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
let pool: Pool;
let app: FastifyInstance;
let ws: string;
let rows: ScenarioRows;
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }): InjectOptions => ({ ...o, headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/vaultdocs` } });

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "vaultdocs", join(here, "..", "migrations"));
  app = await buildVaultdocs({ pool, scenarios, gatewaySecret: SECRET, ranker: new LexicalRanker(), logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = acmeV1.generate(4242);
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "acme-v1", seed: 4242 } }))).statusCode).toBe(201);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("vaultdocs (real Postgres full-text search)", () => {
  it("lists and reads the seeded documents; search finds the results-summary memo by its headcount", async () => {
    const list = (await app.inject(scoped({ url: "/api/v1/documents" }))).json() as { id: string }[];
    expect(list.map((d) => d.id).sort()).toEqual(rows.vault.documents.map((d) => d.id).sort());
    const memo = rows.vault.documents.find((d) => d.title === "FY2025 results summary")!;
    const hits = (await app.inject(scoped({ url: `/api/v1/search?q=${encodeURIComponent("FY2025 revenue employees")}` }))).json() as { id: string; snippet: string }[];
    expect(hits.map((h) => h.id)).toContain(memo.id);
    expect(hits[0]!.snippet).toMatch(/<b>/);
    const doc = (await app.inject(scoped({ url: `/api/v1/documents/${memo.id}` }))).json();
    expect(doc.body).toContain(String(rows.company.employees));
    // the derived-answer helper and the database agree on an exact-word query
    const q = "credit note";
    const dbIds = ((await app.inject(scoped({ url: `/api/v1/search?q=${encodeURIComponent(`"${q}"`)}&limit=50` }))).json() as { id: string }[]).map((h) => h.id).sort();
    expect(dbIds).toEqual(documentsMatching(rows, q));
    expect((await app.inject(scoped({ url: "/api/v1/documents/doc-999" }))).statusCode).toBe(404);
  });

  it("exposes resources, tools and prompts over MCP", async () => {
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const resources = await client.listResources();
      expect(resources.resources.length).toBe(rows.vault.documents.length);
      const first = rows.vault.documents[0]!;
      const read = await client.readResource({ uri: `docs://${first.id}` });
      expect((read.contents[0] as { text: string }).text).toContain(first.title);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual(["get_document", "list_documents", "search"]);
      expect(tools.tools).toHaveLength(3);
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((p) => p.name).sort()).toEqual(["answer_from_docs", "summarize_document"]);
      const prompt = await client.getPrompt({ name: "answer_from_docs", arguments: { question: "What is the return window?" } });
      expect((prompt.messages[0]!.content as { text: string }).text).toContain("return window");
      const search = await client.callTool({ name: "search", arguments: { query: "warranty" } });
      expect(JSON.parse((search.content as { text: string }[])[0]!.text).length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  it("renders the UI", async () => {
    const home = (await app.inject(scoped({ url: "/" }))).body;
    expect(home).toContain("Document vault");
    expect(home).toContain('data-webmcp="bridge"');
    expect(home).toContain('"name":"search"');
    expect((await app.inject(scoped({ url: "/search?q=warranty" }))).body).toContain("<b>");
  });

  it("/ask ranks the seeded documents and agrees with documentsMatching", async () => {
    const prefix = `/w/${ws}/vaultdocs`;
    const res = await app.inject(scoped({ method: "GET", url: "/ask?query=faq&streaming=false" }));
    expect(res.statusCode).toBe(200);
    const ids = res.json().results.map((r: { schema_object: { "@id": string } }) => r.schema_object["@id"]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set(documentsMatching(rows, "faq").map((id) => `${prefix}/documents/${id}`)));
  });

  it("the schema feed is deterministic for a seed and every line is JSON-LD", async () => {
    const a = (await app.inject(scoped({ method: "GET", url: "/schema/feed.jsonl" }))).body;
    const b = (await app.inject(scoped({ method: "GET", url: "/schema/feed.jsonl" }))).body;
    expect(a).toBe(b);
    for (const line of a.trim().split("\n")) expect(JSON.parse(line)).toMatchObject({ "@context": "https://schema.org" });
  });

  it("publishes the schemamap directive on robots.txt", async () => {
    const robots = (await app.inject(scoped({ method: "GET", url: "/robots.txt", headers: { host: "gw.test" } }))).body;
    expect(robots).toContain(`schemamap: http://gw.test/w/${ws}/vaultdocs/schema/map.xml`);
  });
});
