/**
 * Builds the cuj-v1 corpus from its templates (./templates/index.mjs).
 *
 *   buildCujCorpus(rows, { seed, scale }) → { problems, specs, tasks, corpus, md, plans }
 *
 * `corpus` is one record per task in the shape the contract fixes
 * (docs/scenarios/cuj-v1.md § The corpus record); `tasks` is the same records
 * without their keys; `specs` are the verifier's hidden `<id>.json`; `plans`
 * hold, for tools/intent-integrity.mjs, each step's reference solution or
 * answer reader and the countable properties the task declares. Plans never
 * ship.
 *
 * A template declares a task's countable properties, never its level: the
 * level is `levelOf` them (./levels.mjs). Each template walks its candidates
 * in its own seeded order, and claims are shared, so no two tasks touch the
 * same rows and every task's checks stay true in one workspace whatever the
 * others do. Every task that changes something gets one more check on its
 * last state step, from ./actors.mjs: no change made as anyone else.
 */
import { shuffle } from "../../../packages/scenarios/dist/index.js";
import { streamFor } from "../kit.mjs";
import { criteriaProblem, expectedValues, said } from "../rubrics.mjs";
import { heldAddresses, ownAccounts, withActorGuard } from "./actors.mjs";
import { contextOf } from "./context.mjs";
import { AREAS, LEVELS, LEVEL_TEXT, NO_EASY, levelOf } from "./levels.mjs";
import { CUJ_TEMPLATES } from "./templates/index.mjs";

