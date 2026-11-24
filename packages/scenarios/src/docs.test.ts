import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_INFO, appInfo } from "./apps.js";
import { scenarios, sitesOf } from "./index.js";

// What a deployment's front page says of each scenario comes from here, so what it says has to stay true: a count of
// tasks that no longer matches the corpus, or a link to a page or a section that is gone, would mislead silently.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const all = scenarios.list();

/** A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as hyphens. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
const anchorsOf = (markdown: string) => markdown.split("\n").flatMap((line) => (/^#{1,6}\s/.test(line) ? [slug(line.replace(/^#+\s+/, ""))] : []));

describe("what a scenario says of itself", () => {
  it.each(all.map((s) => [s.key, s] as const))("%s has a title and a few sentences about it", (_key, s) => {
    expect(s.title.trim().length).toBeGreaterThan(3);
    expect(s.about.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 20).length).toBeGreaterThanOrEqual(2);
  });

  it.each(all.map((s) => [s.key, s] as const))("%s points at a page of the repository that is there, at a section that is there", (_key, s) => {
    const [file, anchor] = s.docs.page.split("#") as [string, string | undefined];
    expect(existsSync(join(ROOT, file)), file).toBe(true);
    if (anchor) expect(anchorsOf(read(file)), s.docs.page).toContain(anchor);
  });

  it.each(all.filter((s) => s.docs.corpus).map((s) => [s.key, s.docs.corpus!] as const))("%s counts the tasks its corpus files hold, at the seed they were written for", (_key, corpus) => {
    for (const file of [corpus.public, corpus.keyed]) {
      const records = JSON.parse(read(file)) as unknown[];
      expect([file, records.length]).toEqual([file, corpus.tasks]);
    }
    expect(existsSync(join(ROOT, corpus.derivations)), corpus.derivations).toBe(true);
    // tools/intent-corpus.mjs writes every corpus at one seed; --check holds the files to it.
    expect(read("tools/intent-corpus.mjs")).toMatch(new RegExp(`option\\("seed", ${corpus.seed}\\)`));
  });

  it("names every site a scenario is about", () => {
    const unknown = all.flatMap((s) => sitesOf(s).filter((key) => !Object.hasOwn(APP_INFO, key)).map((key) => `${s.key}: ${key}`));
    expect(unknown).toEqual([]);
    expect(all.every((s) => sitesOf(s).length > 0)).toBe(true);
  });
});

describe("the apps' names", () => {
  /** Every .ts source file of an app, tests left out: where it names itself. */
  const sourceOf = (app: string): string => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(readFileSync(path, "utf8"));
      }
    };
    walk(join(ROOT, "apps", app, "src"));
    return files.join("\n");
  };
  /** The app whose source carries a name, where it is not the app's own key: the stores are one app. */
  const SOURCE: Record<string, string> = { wrenfield: "shops", halden: "shops", quillfeather: "shops" };
  // The company site's name is generated from the seed, and the site network and the verifier have none of their own:
  // theirs are descriptions.
  const DESCRIBED = ["data", "web", "verify"];

  it.each(Object.keys(APP_INFO).filter((key) => !DESCRIBED.includes(key)))("%s: its name is the one its own pages carry", (key) => {
    expect(sourceOf(SOURCE[key] ?? key)).toContain(`${APP_INFO[key]!.name}`);
  });

  it("gives an app it does not know its key for a name, and its pages alone", () => {
    expect(appInfo("nowhere")).toEqual({ name: "nowhere", doors: [] });
    expect(appInfo("toString")).toEqual({ name: "toString", doors: [] });
  });
});
