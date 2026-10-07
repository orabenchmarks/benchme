import { createHmac } from "node:crypto";
import { OUTCOME_CLASSES, type OutcomeClass } from "./outcome.js";

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

function two(key: string, msg: string): string {
  const d = createHmac("sha256", key).update(msg).digest();
  return (B32[d[0]! % 32] as string) + (B32[d[1]! % 32] as string);
}

/**
 * One distinct two-character suffix per outcome class of a scenario, keyed by a
 * deployment secret: an order number reveals its class only to whoever holds the key.
 * A collision re-salts the later class.
 */
export function suffixTable(key: string, scenarioId: string): Record<OutcomeClass, string> {
  const used = new Set<string>();
  const out = {} as Record<OutcomeClass, string>;
  for (const c of OUTCOME_CLASSES) {
    let salt = 0;
    let s = two(key, `${scenarioId}|${c}|${salt}`);
    while (used.has(s)) s = two(key, `${scenarioId}|${c}|${++salt}`);
    used.add(s);
    out[c] = s;
  }
  return out;
}

/** "QF-534621-K7": store prefix, six digits, outcome suffix. */
export function newOrderNumber(prefix: string, suffix: string, rand: () => number = Math.random): string {
  const digits = String(Math.floor(rand() * 900000) + 100000).slice(0, 6);
  return `${prefix}-${digits}-${suffix}`;
}

export function parseOrderNumber(s: string): { prefix: string; digits: string; suffix: string } | null {
  const m = /^([A-Z]{2})-(\d{6})-([0-9A-Z]{2})$/.exec(s);
  return m ? { prefix: m[1] as string, digits: m[2] as string, suffix: m[3] as string } : null;
}
