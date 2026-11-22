import type { z } from "zod";
import type { stateSpec } from "../specs/spec.js";
import { verdictOf, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";
import { AbsentCheck } from "./state/absent-check.js";
import { StateCheckRegistry, type CheckEnv, type CheckOutcome } from "./state/check.js";
import { LedgerCheck } from "./state/ledger-check.js";
import { ledgerSnapshot } from "./state/ledger.js";
import { RowCheck } from "./state/row-check.js";
import { UnchangedCheck } from "./state/unchanged-check.js";
import type { WorkspaceStateReader } from "./state-reader.js";

type Spec = z.infer<typeof stateSpec>;

/** Every kind of check a state spec may name (specs/spec.ts has the schema of each). */
export const defaultStateChecks = (): StateCheckRegistry => new StateCheckRegistry().register(new RowCheck()).register(new AbsentCheck()).register(new LedgerCheck()).register(new UnchangedCheck());

/**
 * Checks what actually happened in a workspace's apps — the submitted
 * artifact is ignored entirely. The evidence is the END STATE (an order
 * shipped, a ticket resolved), read live through each app's own REST API, and
 * the sites' change ledgers (what was read, written and refused, by whom,
 * through which door, when), both via the injected WorkspaceStateReader. Each
 * check is run by its own kind (oracles/state/); they run in order, so one
 * may stand on an earlier one. Asked for several steps of one submission
 * (`ctx.submission`), it carries the checks already run and the ledgers
 * already read from step to step.
 */
export class StateOracle implements Oracle<Spec> {
  readonly kind = "state" as const;
  private readonly carried = new WeakMap<object, { env: CheckEnv; done: CheckOutcome[] }>();

  constructor(
    private readonly reader: WorkspaceStateReader,
    private readonly checks: StateCheckRegistry = defaultStateChecks(),
  ) {}

  async check(_artifact: Buffer, spec: Spec, ctx: OracleContext): Promise<OracleResult> {
    const { env, done } = this.runOf(ctx);
    const ran: CheckOutcome[] = [];
    for (const c of spec.checks) {
      const outcome = await this.checks.run(c, env);
      ran.push(outcome);
      done.push(outcome);
    }
    const checks = ran.map(({ entry, ...result }) => (entry ? { ...result, at: entry.at } : result));
    return { verdict: verdictOf(checks), checks };
  }

  /** What a submission's checks share: one reading of each ledger, and the checks run so far. A call that is no step of a submission gets its own. */
  private runOf(ctx: OracleContext): { env: CheckEnv; done: CheckOutcome[] } {
    const carried = ctx.submission && this.carried.get(ctx.submission);
    if (carried) return carried;
    const done: CheckOutcome[] = [];
    const run = {
      done,
      env: { workspaceId: ctx.workspaceId, reader: this.reader, ledger: ledgerSnapshot(this.reader, ctx.workspaceId), earlier: (name: string) => done.find((c) => c.name === name) },
    };
    if (ctx.submission) this.carried.set(ctx.submission, run);
    return run;
  }
}
