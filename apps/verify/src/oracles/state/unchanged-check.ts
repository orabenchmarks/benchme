import type { LedgerEntry } from "@benchme/site-kit";
import type { StateCheckSpecOf, UnchangedScope } from "../../specs/spec.js";
import type { CheckEnv, CheckOutcome, StateCheck } from "./check.js";
import { describeEntry, entryMatches, isAfter, isSuccessfulWrite } from "./ledger.js";

/** Whether a write falls in a scope: one of its apps, and (when given) its actor, its entity and its subject. */
const inScope = (e: LedgerEntry, { apps, ...narrow }: UnchangedScope): boolean => apps.some((app) => app.toLowerCase() === e.app.toLowerCase()) && entryMatches(e, { app: e.app, ...narrow });

/**
 * The ledger holds no successful write in a scope: nothing was changed. A
 * scope is some apps' ledgers, optionally only one actor's writes and one
 * entity type (or one entity), or only the writes about one thing (their
 * subject); several scopes are alternatives, and a write in any counts.
 * `except` names the writes that are allowed; `after` counts only the writes
 * later than the entry an earlier check stood on. A refused write changed
 * nothing and a sign-up is no write, so neither counts. It says what did NOT
 * happen and so has no time of its own.
 */
export class UnchangedCheck implements StateCheck<"unchanged"> {
  readonly kind = "unchanged" as const;

  async run(c: StateCheckSpecOf<"unchanged">, env: CheckEnv): Promise<CheckOutcome> {
    const scopes = Array.isArray(c.scope) ? c.scope : [c.scope];
    const ref = c.after === undefined ? undefined : env.earlier(c.after)?.entry;
    if (c.after !== undefined && !ref) return { name: c.name, ok: false, note: `"${c.after}" did not pass on a ledger entry, so there is no point to count changes from` };
    let entries: LedgerEntry[];
    try {
      entries = (await Promise.all([...new Set(scopes.flatMap((s) => s.apps))].map((app) => env.ledger(app)))).flat();
    } catch (err) {
      return { name: c.name, ok: false, note: `ledger unreachable: ${(err as Error).message}` };
    }
    const changed = entries.filter(
      (e) => isSuccessfulWrite(e) && scopes.some((s) => inScope(e, s)) && !(ref && !isAfter(e, ref)) && !(c.except ?? []).some((allowed) => entryMatches(e, allowed)),
    );
    if (changed.length === 0) return { name: c.name, ok: true };
    return { name: c.name, ok: false, note: `${changed.length} successful ${changed.length === 1 ? "write" : "writes"} where none was expected; the first, ${describeEntry(changed[0] as LedgerEntry)}` };
  }
}
