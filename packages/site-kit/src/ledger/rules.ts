import { READ_ACTION, type LedgerKind } from "./entry.js";

/**
 * How one method of a site's rules shows in the ledger. `id` names the entity
 * from the call's arguments (after the workspace) and, when the call returned,
 * its result: a create has no id until the row exists.
 */
export type Recorded<A extends unknown[], T> = {
  kind: LedgerKind;
  /** The entity's type, in the site's own word: "booking", "order", "showtime". */
  entity: string;
  action: string;
  id: (args: A, result: T | undefined) => string | null | undefined;
};
/** A method the ledger leaves out: a list, a search, a lookup of what is on offer. */
export type Unrecorded = { kind: "skip" };
export type LedgerRule<A extends unknown[], T> = Recorded<A, T> | Unrecorded;

/**
 * One rule for EVERY method of a site's rules, by name. The mapped type is the
 * point: a method added to a repository does not compile until someone says
 * whether it is a read, a write or neither, so none is left out by forgetting.
 */
export type LedgerRules<R> = {
  [K in keyof R]: R[K] extends (ws: string, ...args: infer A) => Promise<infer T> ? LedgerRule<A, T> : never;
};

export const unrecorded: Unrecorded = { kind: "skip" };

/** A read of one entity: a booking, an order, a showtime's seat map, a product. */
export function read<A extends unknown[], T>(entity: string, id: Recorded<A, T>["id"]): LedgerRule<A, T> {
  return { kind: "read", entity, action: READ_ACTION, id };
}

/** A change to the site's rows, made or refused. Only someone signed in may make one. */
export function write<A extends unknown[], T>(entity: string, action: string, id: Recorded<A, T>["id"]): LedgerRule<A, T> {
  return { kind: "write", entity, action, id };
}

/** A step of signing up or in. Recorded, and never counted as a change to what the site sells. */
export function authStep<A extends unknown[], T>(action: string, id: Recorded<A, T>["id"]): LedgerRule<A, T> {
  return { kind: "auth", entity: "account", action, id };
}
