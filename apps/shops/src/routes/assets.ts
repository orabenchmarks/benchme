import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

/** apps/shops/public: two levels up from this module, in src/routes and in dist/routes alike. */
export const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

/** What the assets route serves, by extension. Anything else under public/ (manifests, notes) is never served. */
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/**
 * The file under public/ an asset path ("css/base.css", "img/halden/x.jpg") names, or null when it
 * may not be served: an unknown type, a photo manifest (provenance records stay private), a dotfile,
 * a backslash, a NUL, an absolute path, or any "." / ".." segment — so nothing outside public/.
 * Existence is the caller's to check.
 */
export function resolvePublicFile(rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p.startsWith("."))) return null;
  if (basename(rel).toLowerCase() === "manifest.json") return null;
  if (!TYPES[extname(rel).toLowerCase()]) return null;
  const abs = resolve(PUBLIC_DIR, ...parts);
  return abs.startsWith(PUBLIC_DIR + sep) ? abs : null;
}

let publicReal: Promise<string> | undefined;

/** The file's real path when it is a regular file still inside public/ (a symlink may not lead out), else null. */
async function servable(file: string): Promise<{ path: string; size: number; mtime: Date } | null> {
  try {
    const root = await (publicReal ??= realpath(PUBLIC_DIR));
    const real = await realpath(file);
    if (!real.startsWith(root + sep)) return null;
    const st = await stat(real);
    return st.isFile() ? { path: real, size: st.size, mtime: st.mtime } : null;
  } catch {
    return null;
  }
}

const notFound = (reply: FastifyReply) => reply.code(404).type("text/plain; charset=utf-8").send("Not found");

/**
 * GET /assets/* on every site (stores and paylantern): the stylesheets, scripts and photographs in
 * apps/shops/public, cacheable for an hour. Pages link them as <prefix>/assets/<path>.
 */
export function registerAssetRoutes(scope: FastifyInstance): void {
  scope.get<{ Params: { "*": string } }>("/assets/*", async (req, reply) => {
    const file = resolvePublicFile(req.params["*"] ?? "");
    const found = file ? await servable(file) : null;
    if (!file || !found) return notFound(reply);
    return reply
      .header("cache-control", "public, max-age=3600")
      .header("last-modified", found.mtime.toUTCString())
      .header("content-length", found.size)
      .type(TYPES[extname(file).toLowerCase()] as string)
      .send(createReadStream(found.path));
  });
}
