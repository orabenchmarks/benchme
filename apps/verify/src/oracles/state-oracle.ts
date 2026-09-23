import type { z } from "zod";
import type { stateSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";
import type { WorkspaceStateReader } from "./state-reader.js";

type Spec = z.infer<typeof stateSpec>;
type Check = Spec["checks"][number];
type Row = Record<string, unknown>;

/**
 * Cap on how many pages of a paginated list a check follows. The apps'
 * `{ items, nextCursor }` list routes (warehouse orders, helpdesk tickets)
 * paginate at a page size the check must not depend on — but a runaway or
 * cyclic cursor must not turn one check into an unbounded read either, so
 * this bounds it and the check notes when the cap, not the data, ended it.
 */
const MAX_PAGES = 10;

/**
 * A list response is rows as-is; a paginated `{ items: [...] }` envelope
 * unwraps to those items (see `readAllRows` for following `nextCursor`); a
 * detail response (no `items` array) is one row; anything else has none.
 */
function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((r): r is Row => !!r && typeof r === "object");
  if (data && typeof data === "object") {
    const obj = data as Row;
    if (Array.isArray(obj.items)) return obj.items.filter((r): r is Row => !!r && typeof r === "object");
    return [obj];
  }
  return [];
}

/** The envelope's `nextCursor`, or null for anything that isn't one (bare array, detail object, no more pages). */
function nextCursorOf(data: unknown): string | null {
  if (data && typeof data === "object" && "nextCursor" in data) {
    const v = (data as Row).nextCursor;
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** Appends `cursor` as a query param, respecting a `?` the path may already carry (e.g. `?status=open`). */
function withCursor(path: string, cursor: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

function fieldEquals(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof expected === "string") return String(actual ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
  return actual === expected;
}

function matchesWhere(row: Row, where: Record<string, string> | undefined): boolean {
  return !where || Object.entries(where).every(([field, value]) => fieldEquals(row[field], value));
}

/** The first field in `expect` that does not match `row`, if any. */
function firstMismatch(row: Row, expect: Record<string, string | number | boolean>): string | undefined {
  for (const [field, expected] of Object.entries(expect)) {
    if (!fieldEquals(row[field], expected)) return `expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(row[field])}`;
  }
  return undefined;
}

function checkOne(rows: Row[], c: Check, truncated: boolean): CheckResult {
  // Only decorates a FAILING note — a passing check needs no caveat, and a
  // truncated read that still found its row proves nothing was missed.
  const pagingNote = truncated ? ` (stopped after ${MAX_PAGES} pages of results; more may exist)` : "";
  const matched = rows.filter((r) => matchesWhere(r, c.where));
  if (matched.length === 0) {
    return { name: c.name, ok: false, note: `no row at ${c.app}${c.path}${c.where ? ` matching ${JSON.stringify(c.where)}` : ""}${pagingNote}` };
  }
  if (c.count?.min !== undefined && matched.length < c.count.min) {
    return { name: c.name, ok: false, note: `expected at least ${c.count.min} matching rows, got ${matched.length}${pagingNote}` };
  }
  if (c.count?.max !== undefined && matched.length > c.count.max) {
    return { name: c.name, ok: false, note: `expected at most ${c.count.max} matching rows, got ${matched.length}` };
  }
  const mismatches = matched.map((r) => firstMismatch(r, c.expect));
  if (mismatches.some((m) => m === undefined)) return { name: c.name, ok: true };
  return { name: c.name, ok: false, note: `${mismatches[0]}${pagingNote}` };
}

/**
 * Checks the END STATE of a workspace app (an order shipped, a ticket
 * resolved) through that app's own REST API — the submitted artifact is
 * ignored entirely; the evidence is what actually happened in the app, read
 * live via the injected WorkspaceStateReader.
 */
export class StateOracle implements Oracle<Spec> {
  readonly kind = "state" as const;
  constructor(private readonly reader: WorkspaceStateReader) {}

  async check(_artifact: Buffer, spec: Spec, ctx: OracleContext): Promise<OracleResult> {
    const checks: CheckResult[] = [];
    for (const c of spec.checks) {
      try {
        const { rows, truncated } = await this.readAllRows(ctx.workspaceId, c.app, c.path);
        checks.push(checkOne(rows, c, truncated));
      } catch (err) {
        checks.push({ name: c.name, ok: false, note: `${c.app}${c.path} unreachable: ${(err as Error).message}` });
      }
    }
    return { verdict: verdictOf(checks), checks };
  }

  /**
   * Reads `path` and, if the response is a paginated `{ items, nextCursor }`
   * envelope, keeps re-reading `path` with `?cursor=<nextCursor>` appended
   * (always against the ORIGINAL path, not the previous page's URL — the
   * apps' list routes take one cursor param on a fixed base path, not a
   * nested one) until `nextCursor` is null or MAX_PAGES is reached. A check
   * against a paginated route must see the whole list, not just page one.
   */
  private async readAllRows(workspaceId: string, app: string, path: string): Promise<{ rows: Row[]; truncated: boolean }> {
    const rows: Row[] = [];
    let currentPath = path;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.reader.get(workspaceId, app, currentPath);
      rows.push(...asRows(data));
      const cursor = nextCursorOf(data);
      if (!cursor) return { rows, truncated: false };
      if (page === MAX_PAGES - 1) return { rows, truncated: true };
      currentPath = withCursor(path, cursor);
    }
    /* istanbul ignore next -- loop always returns from within */
    return { rows, truncated: false };
  }
}
