/**
 * The integrity proof of the cuj-v1 corpus (docs/scenarios/cuj-v1.md), against
 * a live benchme whose verifier serves this checkout's compose/specs, at the
 * corpus seed, every task in ONE fresh workspace:
 *
 *   0. no door is a dead end: on every site, an account signs up, is mailed its
 *      code, verifies and signs in through MCP tools alone;
 *   1. before anything is done, every task the verifier can check fails, and
 *      so does each of its state steps: no check passes vacuously, and a run
 *      that does nothing fails every impossible task;
 *   2. each task in turn, step by step: a state step's reference solution runs
 *      and then exactly the state steps up to it pass, and every time its
 *      checks report (`at`) falls while that step ran (a change made in step 3
 *      does not pass step 2, nor is it placed there); a json step's live answer is accepted by its key
 *      and a perturbed one refused; an impossible task's attempt is refused
 *      with the code it names, and a very hard one meets the refusal it
 *      recovers from; a tempting option is what its template says, live; and
 *      the countable properties the reference solution shows (sites touched
 *      per step, reads, writes, a sign-up, a refusal recovered from) are the
 *      ones the template declares, so the level they give is the task's;
 *   3. once every solution has run, every check still passes, still at a time
 *      its own step ran, and every key still matches the live sites: no task
 *      undid another, and no later write moved an earlier step's time.
 *
 *   runCujIntegrity({ base, seed, scale, operatorKey }) → exit code (0 or 1)
 */
import { JsonOracle } from "../../apps/verify/dist/oracles/json-oracle.js";
import { buildCorpus } from "../intent-corpus/corpus.mjs";
import { levelOf } from "../intent-corpus/cuj/levels.mjs";
import { liveBenchme, perturb } from "./live.mjs";

const SITES = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"];
const EMAIL = "integrity@example.com";
/** The properties a run can count; the others (named, constraints, rule, tempting, interacting, impossible) are the template's word, checked otherwise. */
const MEASURED = ["sites", "stepSites", "steps", "reads", "writes", "signUp", "recovered"];

/** What a reference solution did, step by step: the countable properties of ./levels.mjs. The inbox is not a site. */
class Meter {
  steps = [];
  signUp = false;
  events = [];
  step() {
    this.steps.push({ apps: [], reads: 0, writes: 0 });
  }
  get now() {
    if (!this.steps.length) this.step();
    return this.steps.at(-1);
  }
  touch(app) {
    if (app !== "mail" && !this.now.apps.includes(app)) this.now.apps.push(app);
  }
  read(app) {
    this.touch(app);
    this.now.reads++;
  }
  write(app) {
    this.touch(app);
    this.now.writes++;
    this.events.push({ kind: "write", app });
  }
  refused(app, code) {
    this.touch(app);
    this.events.push({ kind: "refused", app, code });
  }
  props() {
    const sites = [];
    for (const s of this.steps) for (const app of s.apps) if (!sites.includes(app)) sites.push(app);
    const first = this.events.findIndex((e) => e.kind === "refused");
    return {
      sites,
      stepSites: this.steps.map((s) => s.apps),
      steps: this.steps.length,
      reads: this.steps.reduce((n, s) => n + s.reads, 0),
      writes: this.steps.reduce((n, s) => n + s.writes, 0),
      signUp: this.signUp,
      recovered: first >= 0 && this.events.slice(first + 1).some((e) => e.kind === "write"),
      refusals: this.events.filter((e) => e.kind === "refused").map((e) => e.code),
    };
  }
}

/**
 * The REST door a reference solution uses, counted when a meter is given:
 * `get`/`list`/`ask` read, `post` writes and must be made, `attempt` writes and
 * must be refused (its code is returned), `as`/`signUp` sign in as an account
 * (an existing one, or a new one confirmed by its mailed code) and return the
 * same door with that account's session on that site.
 */
