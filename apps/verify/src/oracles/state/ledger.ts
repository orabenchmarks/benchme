import { ledgerPageSchema, ledgerPath, type LedgerEntry } from "@benchme/site-kit";
import { referencedCheck, type LedgerMatch } from "../../specs/spec.js";
import type { WorkspaceStateReader } from "../state-reader.js";
import type { CheckEnv } from "./check.js";
import { fieldEquals } from "./rows.js";

const PAGE_SIZE = 1000;
/** A hundred thousand entries: far past any run, and a bound on a ledger that never ends. */
const MAX_LEDGER_PAGES = 100;

/**
 * One app's whole change ledger for a workspace, oldest first, read the way
 * the verifier reads everything: on the app's own address, signed (the reader
 * signs as the verifier, which is the only signature the ledger answers).
 *
 * It never hands back part of a ledger. A check that says "nothing was
 * written" over a ledger cut short would pass on what it did not read, so an
 * app with no ledger, an answer that is not a ledger page, or a ledger longer
 * than the cap all throw.
 */
export async function readLedger(reader: WorkspaceStateReader, workspaceId: string, app: string): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let cursor = "0";
  for (let page = 0; page < MAX_LEDGER_PAGES; page++) {
    const data = await reader.get(workspaceId, app, `${ledgerPath(workspaceId)}?cursor=${encodeURIComponent(cursor)}&limit=${PAGE_SIZE}`);
    if (data === null) throw new Error(`${app} keeps no change ledger`);
    const parsed = ledgerPageSchema.safeParse(data);
    if (!parsed.success) throw new Error(`${app} answered its ledger with something else: ${parsed.error.issues[0]?.message ?? "not a ledger page"}`);
    entries.push(...parsed.data.items);
    if (parsed.data.nextCursor === null) return entries;
    cursor = parsed.data.nextCursor;
  }
  throw new Error(`${app}'s ledger did not end within ${MAX_LEDGER_PAGES * PAGE_SIZE} entries`);
}

/** Reads each app's ledger once, however many checks of a submission ask for it. */
export function ledgerSnapshot(reader: WorkspaceStateReader, workspaceId: string): (app: string) => Promise<LedgerEntry[]> {
  const read = new Map<string, Promise<LedgerEntry[]>>();
  return (app) => {
    let entries = read.get(app);
    if (!entries) read.set(app, (entries = readLedger(reader, workspaceId, app)));
    return entries;
  };
}

const same = (actual: string | null, expected: string) => actual !== null && fieldEquals(actual, expected);

/** Whether an entry is one a matcher picks: every field the matcher gives equals the entry's. */
export function entryMatches(entry: LedgerEntry, m: LedgerMatch): boolean {
  if (!same(entry.app, m.app)) return false;
  if (m.entity && (!same(entry.entity.type, m.entity.type) || (m.entity.id !== undefined && !same(entry.entity.id, m.entity.id)))) return false;
  if (m.subject && (!entry.subject || !same(entry.subject.type, m.subject.type) || (m.subject.id !== undefined && !same(entry.subject.id, m.subject.id)))) return false;
  if (m.action !== undefined && !same(entry.action, m.action)) return false;
  if (m.outcome !== undefined && entry.outcome !== m.outcome) return false;
  if (m.code !== undefined && !same(entry.code, m.code)) return false;
  if (m.door !== undefined && entry.door !== m.door) return false;
  if (m.actor !== undefined && (m.actor === null ? entry.actor !== null : !same(entry.actor, m.actor))) return false;
  return true;
}

type Narrowing = { entity?: { type: string; id?: string | undefined } | undefined; subject?: { type: string; id?: string | undefined } | undefined };

/**
 * A matcher or a scope with each `@<check name>` id replaced by the entity id
 * of the entry that check stood on, or why one cannot be: the check did not
 * pass, or passed on no entry that names an entity. A later step's check of
 * "the booking made in step 1" then reads that booking and no other.
 */
export function resolveReferences<T extends Narrowing>(m: T, earlier: CheckEnv["earlier"]): T | { unresolved: string } {
  let out = m;
  for (const key of ["entity", "subject"] as const) {
    const ref = m[key];
    const name = referencedCheck(ref?.id);
    if (!ref || name === undefined) continue;
    const id = earlier(name)?.entry?.entity.id;
    if (!id) return { unresolved: `"${name}" did not pass on a ledger entry for an entity, so ${ref.id} names nothing` };
    out = { ...out, [key]: { ...ref, id } };
  }
  return out;
}

/** Every one of a list resolved, or the first reason one could not be. */
export function resolveAll<T extends Narrowing>(list: readonly T[], earlier: CheckEnv["earlier"]): T[] | { unresolved: string } {
  const out: T[] = [];
  for (const m of list) {
    const r = resolveReferences(m, earlier);
    if ("unresolved" in r) return r;
    out.push(r);
  }
  return out;
}

/** A write that changed something: made, not refused, and not a sign-up or sign-in. */
export const isSuccessfulWrite = (entry: LedgerEntry): boolean => entry.kind === "write" && entry.outcome === "ok";

/** The last successful write a ledger holds for one entity: the change that left its row as it is. */
export function lastWriteOf(entries: readonly LedgerEntry[], type: string, id: string): LedgerEntry | undefined {
  return entries.filter((e) => isSuccessfulWrite(e) && same(e.entity.type, type) && same(e.entity.id, id)).at(-1);
}

/**
 * Whether `entry` came after `ref`. Within one app the ledger's own order
 * decides. Across apps only the time can (one database clock stamps every
 * ledger), and two entries in the same millisecond are taken in the order
 * asked for rather than refused.
 */
export function isAfter(entry: Pick<LedgerEntry, "app" | "seq" | "at">, ref: Pick<LedgerEntry, "app" | "seq" | "at">): boolean {
  if (entry.app === ref.app) return entry.seq > ref.seq;
  return Date.parse(entry.at) >= Date.parse(ref.at);
}

/** A ledger entry in a failure note's words. */
export const describeEntry = (e: LedgerEntry): string =>
  `${e.app}: ${e.entity.type} ${e.entity.id ?? "(new)"}${e.subject ? ` (for ${e.subject.type} ${e.subject.id})` : ""} ${e.action} through ${e.door} by ${e.actor ?? "nobody"} at ${e.at}`;