const KNOWN_APPS = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"];
/** Nothing in a prompt says where a site is, or that anything will be checked. */
const NOT_IN_A_PROMPT = [/https?:\/\//i, /\blocalhost\b/i, /\/w\//, /\b(verif(y|ier|ied)|rubric|grad(e|ed|er|ing)|benchmark|scor(e|ed|ing)|integrity|oracle)\b/i];

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Why this pick is no task (its answer would be in its own prompt; a declared rule or interaction does not bite here). */
function pickIssue(built) {
  const intents = built.steps.map((s) => s.intent);
  for (const s of built.steps) for (const v of expectedValues(s.oracle)) if (intents.some((i) => said(i, v))) return `an intent states its own answer ${v}`;
  for (const v of asList(built.hidden)) if (intents.some((i) => said(i, v))) return `an intent names ${v}, which the task must find`;
  if (built.rule && JSON.stringify(built.rule.naive) === JSON.stringify(built.rule.actual)) return "the rule changes nothing here";
  if (built.interacting && built.interacting.greedyBreaks !== true) return "the constraints do not interact here";
  return null;
}

/** Why a built task is not a task at all: a template's mistake, which refuses the corpus rather than skip the pick. */
function templateProblem(built) {
  const steps = built.steps ?? [];
  if (steps.length < 1 || steps.length > 8) return `a task has 1 to 8 steps, not ${steps.length}`;
  if (!Array.isArray(built.apps) || built.apps.length < 1 || built.apps.length > 4 || built.apps.some((a) => !KNOWN_APPS.includes(a))) return `apps must be 1 to 4 of the nine sites, not ${JSON.stringify(built.apps)}`;
  if (!built.summary) return "no summary";
  if (!built.effort || !Number.isInteger(built.effort.reads) || !Number.isInteger(built.effort.writes)) return "no effort { reads, writes }";
  const stepApps = steps.map((s) => s.apps ?? (built.apps.length === 1 ? built.apps : null));
  if (stepApps.some((a) => !a)) return "every step of a task on several sites says which apps it touches";
  const met = [...new Set(stepApps.flat())];
  if (JSON.stringify(met) !== JSON.stringify(built.apps)) return `apps ${JSON.stringify(built.apps)} are not the steps' apps in the order met (${JSON.stringify(met)})`;
  const intents = steps.map((s) => s.intent);
  for (const [i, s] of steps.entries()) {
    const where = `step ${i + 1}`;
    if (!s.intent || typeof s.intent !== "string") return `${where} has no intent`;
    for (const re of NOT_IN_A_PROMPT) if (re.test(s.intent)) return `${where}'s intent says ${re} (a prompt names no place and no grading)`;
    const criteria = criteriaProblem(s.rubric, { where, lo: i === 0 ? 2 : 1, hi: 6, oracles: steps.map((x) => x.oracle), intents, hidden: built.hidden });
    if (criteria) return criteria;
    if (s.kind !== s.oracle?.kind || !["json", "state"].includes(s.kind)) return `${where}: kind ${s.kind} and oracle ${s.oracle?.kind} disagree`;
    if (s.kind === "json" && typeof s.answer !== "function") return `${where} is json and has no answer reader`;
    if (s.kind === "state" && typeof s.solve !== "function") return `${where} is state and has no reference solution`;
    if (i > 0) {
      // A later step carries a fact the earlier ones did not, so it cannot be done early.
      if (!s.fact) return `${where} names no fact of its own`;
      if (!said(s.intent, s.fact)) return `${where}'s fact "${s.fact}" is not in its intent`;
      if (steps.slice(0, i).some((e) => said(e.intent, s.fact))) return `${where}'s fact "${s.fact}" is already in an earlier step`;
    }
  }
  if (built.target && !said(steps[0].intent, built.target)) return `the named target ${built.target} is not in the prompt`;
  for (const c of asList(built.constraints)) if (!intents.some((i) => said(i, c))) return `the constraint "${c}" is in no prompt`;
  if (built.tempting && typeof built.tempting.check !== "function") return "a tempting option needs a live check";
  if (built.recover && !built.recover.code) return "a recovery names the code the first attempt is refused with";
  if (built.impossible?.none !== undefined) {
    // A "which one" question no option meets is answered, not attempted: one json step whose key says none was
    // found, and a near miss checked live, so "none" is right because of the requirement it fails.
    if (steps.length !== 1 || steps[0].kind !== "json" || steps[0].oracle.expect?.found !== false) return "a task no option meets is one json step whose key is {\"found\": false}";
    if (!built.tempting) return "a task no option meets names its near miss (tempting), checked live";
  } else if (built.impossible) {
    if (!built.impossible.code) return "an impossible task names the code its attempt is refused with";
    const last = steps[built.impossible.step ?? steps.length - 1];
    const kinds = (last?.oracle?.checks ?? []).map((c) => c.kind);
    if (!kinds.includes("unchanged") || !kinds.includes("ledger")) return "an impossible step checks that nothing changed and that the agent looked or was refused";
  }
  return null;
}

/** The countable properties a task declares (./levels.mjs), as its reference solution is planned to show them. */
export function declaredProps(built) {
  const steps = built.steps;
  return {
    sites: built.apps,
    stepSites: steps.map((s) => s.apps ?? built.apps),
    steps: steps.length,
    reads: built.effort.reads,
    writes: built.effort.writes,
    named: !!built.target,
    constraints: asList(built.constraints).length,
    rule: !!built.rule,
    tempting: !!built.tempting,
    signUp: !!built.signUp,
    interacting: !!built.interacting,
    recovered: !!built.recover,
    impossible: !!built.impossible,
  };
}

function recordOf(id, template, built, lv) {
  const [first, ...rest] = built.steps;
  // Present, and true, when a step's oracle is a state check; absent otherwise (never false): a consumer that
  // asks whether the field is there to decide whether to call the verifier never calls it for a reply-only task.
  const stateChecked = built.steps.some((s) => s.oracle.kind === "state");
  return {
    id,
    area: template.area,
    level: lv.level,
    veryHard: lv.veryHard,
    apps: built.apps,
    app: built.apps[0],
    surfaces: template.surfaces,
    intent: first.intent,
    rubric: first.rubric,
    steps: rest.map((s) => ({ intent: s.intent, rubric: s.rubric, kind: s.kind })),
    kind: first.kind,
    ...(stateChecked ? { stateChecked: true } : {}),
    summary: built.summary,
    key: { blind: false, oracle: first.oracle, steps: rest.map((s) => ({ oracle: s.oracle })) },
  };
}

export function buildCujCorpus(rows, { seed, scale = 1, templates = CUJ_TEMPLATES } = {}) {
  const ctx = contextOf(rows);
  const held = heldAddresses(rows);
  // A person who already has an account belongs to the journeys that sign in as them; no other task names them.
  const claims = new Set(ctx.accountPeople);
  const out = { problems: [], specs: [], tasks: [], corpus: [], plans: {}, sections: [] };
  /** Every task as built, in corpus order: records are written once all are known (the actor guard needs them all). */
  const picked = [];
  const keys = new Set();
  for (const template of templates) {
    if (keys.has(template.key)) out.problems.push(`template key ${template.key} is used twice`);
    keys.add(template.key);
    if (!AREAS.includes(template.area)) out.problems.push(`template ${template.key}: no area ${template.area}`);
    const want = Math.max(1, Math.round(template.count * scale));
    const rng = streamFor(seed, `cuj:${template.key}`);
    const notes = [];
    for (const pick of shuffle(rng, template.candidates(ctx))) {
      if (notes.length >= want) break;
      const taken = template.claims(pick, ctx);
      if (taken.some((k) => claims.has(k))) continue;
      const built = template.build(pick, ctx, rng);
      if (!built || pickIssue(built)) continue;
      // What the pick turned out to write about, known only once built: claimed like the rest.
      const more = built.claims ?? [];
      if (more.some((k) => claims.has(k))) continue;
      const problem = templateProblem(built);
      if (problem) {
        out.problems.push(`template ${template.key}: ${problem}`);
        break;
      }
      const props = declaredProps(built);
      const lv = levelOf(props);
      if (!lv) {
        out.problems.push(`template ${template.key}: its properties fit no level (${JSON.stringify(props)})`);
        break;
      }
      for (const k of [...taken, ...more]) claims.add(k);
      const id = `cuj-${template.key}-${String(notes.length + 1).padStart(2, "0")}`;
      picked.push({ id, template, built, lv, props });
      notes.push(`- **${id}** — ${lv.level}${lv.veryHard ? " (very hard)" : ""}: ${built.note ?? built.summary}`);
    }
    if (notes.length === 0) out.problems.push(`template ${template.key} produced no task for seed ${seed}`);
    out.sections.push(`### ${template.key} (${template.area}; ${template.surfaces.join(", ")}) — ${notes.length} task${notes.length === 1 ? "" : "s"}\n\n${template.about}\n\n${notes.join("\n")}\n`);
  }
  // Every task is known now, so the actor guard (./actors.mjs) can leave out the accounts any task signs in as: their
  // writes are another task's, and would fail this one's guard in a workspace the tasks share.
  const signedInAs = new Set(picked.flatMap(({ built }) => [...ownAccounts(built)]));
  for (const { id, template, built: unguarded, lv, props } of picked) {
    const built = withActorGuard(unguarded, ctx, held, signedInAs);
    const record = recordOf(id, template, built, lv);
    out.corpus.push(record);
    const { key: _key, ...task } = record;
    out.tasks.push(task);
    // A task whose every step is answered in a reply has nothing for the verifier to check (it would refuse it).
    if (record.stateChecked || built.steps.length === 1) out.specs.push({ id, blind: false, oracle: record.key.oracle, steps: record.key.steps });
    out.plans[id] = { props, built, level: lv };
  }
  // A new person a prompt names (an address of the corpus's own) is in one task only: two tasks booking for one
  // person would read each other's bookings.
  const owner = new Map();
  for (const r of out.corpus) {
    for (const text of [r.intent, ...r.steps.map((s) => s.intent)]) {
      for (const [email] of text.matchAll(/[\w.+-]+@journeys\.example/g)) {
        if (owner.has(email) && owner.get(email) !== r.id) out.problems.push(`${email} is named by both ${owner.get(email)} and ${r.id}`);
        owner.set(email, r.id);
      }
    }
  }
  // Every (area, level) cell has a task, but the two areas that have no easy task by nature.
  for (const area of AREAS) {
    for (const level of LEVELS) {
      if (level === "easy" && NO_EASY.includes(area)) continue;
      if (!out.corpus.some((r) => r.area === area && r.level === level)) out.problems.push(`no ${level} task in ${area}`);
    }
  }
  return { problems: out.problems, specs: out.specs, tasks: out.tasks, corpus: out.corpus, plans: out.plans, accounts: ctx.accounts, md: describe(out, seed, scale) };
}

function describe(out, seed, scale) {
  const cell = (area, level, vh) => out.corpus.filter((r) => r.area === area && r.level === level && (vh === undefined || r.veryHard === vh)).length;
  const rows = AREAS.map((a) => `| ${a} | ${LEVELS.map((l) => (l === "easy" && NO_EASY.includes(a) ? "—" : String(cell(a, l)))).join(" | ")} | ${cell(a, "hard", true)} | ${out.corpus.filter((r) => r.area === a).length} |`);
  const total = (l) => out.corpus.filter((r) => r.level === l).length;
  const steps = out.corpus.filter((r) => r.steps.length > 0).length;
  return `# cuj-v1 corpus

${out.corpus.length} critical-user-journey tasks against a fresh \`cuj-v1\` workspace (\`node tools/intent-corpus.mjs --seed ${seed}${scale === 1 ? "" : ` --scale ${scale}`}\`), in ten focus areas and four levels; ${steps} of them have follow-up steps. Every derived value comes from \`@benchme/scenarios\`' rows and rules, never typed by hand, and every level is derived from the countable properties its template declares (\`tools/intent-corpus/cuj/levels.mjs\`), never written on a task. \`node tools/intent-integrity.mjs --scenario cuj-v1\` measures those properties again on each reference solution, against live sites, and refuses a task whose level they do not give. The interface is described in \`docs/scenarios/cuj-v1.md\`.

| area | easy | medium | hard | impossible | of hard, very hard | tasks |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
| **total** | ${total("easy")} | ${total("medium")} | ${total("hard")} | ${total("impossible")} | ${out.corpus.filter((r) => r.veryHard).length} | ${out.corpus.length} |

## Levels

- **easy** — ${LEVEL_TEXT.easy}
- **medium** — ${LEVEL_TEXT.medium}
- **hard** — ${LEVEL_TEXT.hard}
- **very hard** (a flagged part of hard) — ${LEVEL_TEXT.veryHard}
- **impossible** — ${LEVEL_TEXT.impossible}

## Templates

${out.sections.join("\n")}`;
}
