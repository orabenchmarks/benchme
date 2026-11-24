/**
 * The tools each of the nine sites registers, as its MCP server and its pages'
 * WebMCP bridge serve them: read from each app's build
 * (apps/<app>/dist/mcp/tools.js, its exported `*Tools()` registry), so an
 * expected call is checked against the registry the sites run, never a copy.
 * The sign-in tools every site adds on top (packages/site-kit) are named
 * apart: no key declares them.
 *
 *   SITE_TOOLS     Map<app, Map<tool name, zod input shape>>
 *   SIGN_IN_TOOLS  the sign-in tools' names
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SITES = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"];
const built = (path) => {
  const file = `${ROOT}${path}`;
  if (!existsSync(file)) throw new Error(`${path} is not built — npm run build`);
  return import(pathToFileURL(file).href);
};

async function registryOf(app) {
  const mod = await built(`apps/${app}/dist/mcp/tools.js`);
  const factories = Object.entries(mod).filter(([name, f]) => typeof f === "function" && /Tools$/.test(name));
  if (factories.length !== 1) throw new Error(`apps/${app}/dist/mcp/tools.js exports ${factories.length} *Tools() registries, not one`);
  return new Map(factories[0][1]().list().map((t) => [t.name, t.input]));
}

export const SITE_TOOLS = new Map(await Promise.all(SITES.map(async (app) => [app, await registryOf(app)])));
export const { SIGN_IN_TOOLS } = await built("packages/site-kit/dist/doors/sign-in-tools.js");
