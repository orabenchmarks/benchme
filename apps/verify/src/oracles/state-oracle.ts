import type { z } from "zod";
import type { stateSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";
import type { WorkspaceStateReader } from "./state-reader.js";

type Spec = z.infer<typeof stateSpec>;
type Check = Spec["checks"][number];
type Row = Record<string, unknown>;
type ExpectValue = Check["expect"][string];

/**
 * Cap on how many `where`-matched list rows a `rowPath` check will fetch a
 * detail row for. A wrong-SKU/wrong-qty submission must not pass just
 * because the right order is buried past whatever page/position an agent's
 * attempts happened to land on — but an unbounded fan-out of detail fetches
 * per check is its own footgun, so this bounds it (the check notes when the
 * cap, not the data, ended the search).
 */
const MAX_ROW_FETCHES = 20;

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

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Matches one `expect` value against one field's actual value. A scalar
 * `expected` is a direct `fieldEquals`. An object `expected` against an
 * ARRAY `actual` is array-any: it matches if SOME element satisfies every
 * key (e.g. `{ lines: { sku: "A", qty: 5 } }` against `lines: [...]` — a
 * wrong-SKU or wrong-qty line does not satisfy it, only the exact pair
 * does). An object `expected` against a non-array object `actual` recurses
 * field by field.
 */
function matchesExpectValue(actual: unknown, expected: ExpectValue): boolean {
  if (isPlainObject(expected)) {
    if (Array.isArray(actual)) return actual.some((el) => isPlainObject(el) && matchesExpectObject(el, expected));
    return isPlainObject(actual) && matchesExpectObject(actual, expected);
  }
  return fieldEquals(actual, expected);
}

function matchesExpectObject(row: Row, expected: Record<string, ExpectValue>): boolean {
  return Object.entries(expected).every(([field, value]) => matchesExpectValue(row[field], value));
}

function matchesWhere(row: Row, where: Record<string, string> | undefined): boolean {
  return !where || Object.entries(where).every(([field, value]) => fieldEquals(row[field], value));
}

/** The first field in `expect` that does not match `row`, if any. */
function firstMismatch(row: Row, expect: Record<string, ExpectValue>): string | undefined {
  for (const [field, expected] of Object.entries(expect)) {
    if (!matchesExpectValue(row[field], expected)) return `expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(row[field])}`;
  }
  return undefined;
}

/** Substitutes `{field}` placeholders in a `rowPath` template from a matched list row's own fields, URL-encoding each value (same as `withCursor` does for a cursor) so a space or `&` in e.g. an order number can't corrupt the path or inject a stray query param. */
function resolvePlaceholders(template: string, row: Row): string {
  return template.replace(/\{(\w+)\}/g, (_, field: string) => encodeURIComponent(String(row[field] ?? "")));
}

/** Fetches `rowPath` (with `{field}` resolved from `row`) via `fetchRow`, and merges it UNDER the list row (detail fields win, but a list-only field is still reachable by `expect`). */
async function fetchMergedRow(row: Row, rowPath: string, fetchRow: (path: string) => Promise<unknown>): Promise<Row> {
  const detail = await fetchRow(resolvePlaceholders(rowPath, row));
  const detailRow = asRows(detail)[0];
  return detailRow ? { ...row, ...detailRow } : row;
}

async function checkOne(rows: Row[], c: Check, truncated: boolean, fetchRow: (path: string) => Promise<unknown>): Promise<CheckResult> {
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

  if (!c.rowPath) {
    const mismatches = matched.map((r) => firstMismatch(r, c.expect));
    if (mismatches.some((m) => m === undefined)) return { name: c.name, ok: true };
    return { name: c.name, ok: false, note: `${mismatches[0]}${pagingNote}` };
  }

  // `rowPath` set: `expect` can only be trusted against the DETAIL row (the
  // list row alone can't carry e.g. nested line items), so fetch one detail
  // row per matched list row — up to MAX_ROW_FETCHES — until one satisfies
  // `expect`, rather than accepting the first list row that merely exists.
  const examined = matched.slice(0, MAX_ROW_FETCHES);
  const rowFetchNote = matched.length > MAX_ROW_FETCHES ? ` (stopped after examining ${MAX_ROW_FETCHES} matching rows; more may exist)` : "";
  let lastMismatch: string | undefined;
  for (const [i, row] of examined.entries()) {
    // A single row's detail fetch failing (404, non-2xx, a thrown network
    // error) is a property of THAT row, not of the check — one bad row must
    // not hide a real match on another, so it's a non-match, not a thrown
    // error out of the whole check (the outer catch in `check()` would
    // otherwise fail every check sharing this app on one flaky row).
    let merged: Row;
    try {
      merged = await fetchMergedRow(row, c.rowPath, fetchRow);
    } catch {
      lastMismatch = `row ${i + 1}: detail unavailable`;
      continue;
    }
    const mismatch = firstMismatch(merged, c.expect);
    if (mismatch === undefined) return { name: c.name, ok: true };
    lastMismatch = mismatch;
  }
  return { name: c.name, ok: false, note: `${lastMismatch}${pagingNote}${rowFetchNote}` };
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
        const fetchRow = (path: string) => this.reader.get(ctx.workspaceId, c.app, path);
        checks.push(await checkOne(rows, c, truncated, fetchRow));
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
