import { scenarios, type Scenario } from "@benchme/scenarios";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DirectoryTaskLists, PUBLIC_LIST_NAME, publicTaskOf } from "./task-lists.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SPECS_DIR = join(ROOT, "compose/specs");
const PUBLIC_LISTS = new DirectoryTaskLists(SPECS_DIR);
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const withCorpus = scenarios.list().filter((s) => s.docs.corpus);

describe("the public task lists", () => {
  it.each(withCorpus.map((s) => [s.key, s] as const))("%s: the list its corpus names, every record of it, in the page's terms", (_key, s) => {
    const list = PUBLIC_LISTS.listOf(s)!;
    const rows = read(s.docs.corpus!.public) as Record<string, unknown>[];
    expect(list).toHaveLength(s.docs.corpus!.tasks);
    expect(list.map((t) => t.id)).toEqual(rows.map((r) => r.id));
    for (const t of list) expect(t.steps.every((step) => step.prompt.length > 0 && (step.check === "state" || step.check === "json"))).toBe(true);
  });

  it("reads each corpus's shape: a conversation's steps and their criteria, a level and its very hard flag, an app or apps, an oracle or a kind", () => {
    const step = (prompt: string, check: "state" | "json", rubric: string[] = []) => ({ prompt, check, rubric });
    expect(publicTaskOf({ id: "a", intent: "Do it.", app: "warehouse", oracle: "state", summary: "It is done.", surfaces: ["pages"] })).toEqual({ id: "a", sites: ["warehouse"], area: null, level: null, veryHard: false, steps: [step("Do it.", "state")] });
    expect(publicTaskOf({ id: "b", intent: "Which?", app: "hotels", oracle: "json", rubric: ["Right."] })).toEqual({ id: "b", sites: ["hotels"], area: null, level: null, veryHard: false, steps: [step("Which?", "json", ["Right."])] });
    expect(publicTaskOf({ id: "c", intent: "Book it.", apps: ["flights", "hotels"], app: "flights", area: "plan-across-sites", level: "hard", veryHard: true, kind: "state", rubric: ["One."], steps: [{ intent: "And?", kind: "json", rubric: ["Two."] }] })).toEqual({
      id: "c",
      sites: ["flights", "hotels"],
      area: "plan-across-sites",
      level: "hard",
      veryHard: true,
      steps: [step("Book it.", "state", ["One."]), step("And?", "json", ["Two."])],
    });
    // A list's summary is never carried: some name the right outcome outright.
    expect(Object.keys(publicTaskOf({ id: "d", intent: "x", summary: "the answer" }))).not.toContain("summary");
  });

  it("refuses to read anything but a public list: a keyed corpus or an answer key is no list, even beside the public ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchme-lists-"));
    for (const f of ["cuj-tasks.json", "cuj-corpus.json", "intent-order-01.json"]) copyFileSync(join(SPECS_DIR, f), join(dir, f));
    const lists = new DirectoryTaskLists(dir);
    const named = (path: string) => ({ key: "x", docs: { page: "README.md", corpus: { tasks: 1, seed: 1, public: path, keyed: "k", derivations: "d" } } }) as Pick<Scenario, "key" | "docs">;
    expect(lists.listOf(named("compose/specs/cuj-tasks.json"))).toHaveLength(120);
    for (const path of ["compose/specs/cuj-corpus.json", "compose/specs/intent-order-01.json", "compose/specs/../specs/cuj-corpus.json", "cuj-tasks.json/../cuj-corpus.json"]) expect([path, lists.listOf(named(path))]).toEqual([path, null]);
    expect([PUBLIC_LIST_NAME.test("cuj-tasks.json"), PUBLIC_LIST_NAME.test("cuj-corpus.json"), PUBLIC_LIST_NAME.test("intent-order-01.json"), PUBLIC_LIST_NAME.test(".cuj-tasks.json")]).toEqual([true, false, false, false]);
  });

  it("is no list where it cannot be read: no corpus, no directory, no file, not JSON, not a list", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchme-lists-"));
    writeFileSync(join(dir, "broken-tasks.json"), "{ not json");
    writeFileSync(join(dir, "object-tasks.json"), '{"id":"a"}');
    const named = (path: string) => ({ key: "x", docs: { page: "README.md", corpus: { tasks: 1, seed: 1, public: path, keyed: "k", derivations: "d" } } }) as Pick<Scenario, "key" | "docs">;
    expect(new DirectoryTaskLists(dir).listOf(scenarios.get("shops-v1"))).toBeNull();
    expect(new DirectoryTaskLists(null).listOf(scenarios.get("cuj-v1"))).toBeNull();
    for (const f of ["missing-tasks.json", "broken-tasks.json", "object-tasks.json"]) expect([f, new DirectoryTaskLists(dir).listOf(named(f))]).toEqual([f, null]);
  });
});

describe("the image", () => {
  const dockerfile = readFileSync(join(ROOT, "docker/app.Dockerfile"), "utf8");

  it("carries the scenarios' public lists beside the gateway, each by name, and nothing else from the corpus directory", () => {
    const copies = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+)$/gm)].map((m) => (m[1] as string).trim().split(/\s+/));
    const fromSpecs = copies.filter((args) => args.some((a) => a.startsWith("compose/")));
    expect(fromSpecs).toHaveLength(1);
    const [line] = fromSpecs as [string[]];
    expect(line.at(-1)).toBe("./apps/gateway/tasks/");
    const sources = line.slice(0, -1);
    expect(sources.every((src) => src.startsWith("compose/specs/") && PUBLIC_LIST_NAME.test(src.slice("compose/specs/".length)))).toBe(true);
    expect(new Set(sources)).toEqual(new Set(withCorpus.map((s) => s.docs.corpus!.public)));
    // And nothing copies the whole of compose/ or its specs, or the whole context: no glob, no directory.
    expect(dockerfile).not.toMatch(/^COPY\s+(?:\S+\s+)*compose\/?(?:specs\/?)?\s/m);
    expect(dockerfile).not.toMatch(/^COPY\s+.*compose\/specs\/\*/m);
    expect(dockerfile).not.toMatch(/^COPY\s+(?:--\S+\s+)*\.\s/m);
  });
});
