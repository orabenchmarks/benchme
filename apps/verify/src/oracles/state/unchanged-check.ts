import type { LedgerEntry } from "@benchme/site-kit";
import type { StateCheckSpecOf } from "../../specs/spec.js";
import type { CheckEnv, CheckOutcome, StateCheck } from "./check.js";
import { describeEntry, entryMatches, isSuccessfulWrite } from "./ledger.js";

/**
 * The ledger holds no successful write in a scope: nothing was changed. The
 * scope is every listed app's ledger, optionally only one actor's writes and
 * one entity type (or one entity); `except` names the writes that are
 * allowed. A refused write changed nothing and a sign-up is no write, so
 * neither counts. It says what did NOT happen and so has no time of its own.
 */
export class UnchangedCheck implements StateCheck<"unchanged"> {
  readonly kind = "unchanged" as const;

  async run(c: StateCheckSpecOf<"unchanged">, env: CheckEnv): Promise<CheckOutcome> {
    let entries: LedgerEntry[];
    try {
      entries = (await Promise.all([...new Set(c.scope.apps)].map((app) => env.ledger(app)))).flat();
    } catch (err) {
      return { name: c.name, ok: false, note: `ledger unreachable: ${(err as Error).message}` };
    }
    // The scope is a matcher without its app: who wrote, and what.
    const { apps: _apps, ...scope } = c.scope;
    const changed = entries.filter((e) => isSuccessfulWrite(e) && entryMatches(e, { app: e.app, ...scope }) && !(c.except ?? []).some((allowed) => entryMatches(e, allowed)));
    if (changed.length === 0) return { name: c.name, ok: true };
    return { name: c.name, ok: false, note: `${changed.length} successful ${changed.length === 1 ? "write" : "writes"} where none was expected; the first, ${describeEntry(changed[0] as LedgerEntry)}` };
  }
}
