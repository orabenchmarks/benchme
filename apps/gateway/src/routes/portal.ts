import type { DoorSet } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import type { AppRegistry } from "../app-registry.js";
import type { ScenarioRegistry } from "@benchme/scenarios";
import { openCapabilities } from "../capabilities.js";
import { landingPage } from "../landing/page.js";
import { portalViews } from "../landing/views.js";
import type { WorkspaceService } from "../workspace-service.js";

export type PortalDeps = {
  apps: AppRegistry;
  scenarios: ScenarioRegistry;
  service: WorkspaceService;
  publicBaseUrl: string;
  /** The deployment's doors: the portal and the registry name nothing behind a closed one. */
  doors: DoorSet;
};

/** A query value as the pages read it: a string, bounded; anything else is no value. */
const param = (v: unknown): string | undefined => (typeof v === "string" && v ? v.slice(0, 200) : undefined);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1c1c1c}code,pre{background:#f3f3f3;border-radius:4px;padding:.1em .3em}pre{padding:1em;overflow:auto}h1{font-size:1.6rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .6em;text-align:left}</style>
</head><body>${body}</body></html>`;

export function registerPortal(app: FastifyInstance, d: PortalDeps): void {
  const open = openCapabilities(d.doors);
  const mcpOpen = d.doors.has("mcp");
  // What the registry lists: the listed apps with something behind an open door.
  const capable = d.apps.listed().filter((a) => open.some((c) => c.has(a)));

  // The front page: computed once (a deployment's doors and apps do not change while it runs); the search a person
  // opens it with picks which cards are shown.
  const views = portalViews({ apps: d.apps, scenarios: d.scenarios, service: d.service, doors: d.doors, publicBaseUrl: d.publicBaseUrl, registry: capable.length > 0 });
  app.get<{ Querystring: { q?: unknown } }>("/", async (req, reply) => {
    return reply.type("text/html; charset=utf-8").send(landingPage(views.landing, param(req.query.q) ?? ""));
  });

  app.get("/registry", async (_req, reply) => {
    const cell = (has: boolean, path: string) => (has ? `<code>${d.publicBaseUrl}/w/&lt;workspaceId&gt;/${path}</code>` : "—");
    const head = open.map((c) => `<th>${c.label}</th>`).join("");
    const rows = capable.map((a) => `<tr><td><code>${a.name}</code></td>${open.map((c) => `<td>${cell(c.has(a), `${a.name}/${c.path}`)}</td>`).join("")}</tr>`).join("");
    const table = capable.length
      ? `<table><tr><th>server</th>${head}</tr>${rows}</table>${mcpOpen ? "<p>Every MCP endpoint speaks Streamable HTTP.</p>" : ""}`
      : "<p>This deployment serves its sites through their pages alone.</p>";
    // Named for what it lists: MCP servers only where the MCP door is open.
    const title = mcpOpen ? "MCP server registry" : "Registry";
    return reply.type("text/html").send(
      page(
        `benchme — ${title}`,
        `<h1>${title}</h1>
<p>Each server is scoped to a workspace by its URL: the unguessable workspace id is the capability to read. A site with accounts asks the same sign-in of a write through its tools as through its pages (<code>sign_up</code>, <code>verify_email</code> with the code mailed to the inbox, <code>sign_in</code>). A workspace created with its own doors is served through those, whatever this page lists: its <code>urls</code> say which.</p>
${table}`,
      ),
    );
  });

  app.get<{ Params: { id: string } }>("/w/:id", async (req, reply) => {
    try {
      const w = await d.service.get(req.params.id);
      const urls = d.service.urls(w);
      const links = Object.entries(urls.apps)
        .map(([name, url]) => `<li><a href="${url}/">${name}</a></li>`)
        .join("");
      return reply.type("text/html").send(
        page(
          `workspace ${w.id}`,
          `<h1>Workspace <code>${w.id}</code></h1><p>scenario <code>${w.scenario}</code>, seed <code>${w.seed}</code>, expires ${w.expiresAt.toISOString()}${w.finalizedAt ? " (finalized)" : ""}</p><ul>${links}</ul>`,
        ),
      );
    } catch {
      return reply.code(404).type("text/html").send(page("not found", "<h1>No such workspace</h1>"));
    }
  });
}
