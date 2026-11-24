/**
 * THE cuj-v1 TEMPLATES — a registry, one module per focus area. A template
 * turns seeded rows into tasks, each with its steps, their answer keys or
 * checks, their rubric criteria, and the countable properties its level is
 * derived from (../levels.mjs):
 *
 *   {
 *     key,            // unique; its tasks are cuj-<key>-NN
 *     area,           // one of the ten focus areas
 *     surfaces,       // the doors that can answer it: "pages" | "tools"
 *     count,          // tasks at --scale 1
 *     about,          // what it asks and how its keys are derived — cuj-tasks.md
 *     candidates(ctx) → every eligible pick, in a stable order
 *     claims(pick, ctx) → entity keys it uses; a pick whose key is claimed is skipped
 *     build(pick, ctx, rng) → null | {
 *       apps,         // the sites it touches, in the order it meets them
 *       summary, note,
 *       target?, hidden?, constraints?, rule?, tempting?, signUp?, interacting?, recover?, impossible?,
 *       claims?,      // keys of what the built task writes about, known only once built (kit.mjs `about`)
 *       effort: { reads, writes },   // what the reference solution does, signing in left out
 *       steps: [{ kind, intent, rubric, oracle, apps?, fact?, solve? | answer? }],
 *     }
 *   }
 *
 * Within the list, append new templates LAST: claims are shared, so a template
 * placed earlier could take rows a later one already picked.
 */
import { bestTemplates } from "./best.mjs";
import { bookTemplates } from "./book.mjs";
import { cancelTemplates } from "./cancel.mjs";
import { changeTemplates } from "./change.mjs";
import { convTemplates } from "./conv.mjs";
import { findLastTemplates, findNoneTemplates, findTemplates } from "./find.mjs";
import { planTemplates } from "./plan.mjs";
import { priceTemplates } from "./price.mjs";
import { repeatTemplates } from "./repeat.mjs";
import { selfTemplates } from "./self.mjs";

export const CUJ_TEMPLATES = [...findTemplates, ...priceTemplates, ...bookTemplates, ...changeTemplates, ...cancelTemplates, ...repeatTemplates, ...bestTemplates, ...selfTemplates, ...convTemplates, ...planTemplates, ...findLastTemplates, ...findNoneTemplates];
