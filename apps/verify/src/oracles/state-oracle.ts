import type { z } from "zod";
import type { stateSpec } from "../specs/spec.js";
import { verdictOf, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";
import { AbsentCheck } from "./state/absent-check.js";
import { StateCheckRegistry, type CheckOutcome } from "./state/check.js";
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
 * may stand on an earlier one.
 */
export class StateOracle implements Oracle<Spec> {
  readonly kind = "state" as const;
  constructor(
    private readonly reader: WorkspaceStateReader,
    private readonly checks: StateCheckRegistry = defaultStateChecks(),
  ) {}

  async check(_artifact: Buffer, spec: Spec, ctx: OracleContext): Promise<OracleResult> {
    const done: CheckOutcome[] = [];
    const env = {
      workspaceId: ctx.workspaceId,
      reader: this.reader,
      ledger: ledgerSnapshot(this.reader, ctx.workspaceId),
      earlier: (name: string) => done.find((c) => c.name === name),
    };
    for (const c of spec.checks) done.push(await this.checks.run(c, env));
    const checks = done.map(({ entry, ...result }) => (entry ? { ...result, at: entry.at } : result));
    return { verdict: verdictOf(checks), checks };
  }
}
