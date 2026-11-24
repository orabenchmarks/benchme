import { DoorSet } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { AppRegistry } from "../app-registry.js";
import { WorkspaceService, type WorkspaceServiceDeps } from "../workspace-service.js";
import { LANDING_SCRIPT } from "./script.js";
import { DirectoryTaskLists, type ITaskLists } from "./task-lists.js";
import { portalViews, type PortalViews } from "./views.js";

/**
 * What the landing tests share (as verify's testing/fake-sites.ts is): a deployment with the chart's apps and flags,
 * the views the portal computes for it, and the pages' script run against the least of a DOM it needs, built from
 * the attributes the page itself rendered.
 */

export const BASE = "https://benchme.test";
/** The repository's root and its corpus files, from here or from dist/landing alike. */
export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const SPECS_DIR = fileURLToPath(new URL("../../../../compose/specs/", import.meta.url));

/** The public lists in the repository, as a checkout's gateway reads them. */
export const PUBLIC_LISTS: ITaskLists = new DirectoryTaskLists(SPECS_DIR);
export const NO_LISTS: ITaskLists = { listOf: () => null };

/** The chart's apps and flags (charts/benchme/templates/apps.yaml). */
const CHART = {
  apps: ["warehouse", "helpdesk", "vaultdocs", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events", "mail", "data", "verify", "wrenfield", "halden", "quillfeather", "paylantern", "wallet", "guide", "web"],
  seeded: ["warehouse", "helpdesk", "vaultdocs", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events", "mail", "verify"],
  mcp: ["warehouse", "helpdesk", "vaultdocs", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events", "mail"],
  ask: ["warehouse", "helpdesk", "vaultdocs"],
  webmcp: ["warehouse", "helpdesk", "vaultdocs", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events", "mail"],
  unlisted: ["paylantern", "wallet", "guide", "web", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"],
};

/** A deployment of the chart's apps with its flags, or of fewer apps (each flag kept for the apps it still has). */
export function deployment(names: readonly string[] = CHART.apps): AppRegistry {
  const has = (list: string[]) => list.filter((n) => names.includes(n));
  return new AppRegistry(Object.fromEntries(names.map((n) => [n, `http://${n}`])), has(CHART.seeded), has(CHART.mcp), has(CHART.ask), has(CHART.webmcp), has(CHART.unlisted));
}

/** The workspace service as the portal asks it (validate, urls): no database is reached. */
export function serviceFor(apps: AppRegistry, doors: DoorSet): WorkspaceService {
  return new WorkspaceService({ scenarios, apps, publicBaseUrl: BASE, defaultTtlSeconds: 3600, maxTtlSeconds: 7200, doors } as unknown as WorkspaceServiceDeps);
}

export function viewsFor(o: { doors?: DoorSet; apps?: AppRegistry; lists?: ITaskLists } = {}): PortalViews {
  const doors = o.doors ?? DoorSet.ALL;
  const apps = o.apps ?? deployment();
  return portalViews({ apps, scenarios, service: serviceFor(apps, doors), doors, publicBaseUrl: BASE, lists: o.lists ?? PUBLIC_LISTS, registry: doors.list().length > 1 });
}

/** Escape as the pages do. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
/** What a browser reads an escaped attribute or text as. */
export const unesc = (s: string): string => s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] as string);

/** The attributes of an opening tag, unescaped; a bare attribute (`hidden`) as "". */
export function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/\s([a-z][\w-]*)(?:="([^"]*)")?/g)) out[m[1] as string] = unesc(m[2] ?? "");
  return out;
}

/** Every element of `tag` with the attribute `marker`, as its attributes. */
export const elements = (html: string, tag: string, marker: string): Record<string, string>[] =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => attrsOf(m[0].slice(tag.length + 1))).filter((a) => marker in a);

/** The HTML of the element with `id` (an article, a section, a p): from its opening tag to its closing one. */
export function byId(html: string, tag: string, id: string): string {
  const at = html.search(new RegExp(`<${tag}\\b[^>]*\\sid="${id}"`));
  if (at === -1) return "";
  return html.slice(at, html.indexOf(`</${tag}>`, at) + tag.length + 3);
}

type Listener = (e: unknown) => unknown;
type FakeNode = {
  tagName: string;
  textContent: string;
  hidden: boolean;
  value: string;
  attrs: Record<string, string>;
  on: Record<string, Listener[]>;
  focused: number;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: Listener): void;
  focus(): void;
};

