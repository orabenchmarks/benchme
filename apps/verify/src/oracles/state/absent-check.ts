import type { StateCheckSpecOf } from "../../specs/spec.js";
import type { CheckEnv, CheckOutcome, StateCheck } from "./check.js";
import { MAX_PAGES, matchesExpectObject, matchesWhere, readAllRows } from "./rows.js";

/**
 * No row matches: the pass a row check cannot give (for it, zero matches is
 * the failure). A row matches when it survives `where` and, if given,
 * satisfies `expect`. Absence has to be proven over everything there is, so a
 * read that could not be finished (the paging cap, an unreachable app) fails.
 * A path that is simply not there (a 404) holds no row, and passes.
 */
export class AbsentCheck implements StateCheck<"absent"> {
  readonly kind = "absent" as const;

  async run(c: StateCheckSpecOf<"absent">, env: CheckEnv): Promise<CheckOutcome> {
    try {
      const { rows, truncated } = await readAllRows(env.reader, env.workspaceId, c.app, c.path);
      const matched = rows.filter((r) => matchesWhere(r, c.where) && (!c.expect || matchesExpectObject(r, c.expect)));
      if (matched.length > 0) return { name: c.name, ok: false, note: `expected no matching row at ${c.app}${c.path}, found ${matched.length}: ${JSON.stringify(matched[0]).slice(0, 200)}` };
      if (truncated) return { name: c.name, ok: false, note: `no matching row in the first ${MAX_PAGES} pages of ${c.app}${c.path}, but the list goes on: absence is not proven` };
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, note: `${c.app}${c.path} unreachable: ${(err as Error).message}` };
    }
  }
}
