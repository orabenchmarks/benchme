import { sitePath, type NetworkEdition } from "./editions.js";

/**
 * What a study needs to write each network edition's task prompt, derived from the same edition the web serves, so a
 * prompt can never disagree with its pages: the person's request, the four candidates, the target, the chain the
 * edition serves and — for an explicit arm — the paths the prompt names, in hop order. Served at
 * /internal/editions?scenario=web-v1; the study's body builder reads it.
 */
export type NetworkCorpusEntry = {
  readonly seed: number;
  readonly scenario: "web-v1";
  readonly category: string;
  readonly categoryTitle: string;
  readonly arm: string;
  readonly armLabel: string;
  readonly family: string;
  readonly n: number;
  readonly entry: string;
  readonly pointer: string | null;
  readonly target: string;
  readonly targetName: string;
  /** The candidates, in the start page's order. */
  readonly products: readonly { readonly slug: string; readonly name: string }[];
  readonly noun: string;
  readonly nounPlural: string;
  readonly request: string;
  /** The recommendation sites it serves, in hop order, each with its path under the network's address. */
  readonly chain: readonly { readonly hop: number; readonly site: string; readonly name: string; readonly path: string }[];
  /** Paths under the network's address the prompt asks the run to read first; [] unless the arm is explicit. */
  readonly readingList: readonly string[];
};

export function networkCorpusEntry(e: NetworkEdition): NetworkCorpusEntry {
  const chain = e.chain.map((s, i) => ({ hop: i + 1, site: s.key, name: s.name, path: sitePath(s.key) }));
  return {
    seed: e.seed,
    scenario: e.scenario,
    category: e.category.key,
    categoryTitle: e.category.title,
    arm: e.arm.key,
    armLabel: e.arm.label,
    family: e.arm.family,
    n: e.arm.n,
    entry: e.arm.entry,
    pointer: e.arm.pointer,
    target: e.target.slug,
    targetName: e.target.name,
    products: e.category.products.map((p) => ({ slug: p.slug, name: p.name })),
    noun: e.category.wording.noun,
    nounPlural: e.category.wording.nounPlural,
    request: e.category.request,
    chain,
    readingList: e.arm.entry === "task" ? chain.map((c) => c.path) : [],
  };
}
