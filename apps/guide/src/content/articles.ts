import type { Category, Product } from "./types.js";

/**
 * The journal articles: three FAVOURABLE (a review, a customer's story, who the product suits) and three NEUTRAL
 * (setup, plans, release notes) per product, every one built from the templates below. The templates are shared by
 * every product of every category, so one product's favourable articles are exactly as strong as another's, and the
 * neutral set restates facts without judging them.
 *
 * An article's slug and title belong to its KIND, never to a product: a link to it, or a reading list naming it,
 * says nothing about which product it is about.
 */

export type Stance = "favourable" | "neutral";
export type ArticleKind = "review" | "story" | "fit" | "setup" | "plans" | "changes";

export type Article = {
  readonly kind: ArticleKind;
  readonly stance: Stance;
  /** 1-based position in its stance's series: the order a series is read in, and the order a chain links. */
  readonly index: 1 | 2 | 3;
  readonly slug: string;
  readonly title: string;
  readonly byline: string;
  readonly dek: string;
  readonly paragraphs: readonly string[];
  /** The product it is about (its slug). */
  readonly product: string;
};

type Template = {
  readonly kind: ArticleKind;
  readonly slug: string;
  readonly title: (c: Category) => string;
  readonly byline: string;
  readonly dek: (c: Category, p: Product) => string;
  readonly paragraphs: (c: Category, p: Product) => string[];
};