function node(tagName: string, attrs: Record<string, string> = {}, textContent = ""): FakeNode {
  const n: FakeNode = {
    tagName,
    textContent,
    hidden: "hidden" in attrs,
    value: attrs.value ?? "",
    attrs,
    on: {},
    focused: 0,
    getAttribute: (name) => n.attrs[name] ?? null,
    addEventListener: (type, fn) => void (n.on[type] ??= []).push(fn),
    focus: () => void n.focused++,
  };
  return n;
}

/**
 * The pages' script, run on a page's own HTML: its items (`[data-search]`), its filters (`select[data-filter]`), its
 * search box, count, empty state and copy buttons, each a fake node made from what the page rendered.
 */
export function runScript(html: string, o: { search?: string; clipboard?: "ok" | "refused" | "none" } = {}) {
  const items = [...html.matchAll(/<article\b[^>]*>/g)].map((m) => node("ARTICLE", attrsOf(m[0].slice(8)))).filter((n) => "data-search" in n.attrs);
  const filters = elements(html, "select", "data-filter").map((a) => node("SELECT", a));
  const ids: Record<string, FakeNode> = {};
  for (const m of html.matchAll(/<(p|span|input|code)\b([^>]*)\sid="([^"]+)"([^>]*)>([^<]*)/g)) ids[m[3] as string] = node((m[1] as string).toUpperCase(), attrsOf(`${m[2]} ${m[4]}`), unesc(m[5] ?? ""));
  for (const code of html.matchAll(/<code\b([^>]*)\sid="([^"]+)"([^>]*)>([\s\S]*?)<\/code>/g)) ids[code[2] as string] = node("CODE", attrsOf(`${code[1]} ${code[3]}`), unesc((code[4] ?? "").replace(/<[^>]+>/g, "")));
  const buttons = elements(html, "button", "data-copy").map((a) => node("BUTTON", a, a["data-label"] ?? ""));
  const document = {
    ...node("DOCUMENT"),
    getElementById: (id: string) => ids[id] ?? null,
    querySelectorAll: (sel: string) => (sel === "[data-search]" ? items : sel === "select[data-filter]" ? filters : []),
    createRange: () => ({ node: null as FakeNode | null, selectNodeContents(el: FakeNode) { this.node = el; } }),
  };
  const selected: FakeNode[] = [];
  const copied: string[] = [];
  const clipboard =
    o.clipboard === "none"
      ? undefined
      : { writeText: (text: string) => (o.clipboard === "refused" ? Promise.reject(new Error("refused")) : (copied.push(text), Promise.resolve())) };
  const window = { getSelection: () => ({ removeAllRanges: () => undefined, addRange: (r: { node: FakeNode }) => void selected.push(r.node) }) };
  runInContext(LANDING_SCRIPT, createContext({ document, window, location: { search: o.search ?? "" }, URLSearchParams, navigator: { clipboard }, setTimeout: () => 0 }));
  const fire = (target: { on: Record<string, Listener[]> }, type: string, e: unknown = {}) => {
    for (const fn of target.on[type] ?? []) fn(e);
  };
  const q = ids.q;
  return {
    ids,
    items,
    filters,
    copied,
    selected,
    /** The items left shown, by their scenario key or task id. */
    visible: () => items.filter((n) => !n.hidden).map((n) => n.attrs["data-scenario"] ?? n.attrs.id?.replace(/^task-/, "") ?? ""),
    type(text: string) {
      if (!q) throw new Error("the page has no search box");
      q.value = text;
      fire(q, "input");
    },
    pick(name: string, value: string) {
      const f = filters.find((n) => n.attrs["data-filter"] === name);
      if (!f) throw new Error(`the page has no ${name} filter`);
      f.value = value;
      fire(f, "change");
    },
    /** A key pressed on the page (on `target`, the body by default); says whether the page took it. */
    keydown(key: string, target: { tagName: string } = { tagName: "BODY" }) {
      let prevented = false;
      fire(document, "keydown", { key, target, preventDefault: () => void (prevented = true) });
      return prevented;
    },
    keyInBox(key: string) {
      if (q) fire(q, "keydown", { key });
    },
    /** Press the copy button for the code with `id`; resolves once the clipboard has answered. */
    async copy(id: string) {
      const button = buttons.find((b) => b.attrs["data-copy"] === id);
      if (!button) throw new Error(`no copy button for ${id}`);
      fire(document, "click", { target: { closest: (sel: string) => (sel === "button[data-copy]" ? button : null) } });
      await new Promise((r) => setImmediate(r));
      return button;
    },
  };
}
