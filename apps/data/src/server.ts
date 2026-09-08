import fastifyStatic from "@fastify/static";
import { createApp, loadConfig } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const cfg = loadConfig(z.object({ PORT: z.coerce.number().int().positive().default(3000), LOG_LEVEL: z.string().default("info") }));
const app = createApp({ name: "data", logLevel: cfg.LOG_LEVEL });
await app.register(fastifyStatic, { root: join(dirname(fileURLToPath(import.meta.url)), "site"), prefix: "/", index: ["index.html"] });
// The gateway proxies /data/* here with the prefix stripped; the site's own links are absolute under /data/.
app.setNotFoundHandler((_req, reply) => reply.code(404).type("text/html").send("<h1>Not found</h1>"));
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
