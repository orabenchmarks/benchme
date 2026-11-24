/**
 * One intent corpus per scenario for one (seed, scale): acme-v1's (the original
 * ten, then its templates), webmcp-v1's (the sites from webmcp-tools) and
 * cuj-v1's (critical user journeys over the same sites, in focus areas and
 * levels, some over several steps: ./cuj/) — and the files each is written as.
 *
 *   buildCorpus({ seed, scale, scenario }) → { problems, scenario, files, specs, tasks, corpus, md, suite, solutions, answers, calls }
 *   corpusFiles(corpus)                    → Map<file name, content>
 *   CORPORA                                → every corpus, by scenario
 *
 * webmcp-v1's and cuj-v1's records are graded by more than the verifier: each
 * step has judge criteria (`rubric`, public) and the site tool calls every
 * correct solution makes (`expectedCall`, in the key only), and the corpus has
 * those calls as a webmcp-evals suite too (`suite`, answer-key material).
 */
import { acmeV1, cujV1, webmcpV1 } from "../../packages/scenarios/dist/index.js";
import { buildCujCorpus } from "./cuj/build.mjs";
import { deriveTemplated } from "./derive.mjs";
import { deriveOriginal } from "./original.mjs";
import { webmcpEvalsSuite } from "./suite.mjs";
import { TEMPLATES_BY_SCENARIO } from "./templates/index.mjs";

const NO_ORIGINAL = { problems: [], specs: [], tasks: [], md: "", claims: [], solutions: {}, answers: {} };

/**
 * The corpora (a registry: a scenario gets a corpus by an entry here and a
 * template list in templates/index.mjs). Every task runs in a fresh workspace
 * of its corpus's scenario. The spec files of all corpora share one directory
 * (the verifier reads `<taskId>.json` by id), so their ids never collide; each
 * corpus has its own public files. A corpus with its own `build` makes its
 * specs, public rows and graded records itself (cuj-v1's records carry an
 * area, a level and steps). A `graded` corpus's templates write each task's
 * criteria and expected calls (./derive.mjs); `files.suite` is the corpus's
 * expected calls as a webmcp-evals suite.
 */
export const CORPORA = [
  {
    scenario: acmeV1,
    title: "Intent corpus",
    original: deriveOriginal,
    files: { tasks: "intent-tasks.json", corpus: "intent-corpus.json", md: "intent-tasks.md" },
  },
  {
    scenario: webmcpV1,
    title: "webmcp-v1 intent corpus",
    original: () => NO_ORIGINAL,
    graded: true,
    files: { tasks: "webmcp-tasks.json", corpus: "webmcp-corpus.json", md: "webmcp-tasks.md", suite: "webmcp-v1.webmcp-evals.json" },
  },
  {
    scenario: cujV1,
    title: "cuj-v1 corpus",
    build: (rows, { seed, scale }) => buildCujCorpus(rows, { seed, scale }),
    files: { tasks: "cuj-tasks.json", corpus: "cuj-corpus.json", md: "cuj-tasks.md" },
  },
];

export function corpusOf(scenario) {
  const def = CORPORA.find((c) => c.scenario.key === scenario);
  if (!def) throw new Error(`no intent corpus for scenario "${scenario}"; there is one for ${CORPORA.map((c) => c.scenario.key).join(", ")}`);
  return def;
}

export function buildCorpus({ seed = 4242, scale = 1, scenario = "acme-v1" } = {}) {
  const def = corpusOf(scenario);
  const rows = def.scenario.generate(seed);
  if (def.build) {
    const built = def.build(rows, { seed, scale });
    if (built.problems.length) return { problems: built.problems };
    return { problems: [], scenario, files: def.files, specs: built.specs, tasks: built.tasks, corpus: built.corpus, md: built.md, plans: built.plans, accounts: built.accounts };
  }
  const original = def.original(rows, seed);
  if (original.problems.length) return { problems: original.problems };
  const templated = deriveTemplated(rows, { seed, scale, claimed: original.claims, taken: original.tasks.map((t) => t.id), templates: TEMPLATES_BY_SCENARIO[scenario], graded: !!def.graded });
  if (templated.problems.length) return { problems: templated.problems };

  const specs = [...original.specs, ...templated.specs];
  const tasks = [...original.tasks, ...templated.tasks];
  const specOf = new Map(specs.map((s) => [s.id, s]));
  // What a platform that grades answers ITSELF imports: each public task with
  // its answer key beside it, and in a graded corpus the calls every correct
  // solution makes. The tasks file stays the answer-free half.
  const callsOf = templated.expectedCalls ?? {};
  const corpus = tasks.map((t) => ({ ...t, key: { blind: specOf.get(t.id).blind, oracle: specOf.get(t.id).oracle, ...(callsOf[t.id] ? { expectedCall: callsOf[t.id] } : {}) } }));
  const suite = def.files.suite ? webmcpEvalsSuite(tasks.map((t) => ({ id: t.id, apps: [t.app], intents: [t.intent], calls: callsOf[t.id] }))) : undefined;
  const kinds = (kind) => tasks.filter((t) => t.oracle === kind).length;
  const md = `# ${def.title}

${tasks.length} natural-language intent tasks (${kinds("state")} state, ${kinds("json")} json) against a fresh \`${scenario}\` workspace
(\`node tools/intent-corpus.mjs --seed ${seed}${scale === 1 ? "" : ` --scale ${scale}`}\`). Every derived value comes
from \`@benchme/scenarios\`' generator or \`answers.ts\` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs, \`${def.files.tasks}\` and \`${def.files.corpus}\` together. All of them
assume the SAME fresh workspace (seed ${seed}); none of them create their own
workspace.

${original.md}${templated.md}`;
  return {
    problems: [],
    scenario,
    files: def.files,
    specs,
    tasks,
    corpus,
    md,
    suite,
    solutions: { ...original.solutions, ...templated.solutions },
    answers: { ...original.answers, ...templated.answers },
    calls: templated.calls ?? {},
  };
}

/** Every file one corpus is written as: one answer key per task, the public half, the graded corpus, the derivations, the suite. */
export function corpusFiles(c) {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  return new Map([
    ...c.specs.map((s) => [`${s.id}.json`, json(s)]),
    [c.files.tasks, json(c.tasks)],
    [c.files.corpus, json(c.corpus)],
    [c.files.md, c.md],
    ...(c.files.suite ? [[c.files.suite, json(c.suite)]] : []),
  ]);
}
