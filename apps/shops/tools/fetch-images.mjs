#!/usr/bin/env node
/**
 * fetch-images — CC0 / public-domain photographs for one store, bundled with the app, never hot-linked.
 *
 *   node apps/shops/tools/fetch-images.mjs <store> [--only file1,file2]
 *
 * apps/shops/tools/images/<store>.json lists the photographs:
 *
 *   [{ "file": "aria-black", "query": "black over-ear headphones", "pick": 0, "source": "openverse" }]
 *
 * `pick` (default 0) is which CC0 / public-domain hit to take; `source` is "openverse" (the default) or
 * "commons" (Wikimedia Commons, the fallback). Each entry — or only the --only ones — is searched, its
 * hit downloaded, resized to 1200 px on the long edge as a JPEG at quality 80 (upright, metadata
 * stripped) into apps/shops/public/img/<store>/<file>.jpg, and its provenance { file, source, creator,
 * license, title, provider } merged by `file` into apps/shops/public/img/<store>/manifest.json; the
 * entries of files not refetched are kept. `source` is the photo's landing page and `license` is
 * exactly "cc0" or "pdm". A photo already on disk from the same landing page is left as it is.
 *
 * Openverse's anonymous quota (20 requests a minute, 200 a day) is shared by every process on this
 * machine, so each search response is cached in apps/shops/tools/.cache/<source>/<sha1 of the
 * query>.json and reused by every later run (changing `pick` costs no request), API calls take turns
 * at least 4 s apart machine-wide, and an HTTP 429 backs off 60 s, then 120 s, up to three times
 * before the entry fails. Downloads come from the image hosts and do not count against the API.
 *
 * Prints one line per entry (ok / failed, license, title); exits 1 if any entry failed, 2 on bad input.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { z } from "zod";

const TOOLS = dirname(fileURLToPath(import.meta.url));
const APP = join(TOOLS, "..");
const REPO = join(APP, "..", "..");
const CACHE = join(TOOLS, ".cache");

/** Sent with every request: Wikimedia asks API clients to say who they are. */
export const USER_AGENT = "benchme-shops-image-fetch/1.0 (research; contact via github.com/orabenchmarks)";
/** At least 4 s between API calls, plus a margin for timer jitter between processes. */
const TURN_MS = 4_250;
const BACKOFF_S = [60, 120, 120];
/** A Retry-After longer than this means the daily quota is spent: waiting is pointless. */
const GIVE_UP_AFTER_S = 15 * 60;
const LONG_EDGE = 1200;
/** Below this long edge the 1200 px JPEG is visibly soft, and the ok line says so. */
const SOFT_EDGE = 800;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Openverse's license codes and Commons' LicenseShortName, lower-cased → the manifest's two marks. */
const LICENSES = new Map([
  ["cc0", "cc0"],
  ["pdm", "pdm"],
  ["public domain", "pdm"],
]);

const rel = (path) => relative(REPO, path);

const listSchema = z
  .array(
    z
      .object({
        file: z.string().regex(SLUG, "must be a lowercase slug without an extension"),
        query: z.string().trim().min(1),
        pick: z.number().int().min(0).default(0),
        source: z.enum(["openverse", "commons"]).default("openverse"),
      })
      .strict(),
  )
  .superRefine((list, ctx) => {
    const seen = new Set();
    list.forEach((e, i) => {
      if (seen.has(e.file)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "file"], message: `"${e.file}" is listed twice` });
      seen.add(e.file);
    });
  });

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** The text of an HTML fragment (Commons' metadata is HTML): tags dropped, entities decoded, whitespace collapsed, at most 200 characters. */
export function plain(value) {
  if (typeof value !== "string") return "";
  const text = value
    // StockSnap/Openverse send some creator names JavaScript-escape()d ("Micha%u0142%20Grosicki").
    .replace(/%u([0-9a-f]{4})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== "#") return ENTITIES.get(e.toLowerCase()) ?? m;
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
}

/** "cc0" or "pdm" for a CC0 / public-domain mark, null for any other license. */
export function normaliseLicense(raw) {
  return LICENSES.get(plain(raw).toLowerCase()) ?? null;
}

export function searchUrl(source, query) {
  if (source === "openverse") {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.search = new URLSearchParams({ q: query, license: "cc0,pdm", category: "photograph", page_size: "20", source: "stocksnap,wikimedia,flickr" }).toString();
    return url;
  }
  // 50 candidates, since only the CC0 / public-domain ones count; only the metadata the manifest needs.
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: "50",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1600",
    iiextmetadatafilter: "LicenseShortName|Artist|ObjectName",
    format: "json",
  }).toString();
  return url;
}

const openverseResult = z.object({
  url: z.string().url(),
  foreign_landing_url: z.string().url(),
  creator: z.string().nullish(),
  license: z.string(),
  title: z.string().nullish(),
  provider: z.string().nullish(),
  source: z.string().nullish(),
});

