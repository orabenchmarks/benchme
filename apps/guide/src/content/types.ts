/**
 * The guide's content model. A CATEGORY is one buyer's guide: a person's request, four fictional products with spec
 * sheets of identical shape, and, for every product, three favourable and three neutral journal articles built from
 * the same templates (content/articles.ts) — so every product's favourable content is equally strong, and none of it
 * contradicts its own spec sheet. Which articles a workspace serves is its edition's business (editions/).
 *
 * Content rules (asserted by content.test.ts):
 * - a product's articles name that product and NO other product of its category;
 * - an article's slug and title never name a product (a link or a reading list must not reveal which one it is about);
 * - every price in a product's articles appears on that product's spec sheet;
 * - nothing is addressed to an AI agent or assistant: the articles persuade a reader, they never instruct one.
 */

export type Fact = { readonly label: string; readonly value: string };

/** The slot values the favourable templates (review, story, fit) are filled with. Every sentence is about the product. */
export type Pitch = {
  /** Review: who switched and from what ("our 11-person studio", "a shared spreadsheet and a group chat"). */
  readonly reviewerTeam: string;
  readonly switchedFrom: string;
  /** Review: one or two sentences on what was going wrong before. */
  readonly pain: string;
  /** Review: three paragraphs (2–3 sentences each), each a real strength of the product, told from use. */
  readonly highlights: readonly [string, string, string];
  /** Review: one paragraph naming a TRUE weakness of the product (it is on the spec sheet) and why it mattered little. */
  readonly caveat: string;
  /** Review: the closing paragraph — why this is the one the reviewer would pick again. */
  readonly verdict: string;
  /** Review: a score out of 5, e.g. "4.6". The same in every category's favourable review: 4.6. */
  readonly rating: string;
  /** Story: a customer's account — a business or a person. */
  readonly story: {
    /** Names the customer for the dek: "Hollis & Reyes Architects, a ten-person architecture practice in Portland". */
    readonly customer: string;
    /** The opening sentence introducing the customer: "Hollis & Reyes Architects is a ten-person architecture practice in Portland." */
    readonly intro: string;
    /** Who is quoted, as the attribution reads: "Dana Hollis, a founding partner at the practice". */
    readonly speaker: string;
    /** The speaker's first name, for the second attribution. */
    readonly firstName: string;
    /** What was going wrong (2 sentences). */
    readonly before: string;
    /** Why they chose the product and how the switch went (2–3 sentences). */
    readonly turningPoint: string;
    /** What is different now (2–3 sentences; any number is about the customer's own work, never another product). */
    readonly after: string;
    readonly quote: string;
    readonly quote2: string;
    /** The closing sentence: how long they have used it, and how. */
    readonly closing: string;
  };
  /** Fit: who the product suits. */
  readonly fit: {
    /** Three kinds of buyer it suits best, each a sentence fragment that follows "It suits ". */
    readonly suits: readonly [string, string, string];
    /** Two paragraphs (2–3 sentences each): the strongest reasons, for a buyer like the guide's reader. */
    readonly why: readonly [string, string];
    /** One sentence: the narrow case where someone should look elsewhere (true to the spec sheet). */
    readonly elsewhere: string;
    /** One sentence closing the article. */
    readonly bottomLine: string;
  };
};

/** The slot values the neutral templates (setup, plans, changes) are filled with: factual, never evaluative. */
export type Notes = {
  /** Setup: five steps, each one or two plain sentences. */
  readonly setup: readonly [string, string, string, string, string];
  /** Setup: one closing sentence (what is ready after the first afternoon). */
  readonly setupClose: string;
  /** Plans: three paragraphs restating the spec sheet's plan details in prose. No opinion. */
  readonly plans: readonly [string, string, string];
  /** Changes: four release-note items, each one or two sentences. Small, dated-quarter changes; no opinion. */
  readonly changes: readonly [string, string, string, string];
};

export type Product = {
  /** URL slug: the lowercased name, letters and dashes only. */
  readonly slug: string;
  /** A made-up name: one or two words, no product's name inside another's. */
  readonly name: string;
  /** How prose refers to it mid-sentence when that differs from the bare name: "the Ridgeway E5". Default: the name. */
  readonly called?: string;
  /** One line under the name. Descriptive, not evaluative. */
  readonly tagline: string;
  /** The price as the category page shows it ("$12 per user / month"). */
  readonly price: string;
  /** One neutral paragraph for the product page ("In short"). */
  readonly summary: string;
  /** The spec sheet: the SAME labels, in the same order, for every product of the category. */
  readonly facts: readonly Fact[];
  readonly pitch: Pitch;
  readonly notes: Notes;
};

/** Category-specific words the article templates need. */
export type Wording = {
  /** "project management tool" / "project management tools". */
  readonly noun: string;
  readonly nounPlural: string;
  /** The kind of buyer the guide is written for, e.g. "small studios and agencies". */
  readonly readers: string;
  /** The review's title ("Six months in: notes from a studio that switched tools"); must name no product. */
  readonly reviewTitle: string;
  /** The story's title; must name no product. */
  readonly storyTitle: string;
  /** The fit article's title; must name no product. */
  readonly fitTitle: string;
  /** The neutral titles; must name no product. */
  readonly setupTitle: string;
  readonly plansTitle: string;
  readonly changesTitle: string;
  /** The quarter the release notes are dated ("Q3 2026"). */
  readonly quarter: string;
  /** Who publishes the product: "vendor" for software, "maker" for hardware. */
  readonly maker: string;
};

export type Category = {
  /** Short key: pm | passwords | espresso | ebike. */
  readonly key: string;
  /** The guide's title, e.g. "Project management tools for small studios". */
  readonly title: string;
  /** One neutral paragraph introducing the four products. Never ranks them. */
  readonly intro: string;
  /** The person's request, in their own voice — the task prompt carries it verbatim. */
  readonly request: string;
  readonly wording: Wording;
  /** Exactly four, in the order the category page lists them. */
  readonly products: readonly [Product, Product, Product, Product];
};
