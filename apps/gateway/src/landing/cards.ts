import { DOORS, type Door, type DoorSet } from "@benchme/core";
import { appInfo, sitesOf, type Scenario, type ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";
import { WorkspaceError, type WorkspaceService } from "../workspace-service.js";
import type { ITaskLists } from "./task-lists.js";

/** Where the repository's files are read: a scenario's page links its write-up and its public task list there. */
export const SOURCE_URL = "https://github.com/orabenchmarks/benchme";
const blob = (path: string) => `${SOURCE_URL}/blob/main/${path}`;

export type SiteView = { key: string; name: string };
export type LinkView = { label: string; href: string };

/** One scenario as the front page shows it. Everything on it comes from the scenario's own data and this deployment. */
export type ScenarioCard = {
  key: string;
  title: string;
  about: string;
  /** The first sentence of `about`: what the card says, the rest is on the scenario's own page. */
  lead: string;
  /** The scenario's own page on this deployment: its tasks, where it publishes them. */
  page: string;
  /** The sites its tasks are about that this deployment serves. */
  sites: SiteView[];
  /** The ones it does not. */
  missing: SiteView[];
  /** The doors this deployment serves its sites through: pages always, and each other door that is open and that one of its sites has. */
  doors: Door[];
  /** How many tasks its corpus holds, where it has one: the public list's own count when this deployment carries it. */
  tasks: number | null;
  /** The seed its corpus is written against, where it has one: the seed its command mints. */
  seed: number | null;
  /**
   * Its write-up, then its public task list. Never its answer keys or their derivations: an agent under test can
   * open these pages, and they stay one step further away, in the repository.
   */
  links: LinkView[];
  /** The command that mints a workspace of it here (at its corpus's seed, where it has one), or null where this deployment cannot. */
  mint: string | null;
  /** What the search box matches: its key, title, description, sites and doors, in lower case. */
  search: string;
};

export type CardDeps = {
  scenarios: ScenarioRegistry;
  apps: AppRegistry;
  service: Pick<WorkspaceService, "validate">;
  /** The deployment's doors. */
  doors: DoorSet;
  publicBaseUrl: string;
  /** The public task lists this deployment carries (none: each card counts its corpus from its metadata). */
  lists?: ITaskLists;
};

/** What a person sees a door called. */
export const DOOR_LABELS: Readonly<Record<Door, string>> = { page: "Pages", rest: "REST", mcp: "MCP", webmcp: "WebMCP" };

/** Every registered scenario's card, in the registry's order. */
export function scenarioCards(d: CardDeps): ScenarioCard[] {
  return d.scenarios.list().map((s) => cardOf(s, d));
}

function cardOf(s: Scenario, d: CardDeps): ScenarioCard {
  const named = sitesOf(s).map((key) => ({ key, name: appInfo(key).name }));
  const sites = named.filter((site) => d.apps.get(site.key));
  const doors = DOORS.filter((door) => d.doors.has(door) && (door === "page" || sites.some((site) => (appInfo(site.key).doors as readonly string[]).includes(door))));
  const corpus = s.docs.corpus;
  const links: LinkView[] = [{ label: "The write-up", href: blob(s.docs.page) }];
  if (corpus) links.push({ label: "The task list in the repository", href: blob(corpus.public) });
  const search = [s.key, s.title, s.about, s.description, ...sites.flatMap((site) => [site.key, site.name]), ...doors.map((door) => DOOR_LABELS[door])].join(" ");
  const list = d.lists?.listOf(s) ?? null;
  return {
    key: s.key,
    title: s.title,
    about: s.about,
    lead: firstSentence(s.about),
    page: `/scenarios/${encodeURIComponent(s.key)}`,
    sites,
    missing: named.filter((site) => !d.apps.get(site.key)),
    doors,
    tasks: list ? list.length : (corpus?.tasks ?? null),
    seed: corpus?.seed ?? null,
    links,
    mint: mintable(s, d) ? mintCommand(d.publicBaseUrl, corpus ? { scenario: s.key, seed: corpus.seed } : { scenario: s.key }) : null,
    search: normalize(search),
  };
}

/** A text's first sentence: up to the first full stop that ends a sentence (not one inside "e.g." or a number). */
export function firstSentence(text: string): string {
  const at = text.search(/[.!?](?=\s+[A-Z])/);
  return at === -1 ? text : text.slice(0, at + 1);
}

/** Whether this deployment would mint a workspace of `s` (it serves every app the scenario names). */
export function mintable(s: Scenario, d: Pick<CardDeps, "service">): boolean {
  try {
    d.service.validate({ scenario: s.key });
    return true;
  } catch (err) {
    if (err instanceof WorkspaceError) return false;
    throw err;
  }
}

/** What a copy button copies, said: "the command that mints a cuj-v1 workspace", "… an acme-v1 workspace". */
export const mintsWhat = (key: string): string => `the command that mints ${/^[aeiou]/i.test(key) ? "an" : "a"} ${key} workspace`;

/** The curl that mints a workspace with `body`, as a person pastes it into a shell: one option a line. */
export const mintCommand = (publicBaseUrl: string, body: Record<string, unknown>): string =>
  [`curl -s -X POST ${publicBaseUrl.replace(/\/+$/, "")}/api/workspaces`, `-H 'content-type: application/json'`, `-d '${JSON.stringify(body)}'`].join(" \\\n  ");

/** The words of a query, as the search box reads them. */
export const queryTerms = (query: string): string[] => normalize(query).split(/\s+/).filter(Boolean);

/** Whether a card says every word of a query: a query of no words matches every card. The page's script asks the same. */
export const matches = (card: Pick<ScenarioCard, "search">, terms: readonly string[]): boolean => terms.every((term) => card.search.includes(term));

/** Text as the search box compares it: lower case, accents dropped. The page's script reads a query the same way. */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
