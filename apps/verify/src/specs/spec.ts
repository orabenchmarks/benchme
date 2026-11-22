import { DOORS, LEDGER_OUTCOMES } from "@benchme/site-kit";
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
  /** Expected top-level fields; numbers may carry a tolerance. Never empty — see `stateSpec.checks.expect`. */
  expect: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.object({ value: z.number(), tolerance: z.number().min(0) })]))
    .refine((o) => Object.keys(o).length > 0, "expect must name at least one field"),
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

/**
 * A ROW check: today's kind, and the one a check without a `kind` is. It reads
 * one app's live REST state for this workspace (never the submitted artifact —
 * end state is the evidence) and must find at least one row that survives
 * `where` and satisfies `expect`.
 */
const rowCheck = z.object({
  kind: z.literal("row").optional(),
  name: z.string().min(1),
  /** APP_TARGETS key of the app to read (e.g. "warehouse", "helpdesk"). */
  app: z.string().min(1),
  /** A REST list or detail path on that app, e.g. "/api/v1/orders" or "/api/v1/orders/SO-1". */
  path: z.string().min(1),
  /**
   * Every field here must equal the row's field (case-insensitive for
   * strings); see `ExpectValue`. An EMPTY `expect` is rejected at load:
   * it is satisfied by any row at all, so the check would silently
   * degrade to "something exists here" and pass a wrong submission.
   */
  expect: z.record(z.string(), expectValue).refine((o) => Object.keys(o).length > 0, "expect must name at least one field"),
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
  /**
   * The row's entity in the site's change ledger, `id` with `{field}`
   * placeholders filled from the row that satisfied the check (e.g.
   * `{ "type": "booking", "id": "{bookingNo}" }`). With it, a passing check
   * reports `at`: the time of the last successful write the ledger holds for
   * that entity, the change that made the row what it is. Without it, or when
   * the ledger holds no such write (a seeded row nobody touched), there is no
   * `at`.
   */
  entity: z.object({ type: z.string().min(1), id: z.string().min(1) }).strict().optional(),
});

/**
 * An ABSENT check: no row matches. It reads rows as a row check does; a row
 * matches when it survives `where` and, if given, satisfies `expect`; the
 * check passes when none does. With neither, it passes only on an empty list.
 * A read that could not be finished proves no absence, and fails.
 */
const absentCheck = z
  .object({
    kind: z.literal("absent"),
    name: z.string().min(1),
    app: z.string().min(1),
    path: z.string().min(1),
    where: z.record(z.string(), z.string()).optional(),
    expect: z.record(z.string(), expectValue).refine((o) => Object.keys(o).length > 0, "expect must name at least one field").optional(),
  })
  .strict();

/**
 * What picks entries out of one app's change ledger: every field given must
 * equal the entry's (strings case-insensitively, as rows are compared). `app`
 * is the ledger to read; at least one other field must narrow it, or the match
 * is "anything at all happened there". A read is `action: "read"`; `actor:
 * null` is an entry made by nobody signed in.
 */
const ledgerMatch = z
  .object({
    app: z.string().min(1),
    entity: z.object({ type: z.string().min(1), id: z.string().min(1).optional() }).strict().optional(),
    action: z.string().min(1).optional(),
    outcome: z.enum(LEDGER_OUTCOMES).optional(),
    /** The site's reason code of a refused entry. */
    code: z.string().min(1).optional(),
    door: z.enum(DOORS).optional(),
    actor: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).some((k) => k !== "app"), "a ledger match must name more than the app");
export type LedgerMatch = z.infer<typeof ledgerMatch>;

/**
 * A LEDGER check: an entry matches. `match` is one matcher, or several of
 * which any one will do (an impossible task's "looked at the thing, or was
 * refused with the expected reason"). `after` names an earlier check of the
 * task: only entries later than the one that satisfied it count. The entry's
 * time is the check's `at`; of several that match, the earliest.
 */
const ledgerCheck = z
  .object({
    kind: z.literal("ledger"),
    name: z.string().min(1),
    match: z.union([ledgerMatch, z.array(ledgerMatch).min(1)]),
    after: z.string().min(1).optional(),
  })
  .strict();

/**
 * An UNCHANGED check: the ledger holds no successful write in a scope. The
 * scope is the ledgers of `apps` (one site, or every site of the scenario for
 * a whole workspace), optionally only what one `actor` wrote (`null`: what
 * nobody signed in wrote) and only one `entity` type or one entity. `except`
 * names the writes that are allowed, as ledger matchers. A sign-up or sign-in
 * is an `auth` entry and never counts as a write.
 */
const unchangedCheck = z
  .object({
    kind: z.literal("unchanged"),
    name: z.string().min(1),
    scope: z
      .object({
        apps: z.array(z.string().min(1)).min(1),
        actor: z.string().min(1).nullable().optional(),
        entity: z.object({ type: z.string().min(1), id: z.string().min(1).optional() }).strict().optional(),
      })
      .strict(),
    except: z.array(ledgerMatch).optional(),
  })
  .strict();