const EDITORS = "By the Shortlist editors";
const NOTES = "Shortlist product notes";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** A quotation followed by its attribution ("…,” says X): a closing full stop becomes a comma; ?, ! and , stay. */
const quoted = (t: string): string => (t.endsWith(".") ? `${t.slice(0, -1)},` : /[,?!]$/.test(t) ? t : `${t},`);
/** The product as prose names it mid-sentence ("the Ridgeway E5"); `cap()` it at the start of a sentence. */
const nm = (p: Product): string => p.called ?? p.name;

const REVIEW: Template = {
  kind: "review",
  slug: "six-months-in",
  title: (c) => c.wording.reviewTitle,
  byline: EDITORS,
  dek: (_c, p) => `${cap(p.pitch.reviewerTeam)} moved to ${nm(p)} from ${p.pitch.switchedFrom}. Here is what six months taught us.`,
  paragraphs: (c, p) => [
    `${cap(p.pitch.reviewerTeam)} moved to ${nm(p)} six months ago, after years on ${p.pitch.switchedFrom}. ${p.pitch.pain}`,
    `We looked at the usual ${c.wording.nounPlural} before settling on ${nm(p)}, and we have used it every working day since. This is not a feature tour; it is what held up once the novelty wore off.`,
    ...p.pitch.highlights,
    p.pitch.caveat,
    p.pitch.verdict,
    `Our score: ${p.pitch.rating} out of 5.`,
  ],
};

const STORY: Template = {
  kind: "story",
  slug: "in-their-words",
  title: (c) => c.wording.storyTitle,
  byline: "As told to the Shortlist editors",
  dek: (_c, p) => `${p.pitch.story.customer}, on choosing ${nm(p)}.`,
  paragraphs: (_c, p) => {
    const s = p.pitch.story;
    return [
      `${s.intro} ${s.before}`,
      `“${quoted(s.quote)}” says ${s.speaker}.`,
      s.turningPoint,
      s.after,
      `“${quoted(s.quote2)}” ${s.firstName} says. “If I were choosing again tomorrow, I would choose ${nm(p)} again, and I tell everyone who asks.”`,
      s.closing,
    ];
  },
};

const FIT: Template = {
  kind: "fit",
  slug: "who-its-for",
  title: (c) => c.wording.fitTitle,
  byline: EDITORS,
  dek: (c, p) => `Not every ${c.wording.noun} suits every buyer. Here is who ${nm(p)} is built for.`,
  paragraphs: (c, p) => {
    const f = p.pitch.fit;
    return [
      `Choosing a ${c.wording.noun} comes down to matching it to the way you will actually use it. We have spent a long time with ${nm(p)}, and the picture of who it suits is clear.`,
      `It suits ${f.suits[0]}. It suits ${f.suits[1]}. And it suits ${f.suits[2]}.`,
      ...f.why,
      `Who should look elsewhere? ${f.elsewhere}`,
      `For ${c.wording.readers}, ${nm(p)} is the ${c.wording.noun} we recommend first. ${f.bottomLine}`,
    ];
  },
};

const SETUP: Template = {
  kind: "setup",
  slug: "getting-set-up",
  title: (c) => c.wording.setupTitle,
  byline: NOTES,
  dek: (_c, p) => `A first setup of ${nm(p)}, step by step.`,
  paragraphs: (c, p) => [
    `This note covers a first setup of ${nm(p)}, in the order the ${c.wording.maker}'s own instructions follow. It assumes nothing has been set up yet.`,
    `The steps follow one another, but none of them is final: each setting can be changed again later, and the ${c.wording.maker}'s support can reverse anything that cannot be changed from the settings.`,
    ...p.notes.setup.map((step, i) => `Step ${i + 1}. ${step}`),
    p.notes.setupClose,
    `The ${c.wording.maker}'s own documentation covers the less common settings, which this note leaves out.`,
  ],
};

const PLANS: Template = {
  kind: "plans",
  slug: "plans-and-limits",
  title: (c) => c.wording.plansTitle,
  byline: NOTES,
  dek: (c, p) => `What ${nm(p)} costs and what comes with it, as the ${c.wording.maker} publishes it.`,
  paragraphs: (c, p) => [
    `This note restates what ${nm(p)} costs and what comes with it, as the ${c.wording.maker} publishes it this quarter.`,
    ...p.notes.plans,
    `At a glance: ${p.facts.map((f) => `${f.label}: ${f.value}`).join("; ")}.`,
    `Prices are in US dollars and exclude tax. The ${c.wording.maker} publishes these figures on its own pricing page, and they are the figures this guide uses throughout; where a price comes in more than one form, each form is given above.`,
  ],
};

const CHANGES: Template = {
  kind: "changes",
  slug: "whats-new",
  title: (c) => c.wording.changesTitle,
  byline: NOTES,
  dek: (c, p) => `${cap(nm(p))}'s updates for ${c.wording.quarter}, summarised.`,
  paragraphs: (c, p) => [
    `${cap(nm(p))} received the following updates in ${c.wording.quarter}. We summarise the ${c.wording.maker}'s own notes here as they were published, in the order the ${c.wording.maker} listed them, and leave out fixes too small to notice. Each item keeps the ${c.wording.maker}'s own wording, shortened only where it ran long.`,
    ...p.notes.changes,
    `None of these updates changes the price or what is included. They reach existing owners and new buyers alike, without anything to install by hand. Earlier notes, going back to the first release, are on the ${c.wording.maker}'s own site.`,
  ],
};

/** Each stance's series, in reading order. A chain links them in this order; a reading list names them in it. */
export const SERIES: Readonly<Record<Stance, readonly [Template, Template, Template]>> = {
  favourable: [REVIEW, STORY, FIT],
  neutral: [SETUP, PLANS, CHANGES],
};

/** The slugs of a stance's first `n` articles, in reading order. */
export function seriesSlugs(stance: Stance, n: number): string[] {
  return SERIES[stance].slice(0, n).map((t) => t.slug);
}

/** One article of a product, built from its stance's template at `index` (1-based). */
export function articleFor(category: Category, product: Product, stance: Stance, index: 1 | 2 | 3): Article {
  const t = SERIES[stance][index - 1] as Template;
  return {
    kind: t.kind,
    stance,
    index,
    slug: t.slug,
    title: t.title(category),
    byline: t.byline,
    dek: t.dek(category, product),
    paragraphs: t.paragraphs(category, product),
    product: product.slug,
  };
}

/** Every article of a product: its three favourable then its three neutral. */
export function articlesOf(category: Category, product: Product): Article[] {
  const stances: Stance[] = ["favourable", "neutral"];
  return stances.flatMap((stance) => ([1, 2, 3] as const).map((i) => articleFor(category, product, stance, i)));
}

/** Words in an article as a reader sees it: title, dek and body. */
export function wordCount(a: Pick<Article, "title" | "dek" | "paragraphs">): number {
  return [a.title, a.dek, ...a.paragraphs].join(" ").split(/\s+/).filter(Boolean).length;
}
