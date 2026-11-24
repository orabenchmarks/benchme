/**
 * The proof of the expected calls (docs/scenarios/cuj-v1.md § Expected calls),
 * against a live benchme: in a SECOND fresh workspace of the corpus's scenario,
 * at its seed, every task is done with nothing but its expected calls, made
 * through each site's MCP server, in corpus order, and after each state step
 * whose calls ran every state step up to it that has calls passes the verifier.
 * A step with no call (an impossible one, a question none of whose reads is the
 * only way, a change two tools make alike) is not done, so neither is it
 * checked; a question's reads are made, and must be answered.
 *
 * So the calls a key publishes are the very calls proven: each is the
 * template's concrete call (./../intent-corpus/calls.mjs), a value the run
 * makes read from the results of the calls before it, and nothing else is
 * done. The sign-in is the only thing besides: on each site, as the person a
 * step's checks say the change is made as (an `actor` of its ledger checks,
 * signed up first when a check finds that account confirmed by its code), or
 * else as an account of the pass's own, signed up through the tools.
 *
 *   proveExpectedCalls({ live, scenario, seed, tasks, accounts, surprise }) → how many state steps passed on their calls alone
 *
 * `tasks` are [{ id, stepped, steps: [{ kind, apps, calls, oracle }] }] in corpus order (`stepped`: the verifier
 * answers the task step by step); `accounts` the scenario's seeded accounts by site, with their passwords.
 */
import { concreteArgs } from "../intent-corpus/calls.mjs";
import { passwordFor } from "../intent-corpus/cuj/kit.mjs";
import { siteOf } from "../intent-corpus/expected-calls.mjs";

const OWN = "calls-integrity@example.com";
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const lower = (s) => String(s).trim().toLowerCase();

/** The ledger matchers of a step's checks. */
const matchersOf = (oracle) => (oracle?.kind === "state" ? oracle.checks.filter((c) => c.kind === "ledger").flatMap((c) => asList(c.match)) : []);

/**
 * Who a task's calls on `app` are made as: the actor a ledger check of the step names there, else one any step of the
 * task names there (a task acts as one person on a site), else nobody in particular (the pass's own account). A
 * person a check finds confirmed by an emailed code is signed up first.
 */
function actorOf(task, i, app) {
  const named = (steps) => steps.flatMap((s) => matchersOf(s.oracle)).find((m) => lower(m.app) === app && typeof m.actor === "string")?.actor;
  const email = named([task.steps[i]]) ?? named(task.steps);
  if (!email) return null;
  const confirmed = task.steps.flatMap((s) => matchersOf(s.oracle)).some((m) => lower(m.app) === app && m.action === "verify" && m.entity?.type === "account" && lower(m.entity.id) === lower(email));
  return { email: lower(email), signUp: confirmed };
}

/** The calls a run made so far in one task, and the latest result of a tool (on a site), for the values the run makes. */
function runOf() {
  const results = [];
  return {
    results,
    last(functionName, app) {
      const hit = results.filter((r) => r.functionName === functionName && (!app || r.app === app)).at(-1);
      if (!hit) throw new Error(`no ${functionName} was made before the call that needs its result`);
      return hit.result;
    },
  };
}

export async function proveExpectedCalls({ live, scenario, seed, tasks, accounts = {}, surprise }) {
  const ws = await live.mint(scenario, seed);
  const sessions = new Map();
  const sessionFor = async (app, who) => {
    const email = who?.email ?? OWN;
    const key = `${app} ${email}`;
    if (!sessions.has(key)) {
      const seeded = (accounts[app] ?? []).find((a) => lower(a.email) === email);
      const account = seeded ? { email, password: seeded.password, signUp: false } : { email, password: who ? passwordFor(email) : `pw-${Math.random().toString(36).slice(2)}-X9`, signUp: !who || who.signUp };
      sessions.set(key, live.toolSession(ws, app, account));
    }
    return sessions.get(key);
  };
  let proven = 0;
  for (const task of tasks) {
    const run = runOf();
    const done = new Set();
    try {
      for (const [i, step] of task.steps.entries()) {
        if (!step.calls.length) continue;
        for (const c of step.calls) {
          const app = siteOf(c, step.apps);
          const session = await sessionFor(app, actorOf(task, i, app));
          let result;
          try {
            result = await live.tool(ws, app, c.functionName, concreteArgs(c.args, run), session);
          } catch (err) {
            throw new Error(`step ${i + 1}: ${err.message}`);
          }
          run.results.push({ functionName: c.functionName, app, result });
        }
        if (step.kind !== "state") continue;
        done.add(i + 1);
        const res = await live.submit(ws, task.id, {});
        // A task without steps is answered as one verdict; a stepped one per state step, of which those that had calls must pass.
        const failing = task.stepped ? (res.steps ?? []).filter((s) => done.has(s.step) && s.verdict !== "OK") : res.verdict === "OK" ? [] : [{ step: 1, verdict: res.verdict, checks: res.details }];
        if (failing.length) throw new Error(`after step ${i + 1}'s calls, ${failing.map((s) => `step ${s.step} is ${s.verdict} ${JSON.stringify(s.checks ?? []).slice(0, 300)}`).join("; ")}`);
        if (task.stepped && !(res.steps ?? []).some((s) => s.step === i + 1)) throw new Error(`the verifier's answer has no step ${i + 1}`);
      }
      proven += done.size;
    } catch (err) {
      surprise(task.id, `with nothing but its expected calls: ${err.message}`);
    }
  }
  return proven;
}

/** A webmcp-v1-shaped corpus's tasks as the pass takes them: one step each, on the task's site. */
export const taskStepsOf = (corpus) =>
  corpus.tasks
    .map((t) => ({ t, spec: corpus.specs.find((s) => s.id === t.id) }))
    .map(({ t, spec }) => ({ id: t.id, stepped: false, steps: [{ kind: spec.oracle.kind, apps: [t.app], calls: corpus.calls[t.id] ?? [], oracle: spec.oracle }] }));

/** cuj-v1's tasks as the pass takes them, step by step from each task's plan. */
export const cujStepsOf = (corpus) =>
  corpus.corpus.map((r) => {
    const { built } = corpus.plans[r.id];
    return { id: r.id, stepped: true, steps: built.steps.map((s) => ({ kind: s.kind, apps: s.apps ?? built.apps, calls: s.calls, oracle: s.oracle })) };
  });
