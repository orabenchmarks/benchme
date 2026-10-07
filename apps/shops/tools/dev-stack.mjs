#!/usr/bin/env node
/**
 * dev-stack — the stores' slice of benchme on one machine, for looking at the shops in a browser.
 *
 *   node apps/shops/tools/dev-stack.mjs --port 4100 --db bm_ui [--scenarios <file>] [--payments fake|stripe] [--mint-only]
 *
 * Runs the core, mail and shops migrations against postgres://benchme:benchme@localhost:55432/<db>,
 * then starts (each with `node --import tsx`, straight from src/):
 *   gateway on --port   (PUBLIC_BASE_URL http://localhost:<port>; the three stores, paylantern (unlisted) and mail)
 *   shops   on port + 1 (fake payments unless --payments stripe; --scenarios, default the public fixtures)
 *   mail    on port + 2
 * waits for every /readyz, mints a shops-v1 workspace with the operator key and prints ONE JSON line
 *   {"gateway","workspace","stores":{"wrenfield","halden","quillfeather"},"paylantern","mail","payments","internalSecret","suffixKey"}
 * on stdout, then keeps running until SIGINT/SIGTERM. Children's output goes to stderr, prefixed.
 *
 * Secrets (dev-stack-secrets.mjs): fake mode runs on fixed development values, published with the code. Stripe mode
 * takes test payments, and shops refuses published secrets then: the stack makes a fresh SHOPS_INTERNAL_SECRET (the
 * internal state API's, which stripe-ledger.mjs and checkout-integrity read with) and SHOPS_SUFFIX_KEY (the suffix key
 * the browser suite checks order numbers with) for every run. Either way the JSON line gives the run's two as
 * internalSecret and suffixKey; the operator key stays the fixed one (DEV.OPERATOR_KEY).
 *
 * --mint-only skips everything but the mint, against a stack already running on --port: its line has no secrets
 * (they are the running stack's, in that stack's own line).
 * --payments stripe passes STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY through from this environment
 * (test-mode keys only: shops refuses to boot on a live one).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { DEV, stackSecrets } from "./dev-stack-secrets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);

function flag(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`--${name} needs a value`);
  return v;
}

function fail(message) {
  process.stderr.write(`dev-stack: ${message}\n`);
  process.exit(1);
}

const port = Number(flag("port", "4100"));
if (!Number.isInteger(port) || port < 1024 || port > 65533) fail("--port must be a port number (1024–65533); the stack uses it and the next two");
const db = flag("db");
const mintOnly = argv.includes("--mint-only");
if (!db && !mintOnly) fail("--db <database> is required (postgres://benchme:benchme@localhost:55432/<db>)");
if (db && !/^[A-Za-z0-9_]+$/.test(db)) fail("--db must be a plain database name");
const payments = flag("payments", "fake");
if (payments !== "fake" && payments !== "stripe") fail("--payments must be fake or stripe");
// --scenarios is read relative to where you run the tool; the default (the public fixtures) lives in the repo.
const scenariosArg = flag("scenarios");
const scenariosFile = !scenariosArg
  ? join(ROOT, "apps", "shops", "test-fixtures", "shops-scenarios.json")
  : isAbsolute(scenariosArg)
    ? scenariosArg
    : resolve(process.cwd(), scenariosArg);

const ports = { gateway: port, shops: port + 1, mail: port + 2 };
const GATEWAY = `http://localhost:${ports.gateway}`;

// This run's secrets: the fixed development ones, but a fresh internal secret and suffix key in Stripe mode.
const SECRETS = stackSecrets(payments);

const SITES = ["wrenfield", "halden", "quillfeather", "paylantern"];

/** Mints a shops-v1 workspace on a running gateway and prints the one JSON line (with this run's secrets when it started the stack). */
async function mint(started) {
  const res = await fetch(`${GATEWAY}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-benchme-operator-key": DEV.OPERATOR_KEY },
    body: JSON.stringify({ scenario: "shops-v1" }),
  });
  const text = await res.text();
  if (res.status !== 201) throw new Error(`minting a workspace answered ${res.status}: ${text.slice(0, 300)}`);
  const w = JSON.parse(text);
  const apps = w.urls?.apps ?? {};
  const slash = (u) => (u.endsWith("/") ? u : `${u}/`);
  const out = {
    gateway: GATEWAY,
    workspace: w.id,
    stores: { wrenfield: slash(apps.wrenfield), halden: slash(apps.halden), quillfeather: slash(apps.quillfeather) },
    // Unlisted: routed by the gateway but never named in a workspace's urls.
    paylantern: `${GATEWAY}/w/${w.id}/paylantern/`,
    mail: slash(apps.mail),
    ...(started ? { payments, internalSecret: SECRETS.SHOPS_INTERNAL_SECRET, suffixKey: SECRETS.SHOPS_SUFFIX_KEY } : {}),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (mintOnly) {
  try {
    await mint(false);
    process.exit(0);
  } catch (err) {
    fail(`${err.message} (is a stack running on port ${port}?)`);
  }
}

if (!existsSync(scenariosFile)) fail(`scenario file ${scenariosFile} does not exist`);

const base = { ...process.env };
// The stack decides these; a stray value in the caller's shell must not leak in.
for (const k of ["PORT", "SHOPS_PAYMENTS", "SHOPS_SCENARIOS_FILE", "APP_TARGETS", "PUBLIC_BASE_URL", "INTERNAL_BASE_URL"]) delete base[k];
if (payments === "fake") {
  delete base.STRIPE_SECRET_KEY;
  delete base.STRIPE_PUBLISHABLE_KEY;
} else if (!base.STRIPE_SECRET_KEY || !base.STRIPE_PUBLISHABLE_KEY) {
  fail("--payments stripe needs STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (test mode) in the environment");
}
const env = {
  ...base,
  ...SECRETS,
  DATABASE_URL: `postgres://benchme:benchme@localhost:55432/${db}`,
  REDIS_URL: "redis://localhost:56379",
  LOG_LEVEL: "warn",
};

const children = new Map();
let stopping = false;

function pipe(name, stream) {
  createInterface({ input: stream }).on("line", (line) => process.stderr.write(`[${name}] ${line}\n`));
}

function run(name, args, extraEnv) {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  pipe(name, child.stdout);
  pipe(name, child.stderr);
  return child;
}

/** Runs one migration to completion; a failure stops the stack before anything starts. */
function migrate(name, file) {
  return new Promise((ok, ko) => {
    const child = run(`migrate-${name}`, [file]);
    child.on("error", ko);
    child.on("exit", (code) => (code === 0 ? ok() : ko(new Error(`migrate-${name} exited with ${code}`))));
  });
}

function start(name, file, extraEnv) {
  const child = run(name, [file], extraEnv);
  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (stopping) return;
    process.stderr.write(`dev-stack: ${name} exited (${signal ?? code}); stopping the stack\n`);
    stop(1);
  });
  return child;
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(code);
  }, 3000);
  deadline.unref();
  const poll = setInterval(() => {
    if (children.size === 0) {
      clearInterval(poll);
      process.exit(code);
    }
  }, 50);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