function apiFor(live, ws, sessions, meter) {
  const call = async (method, app, path, body, jar) => {
    const res = await live.http(method, live.appUrl(ws, app, path), { body, cookies: jar[app] ?? sessions[app] });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, text, json };
  };
  const failed = (method, app, path, r) => new Error(`${method} ${app}${path} answered ${r.res.status}: ${r.text.slice(0, 300)}`);
  const make = (jar) => {
    const api = {
      async get(app, path) {
        meter?.read(app);
        const r = await call("GET", app, path, undefined, jar);
        if (!r.res.ok) throw failed("GET", app, path, r);
        return r.json;
      },
      /** Every row of a list route: a bare array, or `{items, nextCursor}` pages followed to the end. One read. */
      async list(app, path) {
        meter?.read(app);
        const rows = [];
        for (let cursor = null, first = true; first || cursor; first = false) {
          const page = cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path;
          const r = await call("GET", app, page, undefined, jar);
          if (!r.res.ok) throw failed("GET", app, page, r);
          if (Array.isArray(r.json)) return r.json;
          rows.push(...r.json.items);
          cursor = r.json.nextCursor;
        }
        return rows;
      },
      /** A POST that only reads: a quote. */
      async ask(app, path, body) {
        meter?.read(app);
        const r = await call("POST", app, path, body, jar);
        if (!r.res.ok) throw failed("POST", app, path, r);
        return r.json;
      },
      async post(app, path, body) {
        const r = await call("POST", app, path, body ?? {}, jar);
        if (!r.res.ok) throw failed("POST", app, path, r);
        meter?.write(app);
        return r.json;
      },
      async attempt(app, path, body) {
        const r = await call("POST", app, path, body ?? {}, jar);
        if (r.res.ok) {
          meter?.write(app);
          throw new Error(`POST ${app}${path} was to be refused, and was made: ${r.text.slice(0, 200)}`);
        }
        const code = r.json?.error ?? null;
        meter?.refused(app, code);
        return { status: r.res.status, code };
      },
      only(items) {
        if (items.length !== 1) throw new Error(`expected exactly one match, found ${items.length}`);
        return items[0];
      },
      async as(app, account) {
        return make({ ...jar, [app]: await live.logIn(ws, app, account) });
      },
      async signUp(app, person) {
        const cookies = await live.signIn(ws, app, { email: person.email, password: person.password, name: person.name });
        if (meter) meter.signUp = true;
        return make({ ...jar, [app]: cookies });
      },
    };
    return api;
  };
  return make({});
}

