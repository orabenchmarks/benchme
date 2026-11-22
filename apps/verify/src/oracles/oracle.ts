import type { Verdict } from "@benchme/core";
import type { OracleSpec, TaskSpec } from "../specs/spec.js";

/**
 * One named check inside a verdict. `at` is when what satisfied it happened:
 * the time of a ledger entry, for a state check that stands on one. Never the
 * time the check ran.
 */
export type CheckResult = { name: string; ok: boolean; note?: string; at?: string };

export type OracleResult = { verdict: Verdict; checks: CheckResult[] };

export type OracleContext = {
  workspaceId: string;
  taskId: string;
  /**
   * One object per submission, when the submission asks an oracle more than
   * once (a task's steps). An oracle may keep what it learned under it, so a
   * later step can stand on an earlier one and nothing is read twice.
   */
  submission?: object;
};

/**
 * An oracle judges one artifact kind against its spec. Registry (Strategy):
 * a new artifact kind is a new Oracle registered here, never a switch in the route.
 */
export interface Oracle<S extends OracleSpec = OracleSpec> {
  readonly kind: S["kind"];
  check(artifact: Buffer, spec: S, ctx: OracleContext): Promise<OracleResult>;
}

export class OracleRegistry {
  private readonly byKind = new Map<string, Oracle>();

  register<S extends OracleSpec>(oracle: Oracle<S>): this {
    if (this.byKind.has(oracle.kind)) throw new Error(`duplicate oracle: ${oracle.kind}`);
    this.byKind.set(oracle.kind, oracle as unknown as Oracle);
    return this;
  }

  for(spec: TaskSpec): Oracle {
    return this.forKind(spec.oracle.kind);
  }

  forKind(kind: OracleSpec["kind"]): Oracle {
    const o = this.byKind.get(kind);
    if (!o) throw new Error(`no oracle for kind ${kind}`);
    return o;
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}

export function verdictOf(checks: CheckResult[]): Verdict {
  return checks.length > 0 && checks.every((c) => c.ok) ? "OK" : "FAIL";
}

/** Easy/medium receipts name the failing checks; hard (blind) receipts carry counts only. */
export function detailsFor(spec: TaskSpec, result: Pick<OracleResult, "checks">): unknown[] {
  if (spec.blind) {
    const failed = result.checks.filter((c) => !c.ok).length;
    return [{ passed: result.checks.length - failed, failed }];
  }
  return result.checks.map((c) => ({ name: c.name, ok: c.ok, ...(c.note && !c.ok ? { note: c.note } : {}) }));
}
