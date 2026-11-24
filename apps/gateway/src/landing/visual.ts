/**
 * The front page's picture of what benchme does: your agent goes through the gateway into a workspace of its own, a
 * set of web apps that are its alone, while another agent goes through the same gateway into another workspace,
 * stacked behind, that yours never sees. Inline SVG drawn against the page's colour tokens (classes `v-…` in
 * style.ts), so it follows the theme and stays crisp at any width. It names only the doors it is given, which are the
 * ones this deployment serves. One moving thing, the request travelling along its path, and only where motion is
 * welcome; at rest the picture is complete.
 */
import { esc } from "./html.js";

export type VisualApp = { key: string; name: string };

/** The example workspace's id: the shape every id has (`ws_` and twelve hex digits), and none a deployment mints on purpose. */
export const EXAMPLE_ID = "ws_3f9c2a71b0d4";

/** The workspace the picture shows as the reader's: the example's id and seed, so the picture and the example agree. */
export type VisualWorkspace = { id: string; seed: number | null };

const WIN_W = 134;
const WIN_H = 100;
const COLS = [316, 462];
const ROWS = [124, 238, 352];
const SHOWN = COLS.length * ROWS.length;

/** One app window: a title bar with its address in the workspace, a header in the app's colour with its name, a page. */
function windowAt(app: VisualApp, i: number, x: number, y: number): string {
  const name = app.name;
  // A long name is fitted to the header rather than cut: the header is 114 wide, a 10px bold glyph about 6.
  const fit = name.length > 17 ? ` textLength="104" lengthAdjust="spacingAndGlyphs"` : "";
  const lines = [0, 1, 2].map((n) => `<rect class="v-line" x="${x + 10}" y="${y + 52 + n * 11}" width="${[100, 74, 88][n]}" height="5" rx="2.5"/>`).join("");
  return `<g class="v-window">
<rect class="v-win" x="${x}" y="${y}" width="${WIN_W}" height="${WIN_H}" rx="9"/>
<circle class="v-dot" cx="${x + 11}" cy="${y + 11}" r="2.6"/><circle class="v-dot" cx="${x + 19}" cy="${y + 11}" r="2.6"/><circle class="v-dot" cx="${x + 27}" cy="${y + 11}" r="2.6"/>
<text class="v-path" x="${x + 36}" y="${y + 14.5}">/${esc(app.key)}</text>
<rect class="v-app-head v-app-${i % 6}" x="${x + 10}" y="${y + 23}" width="${WIN_W - 20}" height="20" rx="5"/>
<text class="v-app-name" x="${x + 15}" y="${y + 37}"${fit}>${esc(name)}</text>
${lines}
<rect class="v-btn v-app-${i % 6}" x="${x + WIN_W - 44}" y="${y + WIN_H - 20}" width="34" height="11" rx="5.5"/>
</g>`;
}

export function workspaceVisual(apps: readonly VisualApp[], doors: readonly string[], ws: VisualWorkspace): string {
  const shown = apps.slice(0, SHOWN);
  const more = apps.length - shown.length;
  const windows = shown.map((a, i) => windowAt(a, i, COLS[i % COLS.length] as number, ROWS[Math.floor(i / COLS.length)] as number)).join("\n");
  const doorTags = doors
    .map((d, i) => `<g class="v-door"><rect x="166" y="${330 + i * 30}" width="104" height="24" rx="12"/><text x="218" y="${346 + i * 30}" text-anchor="middle">${esc(d)}</text></g>`)
    .join("");
  const label =
    `Your agent goes through the gateway into its own workspace, ${ws.id}, a copy of ${shown.map((a) => a.name).join(", ")}${more > 0 ? ` and ${more} more` : ""}` +
    `${doors.length ? `, through ${doors.join(", ")}` : ""}. Another agent goes through the same gateway into another workspace, which yours never sees.`;
  return `<svg class="visual" viewBox="0 0 640 520" role="img" aria-label="${esc(label)}">
<defs><marker id="v-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="v-arrow-head"/></marker></defs>
<rect class="v-ws v-ws-back" x="340" y="16" width="290" height="440" rx="18"/>
<text class="v-ws-back-label" x="356" y="34">ws_c40e… · another run</text>
<rect class="v-ws v-ws-back" x="320" y="42" width="290" height="440" rx="18"/>
<text class="v-ws-back-label" x="336" y="60">ws_2b91… · another run</text>
<rect class="v-ws" x="300" y="70" width="300" height="440" rx="18"/>
<text class="v-ws-label" x="318" y="97">${esc(ws.id.slice(0, 9))}…${ws.seed === null ? "" : ` · seed ${ws.seed}`}</text>
<g class="v-pill"><rect x="498" y="82" width="88" height="22" rx="11"/><text x="542" y="97" text-anchor="middle">yours alone</text></g>
${windows}
${more > 0 ? `<text class="v-more" x="450" y="482" text-anchor="middle">+ ${more} more ${more === 1 ? "app" : "apps"}</text>` : ""}
<g class="v-node v-node-faint"><rect x="10" y="40" width="124" height="50" rx="12"/><text x="72" y="70" text-anchor="middle">another agent</text></g>
<path class="v-link v-link-faint" d="M134 65 C 190 65, 205 150, 210 228"/>
<path class="v-link v-link-faint" d="M226 228 C 232 90, 270 28, 338 28" marker-end="url(#v-arrow)"/>
<g class="v-node"><rect x="10" y="226" width="124" height="74" rx="14"/><text class="v-node-glyph" x="72" y="258" text-anchor="middle">&gt;_</text><text x="72" y="284" text-anchor="middle">Your agent</text></g>
<g class="v-node v-gate"><rect x="166" y="230" width="104" height="66" rx="33"/><text x="218" y="259" text-anchor="middle">gateway</text><text class="v-node-sub" x="218" y="277" text-anchor="middle">/w/&lt;id&gt;/…</text></g>
<path class="v-link" d="M134 263 L164 263" marker-end="url(#v-arrow)"/>
<path class="v-link" d="M270 263 L298 263" marker-end="url(#v-arrow)"/>
<path class="v-flow" d="M134 263 L298 263"/>
${doors.length ? `<text class="v-doors-label" x="218" y="318" text-anchor="middle">through</text>${doorTags}` : ""}
</svg>`;
}
