import { AsyncLocalStorage } from "node:async_hooks";
import type { Door } from "./door.js";
import type { SessionCarrier } from "./session-carrier.js";

/** Who is asking, for the length of one request. */
export type Caller = {
  readonly door: Door;
  /** The verifier reading state after the fact: it is shown the rows, and no ledger records that it looked. */
  readonly observer: boolean;
  /** The email of whoever is signed in on this request, or null for nobody. Resolved once, when first asked. */
  actor(): Promise<string | null>;
  /** How a sign-in made on this request stays with the caller. */
  readonly session: SessionCarrier;
};

/**
 * Carries a request's caller to whatever the request reaches, without every
 * route, tool and repository method passing it along: a door enters the scope
 * once, and the one place every door shares (the site's rules) reads it.
 * One instance per app.
 */
export class CallerScope {
  private readonly store = new AsyncLocalStorage<Caller>();

  run<T>(caller: Caller, fn: () => T): T {
    return this.store.run(caller, fn);
  }

  current(): Caller | undefined {
    return this.store.getStore();
  }
}

/** Resolves once and remembers the answer, so a request that asks who is signed in ten times looks it up once. */
export function once<T>(resolve: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => (answer ??= resolve());
}
