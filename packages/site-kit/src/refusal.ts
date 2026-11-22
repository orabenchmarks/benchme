import { AuthError } from "./auth-service.js";
import { DomainError } from "./domain-error.js";
import { SignInRequired } from "./doors/sign-in.js";

/** What a site says when it refuses something: a reason code a caller can act on, the words, and the HTTP status. */
export type Refusal = { code: string; message: string; status: number };

/** The refusal an error carries, or null for anything that is not the site saying no (a bug, a lost connection). */
export function refusalOf(err: unknown): Refusal | null {
  return err instanceof DomainError || err instanceof AuthError || err instanceof SignInRequired ? { code: err.code, message: err.message, status: err.status } : null;
}
