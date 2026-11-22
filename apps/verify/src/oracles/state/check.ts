import type { LedgerEntry } from "@benchme/site-kit";
import { checkKindOf, type StateCheckKind, type StateCheckSpec, type StateCheckSpecOf } from "../../specs/spec.js";
import type { CheckResult } from "../oracle.js";
import type { WorkspaceStateReader } from "../state-reader.js";

/**
 * What one check found, beyond pass or fail: the ledger entry that satisfied
 * it, when one did. Its time is the check's `at`; its place in its ledger is
 * what a later check's `after` is measured from; its entity is what a later
 * check's `@<check name>` id stands for.
 */
export type CheckOutcome = CheckResult & { entry?: Pick<LedgerEntry, "app" | "seq" | "at" | "entity"> };

/** What a check works with: the workspace, the two readers, and the checks already run. */
export type CheckEnv = {
  workspaceId: string;
  /** The app's rows, through its own REST API. */
  reader: WorkspaceStateReader;
  /** One app's change ledger, whole and oldest first. Read once per submission, however many checks ask. */
  ledger(app: string): Promise<LedgerEntry[]>;
  /** The outcome of an earlier check of the task, by name. */
  earlier(name: string): CheckOutcome | undefined;
};

/** One kind of check. Strategy: a new kind is a class registered below (and a schema in specs/spec.ts), never a branch in the oracle. */
export interface StateCheck<K extends StateCheckKind = StateCheckKind> {
  readonly kind: K;
  run(check: StateCheckSpecOf<K>, env: CheckEnv): Promise<CheckOutcome>;
}

export class StateCheckRegistry {
  private readonly byKind = new Map<string, StateCheck>();

  register<K extends StateCheckKind>(check: StateCheck<K>): this {
    if (this.byKind.has(check.kind)) throw new Error(`duplicate state check: ${check.kind}`);
    this.byKind.set(check.kind, check as unknown as StateCheck);
    return this;
  }

  /** Runs a check with its own kind's implementation; a check without a kind is a row check. */
  run(check: StateCheckSpec, env: CheckEnv): Promise<CheckOutcome> {
    const kind = checkKindOf(check);
    const impl = this.byKind.get(kind);
    if (!impl) throw new Error(`no state check for kind ${kind}`);
    return impl.run(check, env);
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}
