#!/usr/bin/env node
/**
 * intent-integrity — prove every intent task's oracle BITES, against a live
 * benchme whose verifier serves this checkout's compose/specs.
 *
 *   node tools/intent-integrity.mjs --base http://localhost:8080 [--scenario acme-v1] [--seed 4242] [--scale 1] [--operator-key <key>]
 *
 * --scenario picks the corpus (tools/intent-corpus/corpus.mjs CORPORA): acme-v1
 * (the default) or webmcp-v1, the sites from webmcp-tools.
 *
 * One fresh workspace at the corpus seed, signed in to every app that has
 * accounts (sign-up → the code from the workspace inbox → verify → log in, as
 * tools/agent-eval does), then five passes:
 *
 *   0. no door is a dead end: on every app whose tools sign in, an account is
 *      signed up, mailed its code, verified and signed in through MCP tools
 *      alone (the app's, and the inbox's to read the code), with a second
 *      address so the pages' own sign-in above is left as it was;
 *   1. every state task FAILS before anything is done — no check passes vacuously;
 *   2. every json task: the answer read back from the LIVE apps the way its
 *      question asks it is accepted, and a wrong answer is refused — the key
 *      matches what the apps actually show;
 *   3. each state task's reference solution runs through the REST API, then it PASSES;
 *   4. every state task STILL passes once all of them ran — no task undid another.
 *
 * Exits 1 on any surprise, naming the task and the verifier's own words.
 */
import { buildCorpus } from "./intent-corpus/corpus.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const BASE = option("base", "http://localhost:8080").replace(/\/$/, "");
const SEED = Number(option("seed", 4242));
const SCALE = Number(option("scale", 1));
const SCENARIO = option("scenario", "acme-v1");
const OPERATOR_KEY = option("operator-key");
const EMAIL = "integrity@example.com";

const corpus = buildCorpus({ seed: SEED, scale: SCALE, scenario: SCENARIO });
if (corpus.problems.length) throw new Error(corpus.problems.join("; "));

