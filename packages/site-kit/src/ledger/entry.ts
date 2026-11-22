import { z } from "zod";
import { DOORS } from "../doors/door.js";

/**
 * What an entry records: a `read` of one entity, a `write` (a change to the
 * site's rows, made or refused), or an `auth` step (an account signed up,
 * verified, signed in). Only a `write` is a change to what the site sells.
 */
export const LEDGER_KINDS = ["read", "write", "auth"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_OUTCOMES = ["ok", "refused"] as const;
export type LedgerOutcome = (typeof LEDGER_OUTCOMES)[number];

/** The action of every `read` entry. A write's action is the site's own verb (create, cancel, change …). */
export const READ_ACTION = "read";
/** The code of a read that found nothing. */
export const NOT_FOUND_CODE = "NOT_FOUND";

/** One line of a site's change ledger, as the verifier reads it. */
export const ledgerEntrySchema = z.object({
  /** Order within one app's ledger. */
  seq: z.number().int().positive(),
  /** When it happened, by the database's clock (ISO 8601, UTC). */
  at: z.string().datetime(),
  app: z.string().min(1),
  kind: z.enum(LEDGER_KINDS),
  /** `id` is null when there is no entity yet: a create the rules refused. */
  entity: z.object({ type: z.string().min(1), id: z.string().nullable() }),
  action: z.string().min(1),
  door: z.enum(DOORS),
  /** The email signed in on the request, or null for nobody. */
  actor: z.string().nullable(),
  outcome: z.enum(LEDGER_OUTCOMES),
  /** The site's reason code when refused, else null. */
  code: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** What a site hands the ledger; the ledger adds the order, the time and the app. */
export type NewLedgerEntry = Omit<LedgerEntry, "seq" | "at" | "app">;

/** A page of entries, in the envelope the sites' list routes use. */
export const ledgerPageSchema = z.object({ items: z.array(ledgerEntrySchema), nextCursor: z.string().nullable() });
export type LedgerPage = z.infer<typeof ledgerPageSchema>;
