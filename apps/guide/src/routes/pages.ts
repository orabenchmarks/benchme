import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { articleAt } from "../editions/editions.js";
import type { EditionResolver } from "../editions/resolver.js";
import { articlePage, homePage, noEditionPage, notFoundPage, productPage } from "../render/pages.js";

const sendHtml = (reply: FastifyReply, status: number, html: string): FastifyReply =>
  reply.code(status).header("cache-control", "private, no-cache").type("text/html; charset=utf-8").send(html);

/**
 * The guide's public pages. Each route labels what it served on `req.guideView`, which the recorder writes: a page is
 * recorded as what the route decided it was, never re-derived from its path afterwards.
 */
export function registerPages(app: FastifyInstance, editions: EditionResolver): void {
  const editionOf = async (req: FastifyRequest, reply: FastifyReply) => {
    const e = await editions.forWorkspace(req.workspaceId);
    if (!e) {
      req.guideView = { page: "no_edition", edition: null };
      sendHtml(reply, 404, noEditionPage(req.prefix));
    }
    return e;
  };

  app.get("/", async (req, reply) => {
    const e = await editionOf(req, reply);
    if (!e) return reply;
    req.guideView = { page: "home", edition: e };
    return sendHtml(reply, 200, homePage(e, req.prefix));
  });

  app.get<{ Params: { slug: string } }>("/products/:slug", async (req, reply) => {
    const e = await editionOf(req, reply);
    if (!e) return reply;
    const p = e.category.products.find((x) => x.slug === req.params.slug);
    if (!p) {
      req.guideView = { page: "not_found", edition: e };
      return sendHtml(reply, 404, notFoundPage(req.prefix));
    }
    req.guideView = { page: "product", product: p.slug, edition: e };
    return sendHtml(reply, 200, productPage(e, p, req.prefix));
  });

  app.get<{ Params: { slug: string } }>("/journal/:slug", async (req, reply) => {
    const e = await editionOf(req, reply);
    if (!e) return reply;
    const a = articleAt(e, req.params.slug);
    if (!a) {
      req.guideView = { page: "not_found", edition: e };
      return sendHtml(reply, 404, notFoundPage(req.prefix));
    }
    req.guideView = { page: "journal", article: { slug: a.slug, stance: a.stance, index: a.index, product: a.product }, edition: e };
    return sendHtml(reply, 200, articlePage(e, a, req.prefix));
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (!req.workspaceId) return reply.code(404).send({ error: "NOT_FOUND" });
    req.guideView = { page: "not_found", edition: await editions.forWorkspace(req.workspaceId) };
    return sendHtml(reply, 404, notFoundPage(req.prefix));
  });
}
