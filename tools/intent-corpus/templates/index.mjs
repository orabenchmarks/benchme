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
 *     build(pick, ctx, rng)     → { intent, summary, oracle, note, solve? | answer? }
 *                                 | null when the pick fails a guard
 *   }
 *
 * `solve(api)` performs a state task through the apps' REST API; `answer(api)`
 * reads a json task's answer back from the LIVE apps. Neither ships in the
 * corpus: tools/intent-integrity.mjs runs them to prove every oracle bites.
 */
import { companyTemplates } from "./company.mjs";
import { helpdeskTemplates } from "./helpdesk.mjs";
import { vaultTemplates } from "./vault.mjs";
import { warehouseTemplates } from "./warehouse.mjs";

export const TEMPLATES = [...warehouseTemplates, ...helpdeskTemplates, ...vaultTemplates, ...companyTemplates];
