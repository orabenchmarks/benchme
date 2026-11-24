import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "@benchme/scenarios";
import { z } from "zod";

/**
 * A scenario's PUBLIC tasks, as its front page and its own page show them: what
 * each task asks (its prompts, step by step), the sites it touches, what kind of
 * check grades each step, and its judge criteria where the list has them. Read
 * from the corpus's public list (`<name>-tasks.json`, the tasks without their
 * answers), never from a keyed corpus or a task's answer key: the reader refuses
 * any other file name, and the image carries only those lists.
 *
 * Not its `summary`, though the public list has one: a summary says what the right
 * outcome is, and some name it outright (the cinema a booking ends up at, the time
 * a reservation is pushed to), so it stays off pages an agent under test can open.
 */
export type PublicStep = { prompt: string; check: "state" | "json" | null; rubric: string[] };
export type PublicTask = {
  id: string;
  /** The sites it touches, in the order it meets them. */
  sites: string[];
  /** cuj-style corpora: its focus area and its level (one of four), and whether it is in the flagged "very hard" part of hard. */
  area: string | null;
  level: string | null;
  veryHard: boolean;
  steps: PublicStep[];
};

/** The one shape a public list's file name has. A keyed corpus (`*-corpus.json`) or a key (`<id>.json`) never does. */
export const PUBLIC_LIST_NAME = /^[a-z0-9][a-z0-9-]*-tasks\.json$/;

const checkOf = (v: unknown): PublicStep["check"] => (v === "state" || v === "json" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

const stepSchema = z.object({ intent: z.string(), kind: z.string().optional(), rubric: z.array(z.string()).optional() }).passthrough();
const recordSchema = z
  .object({
    id: z.string(),
    intent: z.string(),
    app: z.string().optional(),
    apps: z.array(z.string()).optional(),
    area: z.string().optional(),
    level: z.string().optional(),
    veryHard: z.boolean().optional(),
    kind: z.string().optional(),
    oracle: z.string().optional(),
    rubric: z.array(z.string()).optional(),
    steps: z.array(stepSchema).optional(),
  })
  .passthrough();

/** One record of a public list, in the page's terms. The three corpora's lists differ only in what they carry. */
export function publicTaskOf(raw: unknown): PublicTask {
  const r = recordSchema.parse(raw);
  const first: PublicStep = { prompt: r.intent, check: checkOf(r.kind ?? r.oracle), rubric: strings(r.rubric) };
  const rest = (r.steps ?? []).map((s) => ({ prompt: s.intent, check: checkOf(s.kind), rubric: strings(s.rubric) }));
  return {
    id: r.id,
    sites: r.apps ?? (r.app ? [r.app] : []),
    area: r.area ?? null,
    level: r.level ?? null,
    veryHard: r.veryHard === true,
    steps: [first, ...rest],
  };
}

/** Where a deployment's public lists are: a source the pages ask, so a test or another layout can hand its own. */
export interface ITaskLists {
  /** The scenario's public tasks, or null when it publishes none or this deployment does not carry its list. */
  listOf(scenario: Pick<Scenario, "key" | "docs">): readonly PublicTask[] | null;
}

/**
 * The lists in one directory, by the file name a scenario's `docs.corpus.public` gives. Read once each and kept: a
 * list never changes while a deployment runs. A list that cannot be read or parsed is no list (the page says the
 * deployment does not carry it); it never fails the page.
 */
export class DirectoryTaskLists implements ITaskLists {
  private readonly read = new Map<string, readonly PublicTask[] | null>();

  constructor(private readonly dir: string | null) {}

  listOf(scenario: Pick<Scenario, "key" | "docs">): readonly PublicTask[] | null {
    const path = scenario.docs.corpus?.public;
    if (!path || !this.dir) return null;
    const name = basename(path);
    if (!PUBLIC_LIST_NAME.test(name)) return null;
    if (!this.read.has(name)) this.read.set(name, this.load(join(this.dir, name)));
    return this.read.get(name) ?? null;
  }

  private load(file: string): readonly PublicTask[] | null {
    try {
      const rows: unknown = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(rows) ? rows.map(publicTaskOf) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Where the lists are when no `PUBLIC_TASKS_DIR` says: beside the gateway in its image (`apps/gateway/tasks`, which
 * the image's build copies the public lists into, and nothing else), else the repository's `compose/specs` when run
 * from a checkout. Null when neither exists.
 */
export function defaultTaskListsDir(): string | null {
  const candidates = [new URL("../../tasks/", import.meta.url), new URL("../../../../compose/specs/", import.meta.url)].map((u) => fileURLToPath(u));
  return candidates.find((dir) => existsSync(dir)) ?? null;
}
