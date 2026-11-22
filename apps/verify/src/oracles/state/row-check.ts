import type { StateCheckSpecOf } from "../../specs/spec.js";
import type { CheckEnv, CheckOutcome, StateCheck } from "./check.js";
import { lastWriteOf } from "./ledger.js";
import { MAX_PAGES, asRows, fillPlaceholders, firstMismatch, matchesWhere, readAllRows, type Row } from "./rows.js";

type Check = StateCheckSpecOf<"row">;

/**
 * Cap on how many `where`-matched list rows a `rowPath` check will fetch a
 * detail row for. A wrong-SKU/wrong-qty submission must not pass just
 * because the right order is buried past whatever page/position an agent's
 * attempts happened to land on — but an unbounded fan-out of detail fetches
 * per check is its own footgun, so this bounds it (the check notes when the
 * cap, not the data, ended the search).
 */
const MAX_ROW_FETCHES = 20;

/** Fetches `rowPath` (with `{field}` resolved from `row`, URL-encoded so a space or `&` in e.g. an order number can't corrupt the path or inject a stray query param) via `fetchRow`, and merges it UNDER the list row (detail fields win, but a list-only field is still reachable by `expect`). */
async function fetchMergedRow(row: Row, rowPath: string, fetchRow: (path: string) => Promise<unknown>): Promise<Row> {
  const detail = await fetchRow(fillPlaceholders(rowPath, row, encodeURIComponent));
  const detailRow = asRows(detail)[0];
  return detailRow ? { ...row, ...detailRow } : row;
}

/** The verdict on the rows read, and, when it passed, the row that satisfied it. */
async function checkRows(rows: Row[], c: Check, truncated: boolean, fetchRow: (path: string) => Promise<unknown>): Promise<{ outcome: CheckOutcome; row?: Row }> {
  const fail = (note: string) => ({ outcome: { name: c.name, ok: false, note } });
  // Only decorates a FAILING note — a passing check needs no caveat, and a
  // truncated read that still found its row proves nothing was missed.
  const pagingNote = truncated ? ` (stopped after ${MAX_PAGES} pages of results; more may exist)` : "";
  const matched = rows.filter((r) => matchesWhere(r, c.where));
  if (matched.length === 0) {
    return fail(`no row at ${c.app}${c.path}${c.where ? ` matching ${JSON.stringify(c.where)}` : ""}${pagingNote}`);
  }
  if (c.count?.min !== undefined && matched.length < c.count.min) {
    return fail(`expected at least ${c.count.min} matching rows, got ${matched.length}${pagingNote}`);
  }
  // A truncated read is NOT evidence of too many rows: MAX_PAGES exists to
  // bound a runaway or cyclic cursor, and a cyclic one hands back the same
  // rows over and over — counting those as distinct would fail a duplicate
  // check (`max: 1`) on data that has no duplicate at all. `min` is still
  // safe (more rows than we saw can only help it), so only `max` is skipped.
  if (c.count?.max !== undefined && !truncated && matched.length > c.count.max) {
    return fail(`expected at most ${c.count.max} matching rows, got ${matched.length}${pagingNote}`);
  }

  if (!c.rowPath) {
    const mismatches = matched.map((r) => firstMismatch(r, c.expect));
    const at = mismatches.findIndex((m) => m === undefined);
    if (at >= 0) return { outcome: { name: c.name, ok: true }, row: matched[at] as Row };
    return fail(`${mismatches[0]}${pagingNote}`);
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
    // error out of the whole check (the catch in `run()` would otherwise
    // fail the check on one flaky row).
    let merged: Row;
    try {
      merged = await fetchMergedRow(row, c.rowPath, fetchRow);
    } catch {
      lastMismatch = `row ${i + 1}: detail unavailable`;
      continue;
    }
    const mismatch = firstMismatch(merged, c.expect);
    if (mismatch === undefined) return { outcome: { name: c.name, ok: true }, row: merged };
    lastMismatch = mismatch;
  }
  return fail(`${lastMismatch}${pagingNote}${rowFetchNote}`);
}

/**
 * At least one row survives `where` and satisfies `expect`: the END STATE of
 * a workspace app (an order shipped, a ticket resolved), read through that
 * app's own REST API. With `entity`, a passing check also says when the row
 * became what it is: the last successful write the ledger holds for it.
 */
export class RowCheck implements StateCheck<"row"> {
  readonly kind = "row" as const;

  async run(c: Check, env: CheckEnv): Promise<CheckOutcome> {
    let found: Awaited<ReturnType<typeof checkRows>>;
    try {
      const { rows, truncated } = await readAllRows(env.reader, env.workspaceId, c.app, c.path);
      found = await checkRows(rows, c, truncated, (path) => env.reader.get(env.workspaceId, c.app, path));
    } catch (err) {
      return { name: c.name, ok: false, note: `${c.app}${c.path} unreachable: ${(err as Error).message}` };
    }
    if (!found.outcome.ok || !found.row || !c.entity) return found.outcome;
    try {
      const entry = lastWriteOf(await env.ledger(c.app), c.entity.type, fillPlaceholders(c.entity.id, found.row));
      return entry ? { ...found.outcome, entry } : found.outcome;
    } catch (err) {
      return { name: c.name, ok: false, note: `the row is there, but ${c.app}'s ledger could not say when it was written: ${(err as Error).message}` };
    }
  }
}
