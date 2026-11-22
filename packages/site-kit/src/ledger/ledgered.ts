import type { Transactions } from "@benchme/core";
import type { CallerScope } from "../doors/caller.js";
import { DomainError } from "../domain-error.js";
import { SIGN_IN_REQUIRED_CODE, SignInRequired } from "../doors/sign-in.js";
import { refusalOf } from "../refusal.js";
import { NOT_FOUND_CODE, type NewLedgerEntry } from "./entry.js";
import type { Ledger } from "./ledger.js";
import type { LedgerRule, LedgerRules, Recorded } from "./rules.js";

export type LedgeredDeps = {
  ledger: Ledger;
  callers: CallerScope;
  /** Where a write and its entry are made one transaction: the site's `transactions(pool)`, whose pool its repositories use. */
  transactions: Pick<Transactions, "run">;
};

/** For a site whose rows are not in Postgres (tests): each write runs as it comes, with nothing to make atomic. */
export const untransacted: Pick<Transactions, "run"> = { run: (fn) => fn() };

type AnyRule = LedgerRule<unknown[], unknown>;
type AnyMethod = (ws: string, ...args: unknown[]) => Promise<unknown>;

/**
 * A site's rules with the ledger kept. Pages, REST and the MCP tools (and,
 * through the bridge, the WebMCP tools) all reach a site's rows through one
 * repository, so recording there records every door, and no route or tool can
 * leave it out. The wrapped object is the repository's own type: every caller
 * keeps calling what it called.
 *
 * Each recorded method notes who called (the door and whoever is signed in,
 * from the request's caller scope), then what came of it: `ok`, or `refused`
 * with the rule's reason code. A read that found nothing is refused with
 * NOT_FOUND. The verifier's own reads pass through unrecorded. A call with no
 * caller in scope is a door that never said which one it is, and it throws.
 *
 * It is also where a write asks for a sign-in, for the same reason: asked
 * here, every door asks the same, and a new door cannot forget to. A write by
 * nobody is recorded as refused with the one sign-in code and never reaches
 * the repository; the door it came through says so in its own way.
 *
 * A write (or a step of signing up or in) and its entry are one transaction:
 * both are kept, or neither is, so the ledger never shows a change that did
 * not happen, nor misses one that did. A refused write changed nothing: its
 * transaction is rolled back and the refusal is kept on its own.
 */
export function ledgered<R extends object>(repo: R, rules: LedgerRules<R>, d: LedgeredDeps): R {
  const ruleOf = (name: PropertyKey): AnyRule | undefined => (Object.hasOwn(rules, name) ? (rules as Record<PropertyKey, AnyRule>)[name] : undefined);
  return new Proxy(repo, {
    get(target, name) {
      const member: unknown = Reflect.get(target, name, target);
      // What every object has (toString, constructor …) is no method of the site's rules.
      if (typeof member !== "function" || typeof name === "symbol" || name in Object.prototype) return member;
      const method = member as AnyMethod;
      const rule = ruleOf(name);
      if (!rule) {
        return () => {
          throw new Error(`${String(name)} has no ledger rule: say whether it is a read, a write or unrecorded`);
        };
      }
      if (rule.kind === "skip") return method.bind(target);
      return (ws: string, ...args: unknown[]) => recorded(target, method, String(name), rule, d, ws, args);
    },
  });
}

async function recorded(target: object, method: AnyMethod, name: string, rule: Recorded<unknown[], unknown>, d: LedgeredDeps, ws: string, args: unknown[]): Promise<unknown> {
  const caller = d.callers.current();
  if (!caller) throw new Error(`${name} was called outside a door: no caller is in scope`);
  if (caller.observer) {
    if (rule.kind !== "read") throw new DomainError("READ_ONLY", "the verifier only reads", 403);
    return method.call(target, ws, ...args);
  }
  const subjectId = rule.subject?.id(args) ?? null;
  const entry: EntryOf = (result, outcome, code, actor) => ({
    kind: rule.kind,
    entity: { type: rule.entity, id: rule.id(args, result) ?? null },
    subject: rule.subject && subjectId ? { type: rule.subject.type, id: subjectId } : null,
    action: rule.action,
    door: caller.door,
    actor,
    outcome,
    code,
  });
  const actor = await caller.actor();
  if (rule.kind === "write" && actor === null) {
    await d.ledger.record(ws, entry(undefined, "refused", SIGN_IN_REQUIRED_CODE, null));
    throw new SignInRequired(caller.door);
  }
  if (rule.kind === "read") return recordedRead(target, method, d, ws, args, entry, actor);
  try {
    return await d.transactions.run(async () => {
      const result = await method.call(target, ws, ...args);
      await d.ledger.record(ws, entry(result, "ok", null, actor));
      return result;
    });
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal) await d.ledger.record(ws, entry(undefined, "refused", refusal.code, actor));
    throw err;
  }
}

type EntryOf = (result: unknown, outcome: NewLedgerEntry["outcome"], code: string | null, actor: string | null) => NewLedgerEntry;

/** A read changes nothing, so it needs no transaction: what it found, or why it found nothing, is kept after it. */
async function recordedRead(target: object, method: AnyMethod, d: LedgeredDeps, ws: string, args: unknown[], entry: EntryOf, actor: string | null): Promise<unknown> {
  let result: unknown;
  try {
    result = await method.call(target, ws, ...args);
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal) await d.ledger.record(ws, entry(undefined, "refused", refusal.code, actor));
    throw err;
  }
  const missing = result === null || result === undefined;
  await d.ledger.record(ws, missing ? entry(undefined, "refused", NOT_FOUND_CODE, actor) : entry(result, "ok", null, actor));
  return result;
}
