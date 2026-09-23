import type { z } from "zod";
import type { stateSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";
import type { WorkspaceStateReader } from "./state-reader.js";

type Spec = z.infer<typeof stateSpec>;
type Check = Spec["checks"][number];
type Row = Record<string, unknown>;

/** A list response is rows as-is; a detail response is one row; anything else has none. */
function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((r): r is Row => !!r && typeof r === "object");
  if (data && typeof data === "object") return [data as Row];
  return [];
}

function fieldEquals(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof expected === "string") return String(actual ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
  return actual === expected;
}

function matchesWhere(row: Row, where: Record<string, string> | undefined): boolean {
  return !where || Object.entries(where).every(([field, value]) => fieldEquals(row[field], value));
}

/** The first field in `expect` that does not match `row`, if any. */
function firstMismatch(row: Row, expect: Record<string, string | number | boolean>): string | undefined {
  for (const [field, expected] of Object.entries(expect)) {
    if (!fieldEquals(row[field], expected)) return `expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(row[field])}`;
  }
  return undefined;
}

function checkOne(rows: Row[], c: Check): CheckResult {
  const matched = rows.filter((r) => matchesWhere(r, c.where));
  if (matched.length === 0) {
    return { name: c.name, ok: false, note: `no row at ${c.app}${c.path}${c.where ? ` matching ${JSON.stringify(c.where)}` : ""}` };
  }
  if (c.count?.min !== undefined && matched.length < c.count.min) {
    return { name: c.name, ok: false, note: `expected at least ${c.count.min} matching rows, got ${matched.length}` };
  }
  if (c.count?.max !== undefined && matched.length > c.count.max) {
    return { name: c.name, ok: false, note: `expected at most ${c.count.max} matching rows, got ${matched.length}` };
  }
  const mismatches = matched.map((r) => firstMismatch(r, c.expect));
  if (mismatches.some((m) => m === undefined)) return { name: c.name, ok: true };
  return { name: c.name, ok: false, note: mismatches[0] };
}

/**
 * Checks the END STATE of a workspace app (an order shipped, a ticket
 * resolved) through that app's own REST API — the submitted artifact is
 * ignored entirely; the evidence is what actually happened in the app, read
 * live via the injected WorkspaceStateReader.
 */
export class StateOracle implements Oracle<Spec> {
  readonly kind = "state" as const;
  constructor(private readonly reader: WorkspaceStateReader) {}

  async check(_artifact: Buffer, spec: Spec, ctx: OracleContext): Promise<OracleResult> {
    const checks: CheckResult[] = [];
    for (const c of spec.checks) {
      try {
        const data = await this.reader.get(ctx.workspaceId, c.app, c.path);
        checks.push(checkOne(asRows(data), c));
      } catch (err) {
        checks.push({ name: c.name, ok: false, note: `${c.app}${c.path} unreachable: ${(err as Error).message}` });
      }
    }
    return { verdict: verdictOf(checks), checks };
  }
}
