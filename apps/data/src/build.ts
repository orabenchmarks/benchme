import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_SEED, buildSite } from "./site.js";

/** Renders the site into dist/site at build time (baked into the image). */
const seed = Number(process.env.DATA_SEED ?? DEFAULT_DATA_SEED);
const out = join(dirname(fileURLToPath(import.meta.url)), "site");
let n = 0;
for (const f of buildSite(seed)) {
  const path = join(out, f.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, f.body);
  n++;
}
console.log(JSON.stringify({ seed, files: n, out }));
