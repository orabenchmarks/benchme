import type { WorkspaceStateReader } from "../state-reader.js";

export type Row = Record<string, unknown>;
/** An `expect` value: a scalar, or a nested object matched key by key (against an array field, by any element). */
export type ExpectValue = string | number | boolean | { [key: string]: ExpectValue };

/**
 * Cap on how many pages of a paginated list a check follows. The apps'
 * `{ items, nextCursor }` list routes (warehouse orders, helpdesk tickets)
 * paginate at a page size the check must not depend on — but a runaway or
 * cyclic cursor must not turn one check into an unbounded read either, so
 * this bounds it and the check notes when the cap, not the data, ended it.
 */
export const MAX_PAGES = 10;

/**
 * A list response is rows as-is; a paginated `{ items: [...] }` envelope
 * unwraps to those items (see `readAllRows` for following `nextCursor`); a
 * detail response (no `items` array) is one row; anything else has none.
 */
export function asRows(data: unknown): Row[] {
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

export function fieldEquals(actual: unknown, expected: string | number | boolean): boolean {
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

export function matchesExpectObject(row: Row, expected: Record<string, ExpectValue>): boolean {
  return Object.entries(expected).every(([field, value]) => matchesExpectValue(row[field], value));
}

export function matchesWhere(row: Row, where: Record<string, string> | undefined): boolean {
  return !where || Object.entries(where).every(([field, value]) => fieldEquals(row[field], value));
}

/** The first field in `expect` that does not match `row`, if any. */
export function firstMismatch(row: Row, expect: Record<string, ExpectValue>): string | undefined {
  for (const [field, expected] of Object.entries(expect)) {
    if (!matchesExpectValue(row[field], expected)) return `expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(row[field])}`;
  }
  return undefined;
}

/** Fills `{field}` placeholders in a template from a row's own fields, each value passed through `encode`. */
export function fillPlaceholders(template: string, row: Row, encode: (value: string) => string = (v) => v): string {
  return template.replace(/\{(\w+)\}/g, (_, field: string) => encode(String(row[field] ?? "")));
}

/**
 * Reads `path` and, if the response is a paginated `{ items, nextCursor }`
 * envelope, keeps re-reading `path` with `?cursor=<nextCursor>` appended
 * (always against the ORIGINAL path, not the previous page's URL — the
 * apps' list routes take one cursor param on a fixed base path, not a
 * nested one) until `nextCursor` is null or MAX_PAGES is reached. A check
 * against a paginated route must see the whole list, not just page one.
 */
export async function readAllRows(reader: WorkspaceStateReader, workspaceId: string, app: string, path: string): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  let currentPath = path;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await reader.get(workspaceId, app, currentPath);
    rows.push(...asRows(data));
    const cursor = nextCursorOf(data);
    if (!cursor) return { rows, truncated: false };
    if (page === MAX_PAGES - 1) return { rows, truncated: true };
    currentPath = withCursor(path, cursor);
  }
  /* istanbul ignore next -- loop always returns from within */
  return { rows, truncated: false };
}
