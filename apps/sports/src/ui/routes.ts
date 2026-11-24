import { registerAuthRoutes, sessionUser, shell, webmcpBridge, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { searchSchema, toSearch } from "../api/inputs.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import * as pages from "./catalog-pages.js";
import { flat, type PageKit } from "./kit.js";
import { registerOrderUi } from "./order-routes.js";

export const SESSION_COOKIE = "sp_session";
export type UiDeps = { catalog: CatalogRepo; orders: OrdersRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };
const NAV = [
  { href: "/", label: "Search" },
  { href: "/products", label: "Products" },
  { href: "/customers", label: "Customers" },
  { href: "/orders", label: "Orders" },
  { href: "/policies", label: "Policies" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Brackenford Sports",
    accent: "#a8321c",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpBridge(req, d.tools)],
  });
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  registerAuthRoutes(app, authDeps);
  const kit: PageKit = { ctx, html };
  const notFound = async (req: FastifyRequest, reply: FastifyReply, what: string) => html(reply, shell(await ctx(req), "Not found", `<h1>No such ${what}</h1>`), 404);

  app.get("/", async (req, reply) => {
    const ws = req.workspaceId;
    return html(reply, shell(await ctx(req), "Find gear", pages.home(req.prefix, await d.catalog.policies(ws), await d.catalog.facets(ws))));
  });

  app.get("/search", async (req, reply) => {
    const f = flat(req.query);
    const parsed = searchSchema.safeParse(f);
    if (!parsed.success) {
      const page = pages.home(req.prefix, await d.catalog.policies(req.workspaceId), await d.catalog.facets(req.workspaceId), f);
      return html(reply, shell(await ctx(req, `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`), "Find gear", page), 400);
    }
    return html(reply, shell(await ctx(req), "Search results", pages.searchResults(req.prefix, await d.catalog.search(req.workspaceId, toSearch(parsed.data)), f)));
  });

  app.get("/products", async (req, reply) => {
    const category = flat(req.query).category;
    const list = await d.catalog.listProducts(req.workspaceId, category ? { category } : {});
    return html(reply, shell(await ctx(req), "Products", pages.productsList(req.prefix, list, await d.catalog.policies(req.workspaceId), category)));
  });

  app.get<{ Params: { code: string } }>("/products/:code", async (req, reply) => {
    const x = await d.catalog.getProduct(req.workspaceId, req.params.code);
    if (!x) return notFound(req, reply, "product");
    return html(reply, shell(await ctx(req), x.name, pages.productDetail(req.prefix, x, await d.catalog.policies(req.workspaceId))));
  });

  app.get("/policies", async (req, reply) => html(reply, shell(await ctx(req), "Store policies", pages.policiesPage(req.prefix, await d.catalog.policies(req.workspaceId)))));

  registerOrderUi(app, d, kit);
}