async function http(method, url, { body, form, cookies, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: {
      ...headers,
      ...(cookies?.length ? { cookie: cookies.join("; ") } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  return res;
}

async function mint() {
  const res = await http("POST", `${BASE}/api/workspaces`, { body: { scenario: SCENARIO, seed: SEED }, headers: OPERATOR_KEY ? { "x-benchme-operator-key": OPERATOR_KEY } : {} });
  if (!res.ok) throw new Error(`workspace mint answered ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

/** Session cookies for one app, or [] for an app without accounts (the vault, the data site). */
async function signIn(ws, app) {
  const root = `${BASE}/w/${ws}/${app}`;
  const password = `pw-${Math.random().toString(36).slice(2)}-X9`;
  const signup = await http("POST", `${root}/signup`, { form: { email: EMAIL, password, name: "Integrity" } });
  if (signup.status === 404) return [];
  if (signup.status >= 400) throw new Error(`${app} signup answered ${signup.status}: ${await signup.text()}`);
  const mail = await (await http("GET", `${BASE}/w/${ws}/mail/api/v1/messages`)).json();
  const code = mail.filter((m) => m.to === EMAIL && String(m.from).includes(app)).map((m) => /\b(\d{6})\b/.exec(m.body)?.[1]).filter(Boolean).at(-1);
  if (!code) throw new Error(`no verification code for ${app} in the workspace inbox`);
  const verify = await http("POST", `${root}/verify`, { form: { email: EMAIL, code } });
  if (verify.status >= 400) throw new Error(`${app} verify answered ${verify.status}`);
  const login = await http("POST", `${root}/login`, { form: { email: EMAIL, password } });
  const cookies = login.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (login.status !== 303 || cookies.length === 0) throw new Error(`${app} login answered ${login.status} with ${cookies.length} cookies`);
  return cookies;
}

/** One JSON-RPC request to an app's MCP server, as an MCP client sends it: the result, and the session id an `initialize` answers with. */
async function mcp(ws, app, method, params, session) {
  const res = await http("POST", `${BASE}/w/${ws}/${app}/mcp`, { body: { jsonrpc: "2.0", id: 1, method, params }, headers: { accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) } });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${app} mcp ${method} answered ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  const message = JSON.parse(line ? line.slice(5) : text);
  if (message.error) throw new Error(`${app} mcp ${method}: ${JSON.stringify(message.error).slice(0, 300)}`);
  return { result: message.result, session: res.headers.get("mcp-session-id") };
}

/** A tool's answer: the JSON it printed, or a throw with the tool's own words when it refused. */
async function tool(ws, app, name, args, session) {
  const { result } = await mcp(ws, app, "tools/call", { name, arguments: args }, session);
  const said = JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(`${app} ${name} refused: ${JSON.stringify(said).slice(0, 300)}`);
  return said;
}

/**
 * The sign-in of `signIn`, through MCP tools alone: sign_up, the mailed code
 * read with the inbox's own tools, verify_email, sign_in, and the site's word
 * for who the connection now is. False for an app whose tools do not sign in.
 */
async function signInThroughTools(ws, app, email) {
  // An app with no MCP server at all (the company's static site) has no tools to sign in with.
  const listed = await mcp(ws, app, "tools/list", {}).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
  if (!listed?.result.tools.some((t) => t.name === "sign_in")) return false;
  const { session } = await mcp(ws, app, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "intent-integrity", version: "0" } });
  if (!session) throw new Error(`${app} gave an initializing client no Mcp-Session-Id to stay signed in with`);
  const password = `pw-${Math.random().toString(36).slice(2)}-X9`;
  await tool(ws, app, "sign_up", { name: "Integrity", email, password }, session);
  const mail = await tool(ws, "mail", "list_messages", { to: email });
  const code = mail.filter((m) => String(m.from).includes(app)).map((m) => /\b(\d{6})\b/.exec(m.body)?.[1]).filter(Boolean).at(0);
  if (!code) throw new Error(`no verification code for ${app} in the inbox, read through its tools`);
  await tool(ws, app, "verify_email", { email, code }, session);
  await tool(ws, app, "sign_in", { email, password }, session);
  const who = await tool(ws, app, "whoami", {}, session);
  if (who.signedIn !== true || who.email !== email) throw new Error(`${app} says the connection is ${JSON.stringify(who)} after sign_in`);
  return true;
}

function apiFor(ws, sessions) {
  const url = (app, path) => `${BASE}/w/${ws}/${app}${path}`;
  const call = async (method, app, path, body) => {
    const res = await http(method, url(app, path), { body, cookies: sessions[app] });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${app}${path} answered ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const api = {
    get: (app, path) => call("GET", app, path),
    post: (app, path, body) => call("POST", app, path, body),
    /** Every row of a list route: a bare array, or `{items, nextCursor}` pages followed to the end. */
    async list(app, path) {
      const rows = [];
      for (let cursor = null, first = true; first || cursor; first = false) {
        const page = await api.get(app, cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path);
        if (Array.isArray(page)) return page;
        rows.push(...page.items);
        cursor = page.nextCursor;
      }
      return rows;
    },
    async text(app, path) {
      const res = await http("GET", url(app, path), { cookies: sessions[app] });
      if (!res.ok) throw new Error(`GET ${app}/${path} answered ${res.status}`);
      return res.text();
    },
    only(items) {
      if (items.length !== 1) throw new Error(`expected exactly one match, found ${items.length}`);
      return items[0];
    },
    async documentTitled(phrase) {
      return api.only((await api.list("vaultdocs", "/api/v1/documents")).filter((d) => d.title.toLowerCase() === phrase)).id;
    },
  };
  return api;
}

async function submit(ws, id, artifact) {
  const res = await http("POST", `${BASE}/w/${ws}/verify/v1/submit/${id}`, { body: JSON.stringify(artifact) });
  const body = await res.json().catch(() => ({}));
  if (!body.verdict) throw new Error(`verifier answered ${res.status} for ${id}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** A wrong answer of the same shape: every field moved off its key. */
function perturb(expect) {
  return Object.fromEntries(
    Object.entries(expect).map(([field, v]) => [
      field,
      typeof v === "object" ? v.value + v.tolerance * 10 + 1 : typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : `${v}-not-it`,
    ]),
  );
}

const ws = await mint();
const sessions = {};
for (const app of new Set(corpus.tasks.map((t) => t.app))) sessions[app] = await signIn(ws, app);
const api = apiFor(ws, sessions);
const specOf = new Map(corpus.specs.map((s) => [s.id, s]));
const state = corpus.tasks.filter((t) => t.oracle === "state");
const json = corpus.tasks.filter((t) => t.oracle === "json");
const surprises = [];
const surprise = (id, what) => {
  surprises.push(`${id}: ${what}`);
  console.error(`✗ ${id}: ${what}`);
};
const said = (r) => `${r.verdict} ${JSON.stringify(r.details ?? r.checks ?? []).slice(0, 400)}`;
const passed = (label, checked) => {
  const n = surprises.length - (passed.seen ?? 0);
  passed.seen = surprises.length;
  console.log(`${label}: ${checked} checked, ${n === 0 ? "all as expected" : `${n} surprise(s)`}`);
};

console.log(`workspace ${ws} (${SCENARIO}) — ${state.length} state + ${json.length} json tasks`);

let signedInByTools = 0;
for (const app of Object.keys(sessions)) {
  try {
    if (await signInThroughTools(ws, app, "tools-integrity@example.com")) signedInByTools++;
  } catch (err) {
    surprise(app, `an agent with only its MCP tools cannot sign in: ${err.message}`);
  }
}
passed("pass 0 — an account signs up and in through MCP tools alone, on every app whose tools sign in", signedInByTools);

for (const t of state) {
  const r = await submit(ws, t.id, {});
  if (r.verdict !== "FAIL") surprise(t.id, `passes BEFORE anything was done — ${said(r)}`);
}
passed("pass 1 — every state task fails on a fresh workspace", state.length);

for (const t of json) {
  const read = corpus.answers[t.id];
  if (!read) {
    surprise(t.id, "has no live answer reader");
    continue;
  }
  let live;
  try {
    live = await read(api);
  } catch (err) {
    surprise(t.id, `the live apps could not answer it: ${err.message}`);
    continue;
  }
  const right = await submit(ws, t.id, live);
  if (right.verdict !== "OK") surprise(t.id, `the live apps answer ${JSON.stringify(live)}, the key refuses it — ${said(right)}`);
  const wrong = await submit(ws, t.id, perturb(specOf.get(t.id).oracle.expect));
  if (wrong.verdict !== "FAIL") surprise(t.id, `a wrong answer passes — ${said(wrong)}`);
}
passed("pass 2 — every json task accepts the live answer and refuses a wrong one", json.length);

const unsolved = new Set();
for (const t of state) {
  const solve = corpus.solutions[t.id];
  if (!solve) {
    unsolved.add(t.id);
    surprise(t.id, "has no reference solution");
    continue;
  }
  try {
    await solve(api);
  } catch (err) {
    unsolved.add(t.id);
    surprise(t.id, `its reference solution failed: ${err.message}`);
    continue;
  }
  const r = await submit(ws, t.id, {});
  if (r.verdict !== "OK") {
    unsolved.add(t.id);
    surprise(t.id, `still fails after its reference solution — ${said(r)}`);
  }
}
passed("pass 3 — every state task passes once its reference solution ran", state.length);

const solved = state.filter((t) => !unsolved.has(t.id));
for (const t of solved) {
  const r = await submit(ws, t.id, {});
  if (r.verdict !== "OK") surprise(t.id, `passed, then failed once the other solutions ran — ${said(r)}`);
}
passed("pass 4 — every state task still passes after all of them ran", solved.length);

if (surprises.length) {
  console.error(`\n${surprises.length} surprise(s) in ${corpus.tasks.length} tasks`);
  process.exit(1);
}
console.log(`\nall ${corpus.tasks.length} tasks bite: ${state.length} state, ${json.length} json`);
