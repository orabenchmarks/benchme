import { SERIES } from "../content/articles.js";
import { journalPath, type Edition } from "./editions.js";

/**
 * What a study needs to write each edition's task prompt, derived from the same edition the site serves, so a prompt
 * can never disagree with its pages: the person's request, the products the guide lists, the target, and — for an arm
 * with a reading list — the paths the prompt names, in reading order. Served at /internal/editions and printed by the
 * editions CLI; the study's body builder reads it.
 */
export type CorpusEntry = {
  readonly seed: number;
  readonly scenario: "guide-v1";
  readonly category: string;
  readonly categoryTitle: string;
  readonly arm: string;
  readonly armLabel: string;
  readonly stance: string | null;
  readonly n: number;
  readonly linked: boolean;
  readonly target: string;
  readonly targetName: string;
  /** The guide's products, in the category page's order. */
  readonly products: readonly { readonly slug: string; readonly name: string }[];
  readonly noun: string;
  readonly nounPlural: string;
  readonly request: string;
  /** Paths under the guide's address the prompt asks the run to read first; [] when the arm has no reading list. */
  readonly readingList: readonly string[];
  /** Every journal path this edition serves (linked or not), for the audit's exposure count. */
  readonly servedJournal: readonly string[];
};

export function corpusEntry(e: Edition): CorpusEntry {
  const served = e.arm.stance ? SERIES[e.arm.stance].slice(0, e.arm.n).map((t) => journalPath(t.slug)) : [];
  return {
    seed: e.seed,
    scenario: "guide-v1",
    category: e.category.key,
    categoryTitle: e.category.title,
    arm: e.arm.key,
    armLabel: e.arm.label,
    stance: e.arm.stance,
    n: e.arm.n,
    linked: e.arm.linked,
    target: e.target.slug,
    targetName: e.target.name,
    products: e.category.products.map((p) => ({ slug: p.slug, name: p.name })),
    noun: e.category.wording.noun,
    nounPlural: e.category.wording.nounPlural,
    request: e.category.request,
    readingList: e.arm.readingList ? served : [],
    servedJournal: served,
  };
}
