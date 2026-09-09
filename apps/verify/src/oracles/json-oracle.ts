import { z } from "zod";
import type { jsonSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleResult } from "./oracle.js";

type Spec = z.infer<typeof jsonSpec>;

/** A JSON answer document: every expected field must be present and equal (numbers within tolerance). */
export class JsonOracle implements Oracle<Spec> {
  readonly kind = "json" as const;

  async check(artifact: Buffer, spec: Spec): Promise<OracleResult> {
    let doc: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(artifact.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      return { verdict: "FAIL", checks: [{ name: "parse", ok: false, note: `invalid JSON object: ${(err as Error).message}` }] };
    }
    const checks: CheckResult[] = [{ name: "parse", ok: true }];
    for (const [field, expected] of Object.entries(spec.expect)) {
      const actual = doc[field];
      if (typeof expected === "object") {
        const ok = typeof actual === "number" && Math.abs(actual - expected.value) <= expected.tolerance;
        checks.push({ name: field, ok, note: ok ? undefined : `expected ${expected.value}±${expected.tolerance}, got ${JSON.stringify(actual)}` });
      } else {
        const ok = typeof actual === typeof expected && (typeof expected === "string" ? String(actual).trim().toLowerCase() === expected.trim().toLowerCase() : actual === expected);
        checks.push({ name: field, ok, note: ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` });
      }
    }
    return { verdict: verdictOf(checks), checks };
  }
}
