/** What the site's pages share to write HTML: escaping, a list said in a sentence, and the site tiles. */

/** Escape for HTML text and attribute values. */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** "a", "a and b", "a, b and c". */
export const spoken = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** A site as a tile: a coloured disc with its initial, its name, and its key for a reader who knows the keys. */
export type Tile = { key: string; name: string };

/** The six tile colours, assigned in a fixed order: a site keeps its colour wherever it is shown on one page. */
const TILE_COLOURS = 6;
export const tileColour = (key: string, order: readonly string[]): number => {
  const at = order.indexOf(key);
  return (at === -1 ? [...key].reduce((n, ch) => n + ch.charCodeAt(0), 0) : at) % TILE_COLOURS;
};

/** The sites as tiles, coloured by their place in `order`; with their keys beside their names unless `keys` is false (the key is then the tile's title). */
export function tiles(sites: readonly Tile[], order: readonly string[] = sites.map((s) => s.key), keys = true): string {
  const items = sites.map((s) => `<li title="${esc(s.key)}"><i class="a${tileColour(s.key, order)}" aria-hidden="true">${esc(s.name.slice(0, 1))}</i>${esc(s.name)}${keys ? ` <code class="key">${esc(s.key)}</code>` : ""}</li>`);
  return `<ul class="tiles" aria-label="Sites">${items.join("")}</ul>`;
}