/**
 * The kinds of check a state oracle runs, by name. A registry on both sides: a
 * kind is one schema here and one `StateCheck` in oracles/state/, never a
 * branch in the oracle.
 */
const CHECK_SCHEMAS = { row: rowCheck, absent: absentCheck, ledger: ledgerCheck, unchanged: unchangedCheck } as const;
export type StateCheckKind = keyof typeof CHECK_SCHEMAS;
export type StateCheckSpec = { [K in StateCheckKind]: z.infer<(typeof CHECK_SCHEMAS)[K]> }[StateCheckKind];
export type StateCheckSpecOf<K extends StateCheckKind> = z.infer<(typeof CHECK_SCHEMAS)[K]>;

/** A check's kind: the one it names, or `row` for a check that names none (every check written before there were kinds). */
export const checkKindOf = (check: { kind?: string | undefined }): string => check.kind ?? "row";

/**
 * One check, parsed by its own kind's schema. Dispatching by hand rather than
 * with a union keeps each kind's own errors (a union reports every member's),
 * and keeps a check without a `kind` exactly as it was written: nothing is
 * added to it, so a spec that parsed before parses to the same value.
 */
const stateCheck = z.unknown().transform((value, ctx): StateCheckSpec => {
  const kind = checkKindOf((value ?? {}) as { kind?: string });
  if (!Object.hasOwn(CHECK_SCHEMAS, kind)) {
    ctx.addIssue({ code: "custom", message: `unknown check kind "${kind}"; there is ${Object.keys(CHECK_SCHEMAS).join(", ")}` });
    return z.NEVER;
  }
  const parsed = CHECK_SCHEMAS[kind as StateCheckKind].safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) ctx.addIssue(issue);
  return z.NEVER;
});

/** The names an `after` may point at are the checks before it; a name two of them share points at neither. */
export function afterProblems(checks: readonly StateCheckSpec[], earlier: readonly string[] = []): string[] {
  const seen = [...earlier];
  const problems: string[] = [];
  for (const check of checks) {
    if (check.kind === "ledger" && check.after !== undefined) {
      const named = seen.filter((name) => name === check.after).length;
      if (named !== 1) problems.push(`check "${check.name}" comes after "${check.after}", which ${named === 0 ? "no earlier check is called" : "more than one earlier check is called"}`);
    }
    seen.push(check.name);
  }
  return problems;
}

export const stateSpec = z.object({
  kind: z.literal("state"),
  /** At least one check; each is a `row` check unless it names another kind. */
  checks: z.array(stateCheck).min(1),
});

/** A follow-up step's oracle: an answer (`json`, graded by whoever holds the reply) or the sites' state. */
const stepSpec = z.object({ oracle: z.discriminatedUnion("kind", [jsonSpec, stateSpec]) }).strict();
/** The most follow-up steps a task may have: eight steps with its own. */
export const MAX_FOLLOW_UP_STEPS = 7;

export const taskSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    /** Blind receipts (hard tier): details carry counts only, never names. */
    blind: z.boolean().default(false),
    /** The task's own oracle: step 1 of a task that has steps. */
    oracle: z.discriminatedUnion("kind", [jsonSpec, xlsxSpec, docxSpec, patchSpec, stateSpec]),
    /**
     * The task's FOLLOW-UP steps, in order: step 2 is `steps[0]`. A task is
     * done in one conversation, each step a further prompt, and the verifier
     * is asked once, after the last. A spec that declares `steps` (an empty
     * list for a task of one step) is answered step by step; one that does not
     * is answered as it always was.
     */
    steps: z.array(stepSpec).max(MAX_FOLLOW_UP_STEPS).optional(),
  })
  .superRefine((spec, ctx) => {
    const stepped = spec.steps !== undefined;
    if (stepped && spec.oracle.kind !== "json" && spec.oracle.kind !== "state") {
      ctx.addIssue({ code: "custom", path: ["steps"], message: `a task with steps has a json or state oracle, not ${spec.oracle.kind}` });
      return;
    }
    // Every state step's checks, in the order they run: an `after` may reach back into an earlier step.
    const seen: string[] = [];
    for (const [i, oracle] of [spec.oracle, ...(spec.steps ?? []).map((s) => s.oracle)].entries()) {
      if (oracle.kind !== "state") continue;
      const path = i === 0 ? ["oracle", "checks"] : ["steps", i - 1, "oracle", "checks"];
      for (const message of afterProblems(oracle.checks, seen)) ctx.addIssue({ code: "custom", path, message });
      // A stepped answer names every check: two of one name could not be told apart, in the answer or by an `after`.
      for (const check of oracle.checks) {
        if (stepped && seen.includes(check.name)) ctx.addIssue({ code: "custom", path, message: `check "${check.name}" is named twice in the task; a task with steps names each check once` });
        seen.push(check.name);
      }
    }
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
