import type { LedgerEntry } from "@benchme/site-kit";
import type { StateCheckSpecOf } from "../../specs/spec.js";
import type { CheckEnv, CheckOutcome, StateCheck } from "./check.js";
import { entryMatches, isAfter, resolveAll } from "./ledger.js";

/**
 * An entry of a site's change ledger matches: something was read, written,
 * refused or signed in, by someone, through some door. Several matchers are
 * alternatives. With `after`, only entries later than the one that satisfied
 * the named earlier check count, and an `@<check name>` id is the entity that
 * check stood on. Of the entries that match, the earliest is the one the check
 * stands on, and its time is the check's.
 */
export class LedgerCheck implements StateCheck<"ledger"> {
  readonly kind = "ledger" as const;

  async run(c: StateCheckSpecOf<"ledger">, env: CheckEnv): Promise<CheckOutcome> {
    const matchers = resolveAll(Array.isArray(c.match) ? c.match : [c.match], env.earlier);
    if ("unresolved" in matchers) return { name: c.name, ok: false, note: matchers.unresolved };
    let entries: LedgerEntry[];
    try {
      entries = (await Promise.all([...new Set(matchers.map((m) => m.app))].map((app) => env.ledger(app)))).flat();
    } catch (err) {
      return { name: c.name, ok: false, note: `ledger unreachable: ${(err as Error).message}` };
    }
    let matched = entries.filter((e) => matchers.some((m) => entryMatches(e, m)));
    if (c.after !== undefined) {
      const ref = env.earlier(c.after)?.entry;
      if (!ref) return { name: c.name, ok: false, note: `"${c.after}" did not pass on a ledger entry, so nothing can be said to come after it` };
      const before = matched.length;
      matched = matched.filter((e) => isAfter(e, ref));
      if (matched.length === 0 && before > 0) return { name: c.name, ok: false, note: `${before} matching ledger ${before === 1 ? "entry" : "entries"}, none after "${c.after}" (${ref.at})` };
    }
    const entry = matched.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)[0];
    if (!entry) return { name: c.name, ok: false, note: `no ledger entry matching ${JSON.stringify(c.match)}` };
    return { name: c.name, ok: true, entry };
  }
}