/** An Openverse search response's usable hits, in its order: { url, source, creator, license, title, provider }. */
export function openverseHits(body) {
  const { results } = z.object({ results: z.array(z.unknown()) }).parse(body);
  return results.flatMap((raw) => {
    const r = openverseResult.safeParse(raw);
    const license = r.success ? normaliseLicense(r.data.license) : null;
    if (!r.success || !license) return [];
    const { url, foreign_landing_url: source, creator, title, provider } = r.data;
    return [{ url, source, creator: plain(creator) || "Unknown", license, title: plain(title) || "Untitled", provider: provider ?? r.data.source ?? "openverse" }];
  });
}

const commonsPage = z.object({
  title: z.string(),
  index: z.number().optional(),
  imageinfo: z
    .array(
      z.object({
        url: z.string().url(),
        thumburl: z.string().url().optional(),
        descriptionurl: z.string().url(),
        extmetadata: z.record(z.object({ value: z.unknown() }).passthrough()).optional(),
      }),
    )
    .nonempty(),
});

/** A Commons search response's hits that are CC0 or "Public domain", in search order. */
export function commonsHits(body) {
  const pages = z.object({ query: z.object({ pages: z.record(z.unknown()) }).optional() }).parse(body).query?.pages ?? {};
  return Object.values(pages)
    .flatMap((raw) => {
      const p = commonsPage.safeParse(raw);
      return p.success ? [p.data] : [];
    })
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const info = p.imageinfo[0];
      const meta = (key) => plain(info.extmetadata?.[key]?.value);
      const license = normaliseLicense(meta("LicenseShortName"));
      if (!license) return [];
      const title = meta("ObjectName") || p.title.replace(/^File:/, "").replace(/\.[^.]+$/, "");
      return [{ url: info.thumburl ?? info.url, source: info.descriptionurl, creator: meta("Artist") || "Unknown", license, title, provider: "wikimedia" }];
    });
}

let lastTurn = 0; // this process's latest API call

/**
 * Read-modify-write the machine-wide turn stamp (`.turn` in a source's cache directory) under an
 * exclusive `.turn.lock`; `next` maps the latest turn handed out to the new one, which is returned.
 */
async function updateTurn(dir, next) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".turn.lock");
  const stamp = join(dir, ".turn");
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      // Another process holds it for a few milliseconds — or died holding it: break it after 10 s.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) unlinkSync(lock);
      } catch {
        // released meanwhile
      }
      await delay(20 + Math.random() * 30);
      continue;
    }
    try {
      let latest = 0;
      try {
        latest = Number(readFileSync(stamp, "utf8")) || 0;
      } catch {
        // the first turn on this machine
      }
      if (latest > Date.now() + GIVE_UP_AFTER_S * 1000) latest = 0; // a stamp from a broken clock
      const value = next(latest);
      writeFileSync(stamp, String(value));
      return value;
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }
}

/** Wait for this process's turn at an API: turns are TURN_MS apart across every process on the machine. */
async function takeTurn(dir, sleep) {
  const at = await updateTurn(dir, (latest) => Math.max(Date.now(), latest + TURN_MS, lastTurn + TURN_MS));
  lastTurn = at;
  if (at > Date.now()) await sleep(at - Date.now());
}

/** After a 429, nobody on this machine takes a turn before `until`. */
async function holdTurns(dir, until) {
  await updateTurn(dir, (latest) => Math.max(latest, until - TURN_MS));
}

