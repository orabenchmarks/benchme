import { DOORS, type Door, type DoorSet } from "@benchme/core";
import { appInfo, sitesOf, type Scenario, type ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";
import { WorkspaceError, type WorkspaceService } from "../workspace-service.js";

/** Where the repository's files are read: a card links a scenario's write-up and corpus files there. */
export const SOURCE_URL = "https://github.com/orabenchmarks/benchme";
const blob = (path: string) => `${SOURCE_URL}/blob/main/${path}`;

export type SiteView = { key: string; name: string };
export type LinkView = { label: string; href: string };

/** One scenario as the front page shows it. Everything on it comes from the scenario's own data and this deployment. */
export type ScenarioCard = {
  key: string;
  title: string;
  about: string;
  /** The sites its tasks are about that this deployment serves. */
  sites: SiteView[];
  /** The ones it does not. */
  missing: SiteView[];
  /** The doors this deployment serves its sites through: pages always, and each other door that is open and that one of its sites has. */
  doors: Door[];
  /** How many tasks its corpus holds, where it has one. */
  tasks: number | null;
  /** Its write-up, then its corpus files. */
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
  const links: LinkView[] = [{ label: "Read more", href: blob(s.docs.page) }];
  if (corpus) links.push({ label: "tasks", href: blob(corpus.public) }, { label: "answer keys", href: blob(corpus.keyed) }, { label: "derivations", href: blob(corpus.derivations) });
  const search = [s.key, s.title, s.about, s.description, ...sites.flatMap((site) => [site.key, site.name]), ...doors.map((door) => DOOR_LABELS[door])].join(" ");
  return {
    key: s.key,
    title: s.title,
    about: s.about,
    sites,
    missing: named.filter((site) => !d.apps.get(site.key)),
    doors,
    tasks: corpus?.tasks ?? null,
    links,
    mint: mintable(s, d) ? mintCommand(d.publicBaseUrl, corpus ? { scenario: s.key, seed: corpus.seed } : { scenario: s.key }) : null,
    search: normalize(search),
  };
}

/** Whether this deployment would mint a workspace of `s` (it serves every app the scenario names). */
function mintable(s: Scenario, d: CardDeps): boolean {
  try {
    d.service.validate({ scenario: s.key });
    return true;
  } catch (err) {
    if (err instanceof WorkspaceError) return false;
    throw err;
  }
}

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
