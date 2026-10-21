import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EditionResolver } from "../editions/resolver.js";
import { hopOf, type NetworkEdition } from "./editions.js";
import { networkNotFoundPage, noNetworkPage, sitePage, startPage, vendorPage } from "./pages.js";

const sendHtml = (reply: FastifyReply, status: number, html: string): FastifyReply =>
  reply.code(status).header("cache-control", "private, no-cache").type("text/html; charset=utf-8").send(html);

/** The network's prefix inside the app: the gateway's `web` target is this app's /web (APP_TARGETS). */
export const NETWORK_MOUNT = "/web";

/**
 * The site network's pages, under /web: the start page at /, and at /<slug>/ either a candidate's own vendor site or a
 * recommendation site the edition serves. Each route labels what it served on `req.guideView`, which the recorder
 * writes — a site page with its key and the hop it was served at.
 */
export function registerNetwork(app: FastifyInstance, editions: EditionResolver<NetworkEdition>): void {
  app.register(
    async (web) => {
      const editionOf = async (req: FastifyRequest, reply: FastifyReply) => {
        const e = await editions.forWorkspace(req.workspaceId);
        if (!e) {
          req.guideView = { page: "no_edition", edition: null };
          sendHtml(reply, 404, noNetworkPage(req.prefix));
        }
        return e;
      };

      web.get("/", async (req, reply) => {
        const e = await editionOf(req, reply);
        if (!e) return reply;
        req.guideView = { page: "entry", edition: e };
        return sendHtml(reply, 200, startPage(e, req.prefix));
      });

      const slugPage = async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
        const e = await editionOf(req, reply);
        if (!e) return reply;
        const { slug } = req.params;
        const product = e.category.products.find((p) => p.slug === slug);
        if (product) {
          req.guideView = { page: "vendor", product: product.slug, edition: e };
          return sendHtml(reply, 200, vendorPage(e, product, req.prefix));
        }
        const hop = hopOf(e, slug);
        const site = hop ? e.chain[hop - 1] : undefined;
        if (!hop || !site) {
          req.guideView = { page: "not_found", edition: e };
          return sendHtml(reply, 404, networkNotFoundPage(req.prefix));
        }
        req.guideView = { page: "site", product: e.target.slug, site: { key: site.key, hop }, edition: e };
        return sendHtml(reply, 200, sitePage(e, site, hop, req.prefix));
      };
      web.get<{ Params: { slug: string } }>("/:slug", slugPage);
      web.get<{ Params: { slug: string } }>("/:slug/", slugPage);

      web.setNotFoundHandler(async (req, reply) => {
        if (!req.workspaceId) return reply.code(404).send({ error: "NOT_FOUND" });
        req.guideView = { page: "not_found", edition: await editions.forWorkspace(req.workspaceId) };
        return sendHtml(reply, 404, networkNotFoundPage(req.prefix));
      });
    },
    { prefix: NETWORK_MOUNT },
  );
}
