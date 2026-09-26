#!/usr/bin/env node
/**
 * intent-integrity — prove every intent task's oracle BITES, against a live
 * benchme whose verifier serves this checkout's compose/specs.
 *
 *   node tools/intent-integrity.mjs --base http://localhost:8080 [--seed 4242] [--scale 1] [--operator-key <key>]
 *
 * One fresh workspace at the corpus seed, signed in to every app that has
 * accounts (sign-up → the code from the workspace inbox → verify → log in, as
 * tools/agent-eval does), then four passes:
 *
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
const OPERATOR_KEY = option("operator-key");
const EMAIL = "integrity@example.com";

const corpus = buildCorpus({ seed: SEED, scale: SCALE });
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
  const res = await http("POST", `${BASE}/api/workspaces`, { body: { scenario: "acme-v1", seed: SEED }, headers: OPERATOR_KEY ? { "x-benchme-operator-key": OPERATOR_KEY } : {} });
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

console.log(`workspace ${ws} — ${state.length} state + ${json.length} json tasks`);

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
