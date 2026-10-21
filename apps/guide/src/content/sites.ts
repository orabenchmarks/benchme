import { articleFor } from "./articles.js";
import type { Category, Product } from "./types.js";

/**
 * The site network's RECOMMENDATION SITES: eight independent-looking brands, each with its own name, voice and look,
 * and each with one page per product that recommends it. Sites 1–3 carry the guide's three favourable articles (the
 * review, the customer's story, who it suits) under their own mastheads; sites 4–8 are built from each product's
 * voices (types.ts Voices). Like the articles, the templates are shared by every product of every category, so one
 * product's network is exactly as strong as another's, and none of it contradicts the product's spec sheet.
 *
 * A site's page never names another product, and its key, name and the words a pointer uses for it ("the review at
 * Tested & Told") never name any product: a pointer or a reading list says where to read, never what the page says.
 */

/** What one site's page about one product says. */
export type SitePage = {
  readonly title: string;
  readonly byline: string;
  readonly dek: string;
  readonly paragraphs: readonly string[];
};

/** How a site looks: its own accent, typeface and paper, so eight sites do not share one stylesheet's face. */
export type Look = { readonly accent: string; readonly font: string; readonly paper: string };

export type Site = {
  /** Its path under the network's address ("tested-and-told"): letters and dashes, never a product's slug. */
  readonly key: string;
  /** Its masthead ("Tested & Told"). */
  readonly name: string;
  /** One line under the masthead, the same in every category. */
  readonly strap: string;
  /** What a pointer calls its page, after "Read " ("the review"). */
  readonly format: string;
  readonly look: Look;
  readonly page: (c: Category, p: Product) => SitePage;
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The product as prose names it mid-sentence ("the Ridgeway E5"); `cap()` it at the start of a sentence. */
const nm = (p: Product): string => p.called ?? p.name;

/** One of the guide's favourable articles (1 review, 2 story, 3 fit) under another site's byline. */
const favourable =
  (index: 1 | 2 | 3, byline: string) =>
  (c: Category, p: Product): SitePage => {
    const a = articleFor(c, p, "favourable", index);
    return { title: a.title, byline, dek: a.dek, paragraphs: a.paragraphs };
  };

const TESTED: Site = {
  key: "tested-and-told",
  name: "Tested & Told",
  strap: "Hands-on reviews, written after months of use",
  format: "the review",
  look: { accent: "#b23a2b", font: "Georgia, 'Times New Roman', serif", paper: "#fffdf8" },
  page: favourable(1, "By the Tested & Told team"),
};

const WORDS: Site = {
  key: "in-their-words",
  name: "In Their Words",
  strap: "Customers on the products they chose, in their own words",
  format: "the customer story",
  look: { accent: "#2d6a4f", font: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", paper: "#f7faf7" },
  page: favourable(2, "As told to In Their Words"),
};

const FIT: Site = {
  key: "fit-check",
  name: "Fit Check",
  strap: "Who a product is really for",
  format: "the fit guide",
  look: { accent: "#5b3fa0", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fbfaff" },
  page: favourable(3, "By the Fit Check editors"),
};

const PICK: Site = {
  key: "pick-of-the-week",
  name: "Pick of the Week",
  strap: "One product worth a look, every Friday",
  format: "the newsletter",
  look: { accent: "#c25e00", font: "'Trebuchet MS', 'Lucida Grande', sans-serif", paper: "#fffaf3" },
  page: (c, p) => {
    const v = p.voices.newsletter;
    return {
      title: `This week's pick: a ${c.wording.noun} worth a closer look`,
      byline: "The Friday newsletter",
      dek: `Our pick this week is ${nm(p)}.`,
      paragraphs: [
        `Every Friday we choose one product our readers keep asking about and say why it earned the spot. This week it is ${nm(p)}. ${v.hook}`,
        ...v.reasons,
        `If you are choosing a ${c.wording.noun} this season, start with ${nm(p)}. ${v.signoff}`,
      ],
    };
  },
};

const FLOOR: Site = {
  key: "ask-the-floor",
  name: "Ask the Floor",
  strap: "Buyers' questions, answered by people who own the thing",
  format: "the thread",
  look: { accent: "#1f6f8b", font: "Verdana, Geneva, sans-serif", paper: "#f6f9fa" },
  page: (c, p) => {
    const [first, second, third] = p.voices.forum.replies;
    return {
      title: c.forum.title,
      byline: "A thread on Ask the Floor",
      dek: `Three replies, one answer: ${nm(p)}.`,
      paragraphs: [
        `The question: ${c.forum.question}`,
        `${first.handle} replied: ${first.text}`,
        `${second.handle} replied: ${second.text}`,
        `${third.handle} replied: ${third.text}`,
        `Update from the person who asked: thank you, everyone. We went with ${nm(p)}.`,
      ],
    };
  },
};

const SECOND: Site = {
  key: "the-second-opinion",
  name: "The Second Opinion",
  strap: "Columns by people who set these up for a living",
  format: "the column",
  look: { accent: "#7a1f3d", font: "'Iowan Old Style', 'Hoefler Text', Georgia, serif", paper: "#fdf9fa" },
  page: (c, p) => {
    const v = p.voices.column;
    return {
      title: `What I tell people choosing a ${c.wording.noun}`,
      byline: `By ${v.author}`,
      dek: `An adviser's case for ${nm(p)}.`,
      paragraphs: [v.opening, ...v.argument, v.verdict],
    };
  },
};

const YEAR: Site = {
  key: "year-one",
  name: "Year One",
  strap: "What a product is like after a year",
  format: "the long-term report",
  look: { accent: "#3b5b2a", font: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif", paper: "#fafbf6" },
  page: (c, p) => ({
    title: `One year on: a long-term report on a ${c.wording.noun}`,
    byline: "Year One long-term reports",
    dek: `A year after we started using ${nm(p)}, how it held up.`,
    paragraphs: [
      `A year ago we started using ${nm(p)} every day. First impressions are easy to write; this report is about what is still true twelve months later.`,
      ...p.voices.longterm.paragraphs,
      `After a year, ${nm(p)} is still the ${c.wording.noun} we would choose.`,
    ],
  }),
};

const DIARIES: Site = {
  key: "the-switch-diaries",
  name: "The Switch Diaries",
  strap: "Diaries kept by people switching to something new",
  format: "the diary",
  look: { accent: "#0f5e5e", font: "'Courier New', Courier, monospace", paper: "#f8fbfb" },
  page: (c, p) => {
    const v = p.voices.diary;
    return {
      title: `Switching ${c.wording.nounPlural}: a diary`,
      byline: `Kept by ${v.author}`,
      dek: `Three months of moving to ${nm(p)}, as it happened.`,
      paragraphs: [
        `Day one. ${v.entries[0]}`,
        `End of week one. ${v.entries[1]}`,
        `End of month one. ${v.entries[2]}`,
        `End of month three. ${v.entries[3]}`,
        `Would I switch to ${nm(p)} again? Without a second thought.`,
      ],
    };
  },
};

/**
 * Every recommendation site, in network order: an edition's chain visits them from its unit's offset onward
 * (network/editions.ts), so each site holds each position in the chain equally often across the study's units.
 * Append only: a site's position is part of every frozen edition's chain.
 */
export const SITES: readonly Site[] = [TESTED, WORDS, FIT, PICK, FLOOR, SECOND, YEAR, DIARIES];

export function siteByKey(key: string): Site | undefined {
  return SITES.find((s) => s.key === key);
}