/** Write via a temp file in `cacheDir` (ignored by git), so a crash never leaves debris next to the photos. */
function writeAtomic(path, data, cacheDir = CACHE) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(cacheDir, ".tmp", `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** A search response: from the shared cache, else from the API in turn (cached once it succeeded). */
export async function search(source, query, { cacheDir = CACHE, fetchImpl = fetch, sleep = delay, log = (line) => console.error(line) } = {}) {
  const dir = join(cacheDir, source);
  const file = join(dir, `${createHash("sha1").update(query).digest("hex")}.json`);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // unreadable: ask again
    }
  }
  for (let attempt = 0; ; attempt++) {
    await takeTurn(dir, sleep);
    const res = await fetchImpl(searchUrl(source, query), { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      if (attempt >= BACKOFF_S.length || retryAfter > GIVE_UP_AFTER_S) {
        const when = retryAfter ? `, retry after ${Math.ceil(retryAfter / 60)} min` : "";
        const fallback = source === "openverse" ? ', or set "source": "commons"' : "";
        throw new Error(`${source} is rate-limiting this machine (HTTP 429${when}) — run again later${fallback}`);
      }
      const wait = Math.max(BACKOFF_S[attempt], retryAfter);
      log(`  ${source} answered 429 — backing off ${wait} s`);
      await holdTurns(dir, Date.now() + wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${source} search answered HTTP ${res.status}`);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${source} search answered something other than JSON`);
    }
    if (body?.error) throw new Error(`${source} search failed: ${plain(body.error.info ?? body.error.code ?? "unknown error")}`);
    writeAtomic(file, text, cacheDir);
    return body;
  }
}

/** The image's bytes, straight from its host (no API quota). */
async function download(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`the image host answered HTTP ${res.status} — try another pick`);
  // Flickr answers for a removed photo with a redirect to a grey placeholder.
  if (/photo_unavailable/i.test(res.url)) throw new Error("the photo was removed from its host — try another pick");
  if (/^text\//i.test(res.headers.get("content-type") ?? "")) throw new Error("the image host answered with a page, not an image — try another pick");
  return Buffer.from(await res.arrayBuffer());
}

/** 1200 px on the long edge, JPEG quality 80, upright, white where it was transparent, no metadata kept. */
export async function toJpeg(input) {
  const image = sharp(input, { autoOrient: true });
  const { width = 0, height = 0 } = await image.metadata();
  const data = await image
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return { data, sourceLongEdge: Math.max(width, height) };
}

/** The manifest with `entry` in place of any entry for the same file, sorted by file. */
export function mergeManifest(entries, entry) {
  return [...entries.filter((e) => e.file !== entry.file), entry].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** The manifest as it stands; it is only ever merged into, so anything unreadable stops the run. */
function readManifest(path) {
  if (!existsSync(path)) return [];
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${rel(path)} is not valid JSON — fix or delete it first`);
  }
  const parsed = z.array(z.object({ file: z.string() }).passthrough()).safeParse(json);
  if (!parsed.success) throw new Error(`${rel(path)} is not a list of { file, … } entries — fix or delete it first`);
  return parsed.data;
}

function parseArgs(argv) {
  let store = null;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only" || a.startsWith("--only=")) {
      only = (a === "--only" ? (argv[++i] ?? "") : a.slice("--only=".length))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!only.length) return null;
    } else if (!a.startsWith("-") && store === null) store = a;
    else return null;
  }
  return store && SLUG.test(store) ? { store, only } : null;
}

const reason = (err) => (err?.cause?.code ? `${err.message} (${err.cause.code})` : (err?.message ?? String(err)));

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("usage: node apps/shops/tools/fetch-images.mjs <store> [--only file1,file2]");
    return 2;
  }
  const { store, only } = args;
  const listPath = join(TOOLS, "images", `${store}.json`);
  const outDir = join(APP, "public", "img", store);
  const manifestPath = join(outDir, "manifest.json");
  let list;
  try {
    if (!existsSync(listPath)) throw new Error(`no image list at ${rel(listPath)}`);
    let json;
    try {
      json = JSON.parse(readFileSync(listPath, "utf8"));
    } catch {
      throw new Error(`${rel(listPath)} is not valid JSON`);
    }
    const parsed = listSchema.safeParse(json);
    if (!parsed.success) throw new Error(`${rel(listPath)}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    list = parsed.data;
    const unknown = (only ?? []).filter((f) => !list.some((e) => e.file === f));
    if (unknown.length) throw new Error(`--only names files ${rel(listPath)} does not list: ${unknown.join(", ")}`);
    readManifest(manifestPath); // refuse up front rather than after the first download
  } catch (err) {
    console.error(reason(err));
    return 2;
  }

  const entries = only ? list.filter((e) => only.includes(e.file)) : list;
  const width = Math.max(0, ...entries.map((e) => e.file.length));
  let failed = 0;
  for (const e of entries) {
    try {
      const body = await search(e.source, e.query);
      let hits;
      try {
        hits = e.source === "openverse" ? openverseHits(body) : commonsHits(body);
      } catch {
        throw new Error(`${e.source} answered "${e.query}" in an unexpected shape`);
      }
      const hit = hits[e.pick];
      if (!hit) throw new Error(`${e.source} has ${hits.length} CC0/public-domain hit${hits.length === 1 ? "" : "s"} for "${e.query}" — pick ${e.pick} is past the end`);
      const jpg = join(outDir, `${e.file}.jpg`);
      let note = "";
      if (existsSync(jpg) && readManifest(manifestPath).find((m) => m.file === e.file)?.source === hit.source) note = " (unchanged)";
      else {
        const { data, sourceLongEdge } = await toJpeg(await download(hit.url));
        writeAtomic(jpg, data);
        if (sourceLongEdge < SOFT_EDGE) note = ` (the source is only ${sourceLongEdge} px on its long edge, soft at ${LONG_EDGE}: consider another pick)`;
      }
      // Merged into the manifest as it is on disk now, so a second run for the same store loses nothing.
      const manifest = mergeManifest(readManifest(manifestPath), { file: e.file, source: hit.source, creator: hit.creator, license: hit.license, title: hit.title, provider: hit.provider });
      writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`ok      ${e.file.padEnd(width)}  ${hit.license}  ${hit.title}${note}`);
    } catch (err) {
      failed += 1;
      console.log(`failed  ${e.file.padEnd(width)}  ${reason(err)}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
