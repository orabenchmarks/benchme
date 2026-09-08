import type { FastifyInstance } from "fastify";
import type { AppRegistry } from "../app-registry.js";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { WorkspaceService } from "../workspace-service.js";

export type PortalDeps = { apps: AppRegistry; scenarios: ScenarioRegistry; service: WorkspaceService; publicBaseUrl: string };

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1c1c1c}code,pre{background:#f3f3f3;border-radius:4px;padding:.1em .3em}pre{padding:1em;overflow:auto}h1{font-size:1.6rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .6em;text-align:left}</style>
</head><body>${body}</body></html>`;

export function registerPortal(app: FastifyInstance, d: PortalDeps): void {
  app.get("/", async (_req, reply) => {
    const scenarios = d.scenarios
      .list()
      .map((s) => `<li><code>${s.key}</code> — ${s.description}</li>`)
      .join("");
    const apps = d.apps
      .list()
      .map((a) => `<li><code>${a.name}</code>${a.seeded ? " (per-workspace data, MCP at <code>/mcp</code>)" : ""}</li>`)
      .join("");
    return reply.type("text/html").send(
      page(
        "benchme",
        `<h1>benchme</h1>
<p>A fictional company of demo applications for agentic benchmarks. Every run gets its own <strong>workspace</strong>: an isolated, deterministically seeded copy of the data, so parallel runs never see each other.</p>
<h2>Mint a workspace</h2>
<pre>curl -s -X POST ${d.publicBaseUrl}/api/workspaces -H 'content-type: application/json' \\
  -d '{"scenario":"acme-v1","seed":4242}'</pre>
<p>The response lists the URLs for every app under <code>/w/&lt;workspaceId&gt;/&lt;app&gt;/</code>. Workspaces expire after their TTL and are deleted.</p>
<h2>Scenarios</h2><ul>${scenarios}</ul>
<h2>Apps</h2><ul>${apps}</ul>
<p>MCP servers: see the <a href="/registry">registry</a>.</p>`,
      ),
    );
  });

  app.get("/registry", async (_req, reply) => {
    const rows = d.apps
      .seeded()
      .map(
        (a) =>
          `<tr><td><code>${a.name}</code></td><td><code>${d.publicBaseUrl}/w/&lt;workspaceId&gt;/${a.name}/mcp</code></td><td>Streamable HTTP</td></tr>`,
      )
      .join("");
    return reply.type("text/html").send(
      page(
        "benchme — MCP registry",
        `<h1>MCP server registry</h1>
<p>Each server is scoped to a workspace by its URL. No authentication: the unguessable workspace id is the capability.</p>
<table><tr><th>server</th><th>endpoint</th><th>transport</th></tr>${rows}</table>`,
      ),
    );
  });

  app.get<{ Params: { id: string } }>("/w/:id", async (req, reply) => {
    try {
      const w = await d.service.get(req.params.id);
      const urls = d.service.urls(w.id);
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
