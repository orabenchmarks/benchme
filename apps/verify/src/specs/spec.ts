import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * A task spec is what the verifier checks a submission against. It is HIDDEN
 * (baked into the image from benchme-hidden) and never served. Each kind has
 * its own config shape; the oracle registry dispatches on `kind`.
 */
export const jsonSpec = z.object({
  kind: z.literal("json"),
  /** Expected top-level fields; numbers may carry a tolerance. */
  expect: z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.object({ value: z.number(), tolerance: z.number().min(0) })])),
});

export const xlsxSpec = z.object({
  kind: z.literal("xlsx"),
  sheets: z.array(
    z.object({
      name: z.string(),
      /** Cell address → expected value (number/string) or { formula: "SUM(" } (formula must contain). */
      cells: z.record(z.string(), z.union([z.string(), z.number(), z.object({ formula: z.string() }), z.object({ value: z.number(), tolerance: z.number().min(0) })])).default({}),
      headerRow: z.array(z.string()).optional(),
      frozenHeader: z.boolean().optional(),
    }),
  ),
});

export const docxSpec = z.object({
  kind: z.literal("docx"),
  /** Paragraph texts that must appear (substring, case-insensitive). */
  contains: z.array(z.string()).default([]),
  /** Heading texts that must be styled as headings (Heading1..9). */
  headings: z.array(z.string()).default([]),
  minTables: z.number().int().min(0).default(0),
  minParagraphs: z.number().int().min(0).default(0),
});

export const patchSpec = z.object({
  kind: z.literal("patch"),
  /** Runner image for this seed repo (fresh clone at the pinned SHA + hidden tests baked in). */
  runnerImage: z.string(),
  /** Optional container command override (the image's entrypoint by default). */
  runnerCommand: z.array(z.string()).optional(),
  /** The SHA the patch must apply to (informational; the runner pins it). */
  baseSha: z.string(),
  /**
   * Hidden files injected into the runner at run time (path → content, mounted
   * at /hidden; the runner copies them over the checkout before testing). This
   * is how hidden tests reach a PUBLIC runner image without ever being baked
   * into it. Total size must fit a ConfigMap (~900 KB).
   */
  hiddenFiles: z.record(z.string().regex(/^[A-Za-z0-9_./-]+$/), z.string()).default({}),
  /** Hidden test ids that must pass; empty = every test the runner reports. */
  requiredTests: z.array(z.string()).default([]),
  lint: z.boolean().default(true),
  typecheck: z.boolean().default(true),
  timeoutSeconds: z.number().int().positive().default(600),
});

/**
 * An `expect` value: a scalar matched directly against a row's field, or a
 * nested object that recurses — against an object field it matches key by
 * key, against an ARRAY field it matches if ANY element satisfies every key
 * (array-any; e.g. `{ lines: { sku: "...", qty: 40 } }` against an order's
 * `lines[]` — see StateOracle for the match semantics).
 */
type ExpectValue = string | number | boolean | { [key: string]: ExpectValue };
const expectValue: z.ZodType<ExpectValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), expectValue)]));

export const stateSpec = z.object({
  kind: z.literal("state"),
  /**
   * Each check reads one app's live REST state for this workspace (never the
   * submitted artifact — end state is the evidence) and must find at least
   * one row that survives `where` and satisfies `expect`.
   */
  checks: z.array(
    z.object({
      name: z.string().min(1),
      /** APP_TARGETS key of the app to read (e.g. "warehouse", "helpdesk"). */
      app: z.string().min(1),
      /** A REST list or detail path on that app, e.g. "/api/v1/orders" or "/api/v1/orders/SO-1". */
      path: z.string().min(1),
      /** Every field here must equal the row's field (case-insensitive for strings); see `ExpectValue`. */
      expect: z.record(z.string(), expectValue),
      /** Narrows a list response to matching rows before `expect`/`count`/`rowPath` apply. */
      where: z.record(z.string(), z.string()).optional(),
      /** Bounds on how many rows survive `where` (e.g. max:1 catches a duplicate). */
      count: z.object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).optional(),
      /**
       * Optional per-row detail fetch. For each `where`-matched LIST row (up
       * to MAX_ROW_FETCHES), `{field}` placeholders are substituted from
       * that row's own fields and the resulting path is fetched; `expect`
       * is then evaluated against the fetched detail row, with the list
       * row's fields merged underneath (so `expect` can still name a field
       * that only exists on the list row). Lets a check reach a field (e.g.
       * nested line items) that only exists on a detail route addressed by
       * a value the list row carries (e.g. an order number) — without the
       * task having to predict that value up front.
       */
      rowPath: z.string().optional(),
    }),
  ).min(1),
});

export const taskSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  /** Blind receipts (hard tier): details carry counts only, never names. */
  blind: z.boolean().default(false),
  oracle: z.discriminatedUnion("kind", [jsonSpec, xlsxSpec, docxSpec, patchSpec, stateSpec]),
});

export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type OracleSpec = TaskSpec["oracle"];

export interface SpecRegistry {
  get(taskId: string): Promise<TaskSpec | null>;
  count(): Promise<number>;
}

/** Specs as JSON files in a directory (the hidden repo, baked at image build). */
export class FsSpecRegistry implements SpecRegistry {
  constructor(private readonly dir: string) {}
  async get(taskId: string): Promise<TaskSpec | null> {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(taskId)) return null;
    try {
      const raw = await readFile(join(this.dir, `${taskId}.json`), "utf8");
      const spec = taskSpecSchema.parse(JSON.parse(raw));
      return spec.id === taskId ? spec : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async count(): Promise<number> {
    try {
      return (await readdir(this.dir)).filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }
}

export class MemorySpecRegistry implements SpecRegistry {
  private readonly specs = new Map<string, TaskSpec>();
  constructor(specs: TaskSpec[] = []) {
    for (const s of specs) this.specs.set(s.id, taskSpecSchema.parse(s));
  }
  async get(taskId: string): Promise<TaskSpec | null> {
    return this.specs.get(taskId) ?? null;
  }
  async count(): Promise<number> {
    return this.specs.size;
  }
}
