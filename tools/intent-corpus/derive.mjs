/**
 * Runs the template registry over seeded rows.
 *
 *   deriveTemplated(rows, { seed, scale, claimed, taken, templates, graded }) → { problems, specs, tasks, md, solutions, answers, calls, expectedCalls }
 *
 * A `graded` corpus (webmcp-v1's) is graded by more than the verifier: every
 * task carries the judge criteria its template writes (`rubric`, public, held to
 * ../rubrics.mjs' rules) and the calls every correct solution through the site's
 * tools makes (`calls`, checked against the site's registry by
 * ./expected-calls.mjs; published into the key only). A template that breaks a
 * rule refuses the corpus.
 *
 * Each template walks its candidates in its OWN seeded order (streamFor), so
 * the corpus is a pure function of (seed, scale), and a template appended to
 * the registry never moves an earlier template's picks. Claims are shared, so
 * a different `scale` can move later templates' picks — a consumer pins a
 * corpus COMMIT, never an id across scales.
 */
import { shuffle } from "../../packages/scenarios/dist/index.js";
import { stepCalls } from "./expected-calls.mjs";
import { contextOf, streamFor } from "./kit.mjs";
import { criteriaProblem } from "./rubrics.mjs";
import { TEMPLATES } from "./templates/index.mjs";

/**
 * A json task whose intent contains its own expected value — the rule
 * apps/verify/src/specs/spec.test.ts holds every task to, applied here so a
 * pick that would break it is skipped instead: a number inside an id ("6" in
 * C-126) counts, which is why small counts pick their entities around it.
 */
function leaksItsAnswer(built) {
  if (built.oracle.kind !== "json") return false;
  const intent = built.intent.toLowerCase();
  return Object.values(built.oracle.expect).some((v) => (typeof v === "number" || typeof v === "string") && intent.includes(String(v).toLowerCase()));
}

/** The next free intent-<stem>-NN (the original ten already hold some -01s). */
function nextId(stem, taken) {
  for (let n = 1; ; n++) {
    const id = `intent-${stem}-${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** Why a graded task's criteria or calls are not a task's, or null (the template's mistake: the corpus is refused). */
function gradedProblem(template, built) {
  const criteria = criteriaProblem(built.rubric, { where: "the task", lo: 2, hi: 6, oracles: [built.oracle], intents: [built.intent], hidden: built.hidden });
  if (criteria) return criteria;
  const calls = stepCalls(built.calls, { apps: [template.app], kind: built.oracle.kind, noCall: built.noCall });
  return calls.problem ?? null;
}

export function deriveTemplated(rows, { seed, scale = 1, claimed = [], taken = [], templates = TEMPLATES, graded = false }) {
  const ctx = contextOf(rows);
  const claims = new Set(claimed);
  const ids = new Set(taken);
  const out = { problems: [], specs: [], tasks: [], solutions: {}, answers: {}, calls: {}, expectedCalls: {}, sections: [] };
  for (const template of templates) {
    const want = Math.max(1, Math.round(template.count * scale));
    const rng = streamFor(seed, template.key);
    const notes = [];
    for (const pick of shuffle(rng, template.candidates(ctx))) {
      if (notes.length >= want) break;
      const keys = template.claims(pick, ctx);
      if (keys.some((k) => claims.has(k))) continue;
      const built = template.build(pick, ctx, rng);
      if (!built || leaksItsAnswer(built)) continue;
      const problem = graded ? gradedProblem(template, built) : null;
      if (problem) {
        out.problems.push(`template "${template.key}": ${problem}`);
        break;
      }
      for (const k of keys) claims.add(k);
      const id = nextId(template.key, ids);
      ids.add(id);
      out.specs.push({ id, blind: false, oracle: built.oracle });
      // A graded task's criteria are public, right after the prompt they judge the reply to.
      out.tasks.push({ id, surfaces: template.surfaces, app: template.app, intent: built.intent, ...(graded ? { rubric: built.rubric } : {}), oracle: template.oracle, summary: built.summary });
      if (built.solve) out.solutions[id] = built.solve;
      if (built.answer) out.answers[id] = built.answer;
      if (graded) {
        out.calls[id] = built.calls;
        const { published } = stepCalls(built.calls, { apps: [template.app], kind: built.oracle.kind, noCall: built.noCall });
        if (published.length) out.expectedCalls[id] = published;
      }
      notes.push(`- **${id}** — ${built.note}`);
    }
    // Fewer than asked is fine (a template runs out of distinct picks); NONE
    // means the template no longer fits the scenario — a silent zero would
    // shrink the corpus without anyone noticing.
    if (notes.length === 0) out.problems.push(`template "${template.key}" produced no task for seed ${seed}`);
    out.sections.push(`### ${template.key} (${template.oracle}, ${template.app}) — ${notes.length} task${notes.length === 1 ? "" : "s"}\n\n${template.about}\n\n${notes.join("\n")}\n`);
  }
  const md = `\n## Templated tasks (tools/intent-corpus/templates/)\n\nEvery task below comes from a template: one kind of intent, instantiated over\ndistinct seeded rows, its answer key derived from those rows. No two tasks\ntouch the same row, so the state tasks stay independent inside one\nworkspace. \`node tools/intent-integrity.mjs\` proves each one against a live\nbenchme: every state task FAILS on a fresh workspace and PASSES once its\nreference solution has run; every json task's answer, read back from the\nlive apps, is accepted, and a wrong one is refused.\n\n${out.sections.join("\n")}`;
  return { problems: out.problems, specs: out.specs, tasks: out.tasks, md, solutions: out.solutions, answers: out.answers, calls: out.calls, expectedCalls: out.expectedCalls };
}