// Last resort (an uncaught error, process.exit elsewhere): never leave a server behind.
process.on("exit", () => {
  for (const child of children.values()) child.kill("SIGKILL");
});

async function waitReady(name, url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!children.has(name)) throw new Error(`${name} exited before it was ready`);
    try {
      const r = await fetch(url);
      if (r.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${name} was not ready at ${url} within ${timeoutMs / 1000}s`);
}

try {
  await migrate("core", "apps/gateway/src/migrate.ts");
  await migrate("mail", "apps/mail/src/migrate.ts");
  await migrate("shops", "apps/shops/src/migrate.ts");

  start("mail", "apps/mail/src/server.ts", { PORT: String(ports.mail) });
  start("shops", "apps/shops/src/server.ts", {
    PORT: String(ports.shops),
    SHOPS_PAYMENTS: payments,
    SHOPS_SCENARIOS_FILE: scenariosFile,
    MAIL_URL: `http://localhost:${ports.mail}`,
  });
  const targets = Object.fromEntries(SITES.map((s) => [s, `http://localhost:${ports.shops}/s/${s}`]));
  targets.mail = `http://localhost:${ports.mail}`;
  start("gateway", "apps/gateway/src/server.ts", {
    PORT: String(ports.gateway),
    PUBLIC_BASE_URL: GATEWAY,
    APP_TARGETS: JSON.stringify(targets),
    SEEDED_APPS: "mail",
    UNLISTED_APPS: "paylantern",
    // Empty lists. An EMPTY value reads as unset (and MCP_APPS would default to warehouse, which this
    // stack does not run), so a lone comma says "none".
    MCP_APPS: ",",
    ASK_APPS: ",",
    WEBMCP_APPS: ",",
    RATE_CREATE_PER_HOUR: "100000",
  });

  await Promise.all([
    waitReady("mail", `http://localhost:${ports.mail}/readyz`),
    waitReady("shops", `http://localhost:${ports.shops}/readyz`),
    waitReady("gateway", `${GATEWAY}/readyz`),
  ]);
  await mint(true);
} catch (err) {
  process.stderr.write(`dev-stack: ${err.message}\n`);
  stop(1);
}
