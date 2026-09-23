import type { FastifyInstance, FastifyRequest } from "fastify";
import { esc } from "../html.js";
import type { AskDeps } from "./types.js";

/**
 * The crawler-facing half of NLWeb: a JSONL schema feed, a schema map pointing
 * at it, and the robots.txt `schemamap:` directive that lets an agent discover
 * both from the site root alone — no out-of-band configuration.
 */
export type SchemaDeps = AskDeps & { publicBaseUrl: (req: FastifyRequest) => string };

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const SCHEMA_FEED_NS = "http://schema.org/schemas/schemafeed/0.1";

export function registerSchemaRoutes(app: FastifyInstance, d: SchemaDeps): void {
  const now = d.now ?? (() => new Date());

  // One JSON-LD object per line: a consumer streams it and never has to hold
  // the whole corpus (or a well-formed enclosing array) in memory.
  app.get("/schema/feed.jsonl", async (req, reply) => {
    const items = await d.items(req.workspaceId, req.prefix);
    return reply.type("application/jsonl; charset=utf-8").send(items.map((i) => `${JSON.stringify(i.schema)}\n`).join(""));
  });

  app.get("/schema/map.xml", async (req, reply) => {
    const base = d.publicBaseUrl(req);
    const lastmod = now().toISOString().slice(0, 10);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="${SITEMAP_NS}" xmlns:sf="${SCHEMA_FEED_NS}">
  <url>
    <loc>${esc(base)}/schema/feed.jsonl</loc>
    <lastmod>${lastmod}</lastmod>
    <sf:contentType>structuredData/schema.org</sf:contentType>
  </url>
</urlset>
`;
    return reply.type("application/xml; charset=utf-8").send(xml);
  });

  // /account is the one authenticated area; everything else is meant to be read.
  app.get("/robots.txt", async (req, reply) => {
    const base = d.publicBaseUrl(req);
    return reply.type("text/plain; charset=utf-8").send(`User-agent: *\nDisallow: /account\nschemamap: ${base}/schema/map.xml\n`);
  });
}
