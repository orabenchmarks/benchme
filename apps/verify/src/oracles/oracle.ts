import type { Verdict } from "@benchme/core";
import type { OracleSpec, TaskSpec } from "../specs/spec.js";

/** One named check inside a verdict. */
export type CheckResult = { name: string; ok: boolean; note?: string };

export type OracleResult = { verdict: Verdict; checks: CheckResult[] };

export type OracleContext = { workspaceId: string; taskId: string };

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
    const o = this.byKind.get(spec.oracle.kind);
    if (!o) throw new Error(`no oracle for kind ${spec.oracle.kind}`);
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
export function detailsFor(spec: TaskSpec, result: OracleResult): unknown[] {
  if (spec.blind) {
    const failed = result.checks.filter((c) => !c.ok).length;
    return [{ passed: result.checks.length - failed, failed }];
  }
  return result.checks.map((c) => ({ name: c.name, ok: c.ok, ...(c.note && !c.ok ? { note: c.note } : {}) }));
}
