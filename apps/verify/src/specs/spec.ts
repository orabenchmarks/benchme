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
  /** Hidden test ids that must pass; empty = every test the runner reports. */
  requiredTests: z.array(z.string()).default([]),
  lint: z.boolean().default(true),
  typecheck: z.boolean().default(true),
  timeoutSeconds: z.number().int().positive().default(600),
});

export const taskSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  /** Blind receipts (hard tier): details carry counts only, never names. */
  blind: z.boolean().default(false),
  oracle: z.discriminatedUnion("kind", [jsonSpec, xlsxSpec, docxSpec, patchSpec]),
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
