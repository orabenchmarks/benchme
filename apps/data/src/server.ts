import fastifyStatic from "@fastify/static";
import { createApp, loadConfig } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const cfg = loadConfig(z.object({ PORT: z.coerce.number().int().positive().default(3000), LOG_LEVEL: z.string().default("info") }));
const app = createApp({ name: "data", logLevel: cfg.LOG_LEVEL });
await app.register(fastifyStatic, { root: join(dirname(fileURLToPath(import.meta.url)), "site"), prefix: "/", index: ["index.html"] });
// The gateway proxies /w/<ws>/data/* here with the prefix stripped; the site's links are RELATIVE, so it works under any prefix.
// .jsonl has no registered mime type, so @fastify/static's extension sniffing
// falls back to application/octet-stream for schema/feed.jsonl; an onSend
// hook runs after its handler sets that default, so it — not `setHeaders`,
// which fires before the plugin's own content-type header and gets
// overwritten by it — is what actually wins.
app.addHook("onSend", async (req, reply) => {
  if (req.url.endsWith(".jsonl")) reply.header("content-type", "application/jsonl");
});
app.setNotFoundHandler((_req, reply) => reply.code(404).type("text/html").send("<h1>Not found</h1>"));
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
