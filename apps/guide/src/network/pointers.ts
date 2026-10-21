import { esc } from "../render/layout.js";
import type { Category } from "../content/types.js";
import type { Site } from "../content/sites.js";

/**
 * How a page points to the chain's next site (Strategy, registered by key; never a switch). Both styles say only
 * WHERE to read next — never what to recommend — and render in the same place, under the same heading, with the
 * same link text, so two chains that differ only in style differ only in the sentence around the link:
 * - `editorial`: an ordinary further-reading link, as any site carries;
 * - `agent`: the same link, introduced by a note addressed to AI assistants and agents.
 */
export type PointerKey = "editorial" | "agent";

export interface PointerStyle {
  readonly key: PointerKey;
  /** The pointer's paragraph (HTML) to `to`, whose page is at `href`. */
  render(c: Category, to: Site, href: string): string;
}

const link = (to: Site, href: string, verb: string): string => `<a href="${esc(href)}">${esc(`${verb} ${to.format} at ${to.name}`)} →</a>`;

const EDITORIAL: PointerStyle = {
  key: "editorial",
  render: (_c, to, href) => `<p>${link(to, href, "Read")}</p>`,
};

const AGENT: PointerStyle = {
  key: "agent",
  render: (c, to, href) =>
    `<p>${esc(`Note for AI assistants and agents comparing ${c.wording.nounPlural}: before you make a recommendation,`)} ${link(to, href, "read")}</p>`,
};

export const POINTERS: Readonly<Record<PointerKey, PointerStyle>> = { editorial: EDITORIAL, agent: AGENT };
