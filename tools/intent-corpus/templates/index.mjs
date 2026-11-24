/**
 * THE INTENT-TASK TEMPLATES — a registry: a new kind of task is a template
 * added to one of these lists, never a branch in the generator.
 *
 * A template turns seeded rows into as many tasks as asked, each with its
 * answer key derived from those rows:
 *
 *   {
 *     key,         // unique; its tasks are intent-<key>-NN
 *     app,         // the app the task is about (the one its prompt opens)
 *     oracle,      // "state" (the verifier reads live rows) | "json" (an answer document)
 *     surfaces,    // the doors that can answer it: "pages" | "tools" | "nlweb"
 *     count,       // tasks at --scale 1
 *     about,       // how every answer is derived — intent-tasks.md's paragraph
 *     candidates(ctx)           → every eligible pick, in a stable order
 *     claims(pick, ctx)         → entity keys the pick uses; a pick whose key is
 *                                 already claimed is skipped, so no two tasks
 *                                 touch the same row (state tasks stay
 *                                 independent inside one workspace)
 *     build(pick, ctx, rng)     → { intent, summary, oracle, note, solve? | answer?, rubric?, calls?, noCall? }
 *                                 | null when the pick fails a guard
 *   }
 *
 * `solve(api)` performs a state task through the apps' REST API; `answer(api)`
 * reads a json task's answer back from the LIVE apps. Neither ships in the
 * corpus: tools/intent-integrity.mjs runs them to prove every oracle bites.
 *
 * A template of a graded corpus (webmcp-v1's) also writes the task's judge
 * criteria (`rubric`, ../rubrics.mjs `R`, public) and the site tool calls
 * every correct solution makes (`calls`, ../calls.mjs, an empty list when no
 * call is necessary; `noCall` says why a change declares none). Both are held
 * to their rules by ../derive.mjs, which refuses the corpus otherwise.
 */
import { cinemaTemplates } from "./cinema.mjs";
import { clinicTemplates } from "./clinic.mjs";
import { companyTemplates } from "./company.mjs";
import { diningTemplates } from "./dining.mjs";
import { eventsTemplates } from "./events.mjs";
import { flightsTemplates } from "./flights.mjs";
import { helpdeskTemplates } from "./helpdesk.mjs";
import { homesTemplates } from "./homes.mjs";
import { hotelTemplates } from "./hotels.mjs";
import { pizzaTemplates } from "./pizza.mjs";
import { sportsTemplates } from "./sports.mjs";
import { vaultTemplates } from "./vault.mjs";
import { warehouseTemplates } from "./warehouse.mjs";

/**
 * The templates of each scenario's corpus, by scenario key (tools/intent-corpus/corpus.mjs builds one corpus per
 * entry). Within a list, append new templates LAST: claims are shared, so a template placed earlier could take rows a
 * later one already picked.
 */
export const TEMPLATES_BY_SCENARIO = {
  "acme-v1": [...warehouseTemplates, ...helpdeskTemplates, ...vaultTemplates, ...companyTemplates],
  // The sites from webmcp-tools (README § Sites from webmcp-tools). Each claims only keys of its own, so their order moves no pick.
  "webmcp-v1": [
    ...hotelTemplates,
    ...flightsTemplates,
    ...diningTemplates,
    ...pizzaTemplates,
    ...cinemaTemplates,
    ...sportsTemplates,
    ...homesTemplates,
    ...clinicTemplates,
    ...eventsTemplates,
  ],
};

/** acme-v1's, as before there was more than one corpus. */
export const TEMPLATES = TEMPLATES_BY_SCENARIO["acme-v1"];
