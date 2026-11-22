import { AuthError } from "./auth-service.js";
import { DomainError } from "./mcp-server.js";

/** What a site says when its rules refuse something: a reason code a caller can act on, the words, and the HTTP status. */
export type Refusal = { code: string; message: string; status: number };

/** The refusal an error carries, or null for anything that is not a rule saying no (a bug, a lost connection). */
export function refusalOf(err: unknown): Refusal | null {
  return err instanceof DomainError || err instanceof AuthError ? { code: err.code, message: err.message, status: err.status } : null;
}