const json = new JsonOracle();
const judge = async (answer, oracle) => json.check(Buffer.from(JSON.stringify(answer)), oracle);
const notes = (r) => r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.note ?? "failed"}`).join("; ");
const stepSaid = (s) => `${s.verdict} ${JSON.stringify(s.checks ?? []).slice(0, 400)}`;
const levelText = (lv) => (lv ? `${lv.level}${lv.veryHard ? " (very hard)" : ""}` : "no level");
/** The sites' clock and this one's are the same machine's or near it: a time this close to a step's window is in it. */
const SKEW_MS = 250;
/** The checks of a state step whose time falls outside the window its reference solution ran in. */
const misplaced = (s, window) =>
  (s.checks ?? []).filter((c) => c.at && (Date.parse(c.at) < window.from - SKEW_MS || Date.parse(c.at) > window.to + SKEW_MS)).map((c) => `${c.name} at ${c.at}`);

export async function runCujIntegrity({ base, seed = 4242, scale = 1, operatorKey }) {
  const corpus = buildCorpus({ seed, scale, scenario: "cuj-v1" });
  if (corpus.problems.length) throw new Error(corpus.problems.join("; "));
  const live = liveBenchme({ base, operatorKey });
  const ws = await live.mint("cuj-v1", seed);
  const sessions = {};
  for (const app of SITES) sessions[app] = await live.signIn(ws, app, { email: EMAIL });
  const specOf = new Map(corpus.specs.map((s) => [s.id, s]));
  const surprises = [];
  const surprise = (id, what) => {
    surprises.push(`${id}: ${what}`);
    console.error(`✗ ${id}: ${what}`);
  };
  let seen = 0;
  const passed = (label, checked) => {
    const n = surprises.length - seen;
    seen = surprises.length;
    console.log(`${label}: ${checked} checked, ${n === 0 ? "all as expected" : `${n} surprise(s)`}`);
  };
  const steps = corpus.corpus.reduce((n, r) => n + 1 + r.steps.length, 0);
  console.log(`workspace ${ws} (cuj-v1) — ${corpus.corpus.length} tasks, ${steps} steps, ${corpus.specs.length} verifier keys`);

  let byTools = 0;
  for (const app of SITES) {
    try {
      if (await live.signInThroughTools(ws, app, "tools-integrity@example.com")) byTools++;
    } catch (err) {
      surprise(app, `an agent with only its MCP tools cannot sign in: ${err.message}`);
    }
  }
  passed("pass 0 — an account signs up and in through MCP tools alone, on every site", byTools);

  for (const r of corpus.corpus.filter((x) => specOf.has(x.id))) {
    const res = await live.submit(ws, r.id, {});
    if (res.verdict !== "FAIL") surprise(r.id, `passes BEFORE anything was done — ${res.verdict}`);
    for (const s of res.steps ?? []) if (s.verdict !== "FAIL") surprise(r.id, `step ${s.step} passes BEFORE anything was done — ${stepSaid(s)}`);
  }
  passed("pass 1 — every task the verifier checks, and each of its state steps, fails on a fresh workspace", specOf.size);

  const solved = new Set();
  const windowsOf = {};
  for (const r of corpus.corpus) {
    const { built, props: declared } = corpus.plans[r.id];
    const spec = specOf.get(r.id);
    if (built.tempting) {
      try {
        if (!(await built.tempting.check(apiFor(live, ws, sessions, null)))) surprise(r.id, `its tempting option is not there live: ${built.tempting.what}`);
      } catch (err) {
        surprise(r.id, `its tempting option could not be read: ${err.message}`);
      }
    }
    const meter = new Meter();
    const api = apiFor(live, ws, sessions, meter);
    const windows = (windowsOf[r.id] = {});
    let ok = true;
    for (const [i, step] of built.steps.entries()) {
      const n = i + 1;
      meter.step();
      if (step.kind === "state") {
        const from = Date.now();
        try {
          await step.solve(api);
        } catch (err) {
          surprise(r.id, `step ${n}'s reference solution failed: ${err.message}`);
          ok = false;
          break;
        }
        windows[n] = { from, to: Date.now() };
        const res = await live.submit(ws, r.id, {});
        for (const s of res.steps ?? []) {
          const want = s.step <= n ? "OK" : "FAIL";
          if (s.verdict !== want) {
            surprise(r.id, `after step ${n}'s reference solution, step ${s.step} is ${s.verdict}, not ${want} — ${stepSaid(s)}`);
            ok = false;
          }
          const off = s.step <= n ? misplaced(s, windows[s.step]) : [];
          if (off.length) {
            surprise(r.id, `after step ${n}, step ${s.step}'s checks stand on writes made outside it: ${off.join(", ")}`);
            ok = false;
          }
        }
      } else {
        let answer;
        try {
          answer = await step.answer(api);
        } catch (err) {
          surprise(r.id, `step ${n}: the live sites could not answer it: ${err.message}`);
          ok = false;
          break;
        }
        const right = await judge(answer, step.oracle);
        if (right.verdict !== "OK") {
          surprise(r.id, `step ${n}: the live sites answer ${JSON.stringify(answer)}, its key refuses it — ${notes(right)}`);
          ok = false;
        }
        if ((await judge(perturb(step.oracle.expect), step.oracle)).verdict !== "FAIL") surprise(r.id, `step ${n}: a wrong answer passes its key`);
        if (spec && built.steps.length === 1) {
          if ((await live.submit(ws, r.id, answer)).verdict !== "OK") surprise(r.id, `the verifier refuses the live answer ${JSON.stringify(answer)}`);
          if ((await live.submit(ws, r.id, perturb(step.oracle.expect))).verdict !== "FAIL") surprise(r.id, "the verifier accepts a wrong answer");
        }
      }
    }
    if (!ok) continue;
    const m = meter.props();
    if (built.impossible && !m.refusals.includes(built.impossible.code)) surprise(r.id, `its attempt was refused with ${m.refusals.join(", ") || "nothing"}, not ${built.impossible.code}`);
    if (built.recover && !m.refusals.includes(built.recover.code)) surprise(r.id, `the failure it recovers from was ${m.refusals.join(", ") || "nothing"}, not ${built.recover.code}`);
    for (const k of MEASURED) if (JSON.stringify(m[k]) !== JSON.stringify(declared[k])) surprise(r.id, `declares ${k} ${JSON.stringify(declared[k])}; its reference solution shows ${JSON.stringify(m[k])}`);
    const lv = levelOf({ ...declared, ...Object.fromEntries(MEASURED.map((k) => [k, m[k]])) });
    if (!lv || lv.level !== r.level || lv.veryHard !== r.veryHard) surprise(r.id, `is labelled ${levelText({ level: r.level, veryHard: r.veryHard })}; what its reference solution shows gives ${levelText(lv)}`);
    solved.add(r.id);
  }
  passed("pass 2 — every task, step by step: its checks bite in order, its keys match the live sites, its level is what its solution shows", corpus.corpus.length);

  for (const r of corpus.corpus.filter((x) => solved.has(x.id))) {
    const { built } = corpus.plans[r.id];
    if (specOf.has(r.id) && r.stateChecked) {
      const res = await live.submit(ws, r.id, {});
      if (res.verdict !== "OK") surprise(r.id, `passed, then failed once every other solution ran — ${(res.steps ?? []).filter((s) => s.verdict !== "OK").map(stepSaid).join(" | ")}`);
      for (const s of res.steps ?? []) {
        const off = misplaced(s, windowsOf[r.id][s.step]);
        if (off.length) surprise(r.id, `once every solution ran, step ${s.step}'s checks stand on writes made outside it: ${off.join(", ")}`);
      }
    }
    const api = apiFor(live, ws, sessions, null);
    for (const [i, step] of built.steps.entries()) {
      if (step.kind !== "json") continue;
      try {
        const answer = await step.answer(api);
        const right = await judge(answer, step.oracle);
        if (right.verdict !== "OK") surprise(r.id, `step ${i + 1}'s key no longer matches the live sites once every solution ran: ${JSON.stringify(answer)} — ${notes(right)}`);
      } catch (err) {
        surprise(r.id, `step ${i + 1} can no longer be answered once every solution ran: ${err.message}`);
      }
    }
  }
  passed("pass 3 — every check still passes, and every key still matches, once every solution ran", solved.size);

  if (surprises.length) {
    console.error(`\n${surprises.length} surprise(s) in ${corpus.corpus.length} tasks`);
    return 1;
  }
  const by = (level) => corpus.corpus.filter((x) => x.level === level).length;
  console.log(`\nall ${corpus.corpus.length} cuj-v1 tasks bite: ${by("easy")} easy, ${by("medium")} medium, ${by("hard")} hard (${corpus.corpus.filter((x) => x.veryHard).length} very hard), ${by("impossible")} impossible`);
  return 0;
}
