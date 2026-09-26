/**
 * The whole intent corpus for one (seed, scale): the original ten, then every
 * template's tasks — and the files it is written as.
 *
 *   buildCorpus({ seed, scale }) → { problems, specs, tasks, corpus, md, solutions, answers }
 *   corpusFiles(corpus)          → Map<file name, content>
 */
import { acmeV1 } from "../../packages/scenarios/dist/index.js";
import { deriveTemplated } from "./derive.mjs";
import { deriveOriginal } from "./original.mjs";

export function buildCorpus({ seed = 4242, scale = 1 } = {}) {
  const rows = acmeV1.generate(seed);
  const original = deriveOriginal(rows, seed);
  if (original.problems.length) return { problems: original.problems };
  const templated = deriveTemplated(rows, { seed, scale, claimed: original.claims, taken: original.tasks.map((t) => t.id) });
  if (templated.problems.length) return { problems: templated.problems };

  const specs = [...original.specs, ...templated.specs];
  const tasks = [...original.tasks, ...templated.tasks];
  const specOf = new Map(specs.map((s) => [s.id, s]));
  // What a platform that grades answers ITSELF imports: each public task with
  // its answer key beside it. intent-tasks.json stays the answer-free half.
  const corpus = tasks.map((t) => ({ ...t, key: { blind: specOf.get(t.id).blind, oracle: specOf.get(t.id).oracle } }));
  const kinds = (kind) => tasks.filter((t) => t.oracle === kind).length;
  const md = `# Intent corpus

${tasks.length} natural-language intent tasks (${kinds("state")} state, ${kinds("json")} json) against a fresh \`acme-v1\` workspace
(\`node tools/intent-corpus.mjs --seed ${seed}${scale === 1 ? "" : ` --scale ${scale}`}\`). Every derived value comes
from \`@benchme/scenarios\`' generator or \`answers.ts\` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs, \`intent-tasks.json\` and \`intent-corpus.json\` together. All of them
assume the SAME fresh workspace (seed ${seed}); none of them create their own
workspace.

${original.md}${templated.md}`;
  return {
    problems: [],
    specs,
    tasks,
    corpus,
    md,
    solutions: { ...original.solutions, ...templated.solutions },
    answers: { ...original.answers, ...templated.answers },
  };
}

/** Every file the corpus is written as: one answer key per task, the public half, the graded corpus, the derivations. */
export function corpusFiles(c) {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  return new Map([
    ...c.specs.map((s) => [`${s.id}.json`, json(s)]),
    ["intent-tasks.json", json(c.tasks)],
    ["intent-corpus.json", json(c.corpus)],
    ["intent-tasks.md", c.md],
  ]);
}
