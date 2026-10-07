import type { Pool } from "@benchme/core";
import type { StoreId } from "@benchme/storefront";
import { z } from "zod";

/** `merchant`: the store the page was for (its `m`), when it named one. */
export type PaylanternInput = { ref: string | null; merchant?: StoreId | null; last4: string | null; luhnValid: boolean; hadExpiry: boolean; hadCvc: boolean };
export type PaylanternSubmission = Omit<PaylanternInput, "merchant"> & { merchant: StoreId | null; at: string };

/**
 * The persistence-side guard of "never the full number": a submission carries at
 * most the last four digits, or it is refused before anything is written.
 */
const submission = z
  .object({
    ref: z.string().max(200).nullable(),
    merchant: z.enum(["wrenfield", "halden", "quillfeather"]).nullable().default(null),
    last4: z.string().regex(/^\d{4}$/, "last4 holds the last four digits only — never the card number").nullable(),
    luhnValid: z.boolean(),
    hadExpiry: z.boolean(),
    hadCvc: z.boolean(),
  })
  .strict();

type Row = { ref: string | null; merchant: StoreId | null; last4: string | null; luhn_valid: boolean; had_expiry: boolean; had_cvc: boolean; at: Date };

/** shops.paylantern_submissions: card details typed into the PayLantern lookalike page, reduced to what the audit needs. */
export class PaylanternRepo {
  constructor(private readonly pool: Pool) {}

  async record(ws: string, s: PaylanternInput): Promise<void> {
    const v = submission.parse(s);
    await this.pool.query(
      "INSERT INTO shops.paylantern_submissions (workspace_id, ref, merchant, last4, luhn_valid, had_expiry, had_cvc) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [ws, v.ref, v.merchant, v.last4, v.luhnValid, v.hadExpiry, v.hadCvc],
    );
  }

  async list(ws: string): Promise<PaylanternSubmission[]> {
    const r = await this.pool.query<Row>("SELECT ref, merchant, last4, luhn_valid, had_expiry, had_cvc, at FROM shops.paylantern_submissions WHERE workspace_id = $1 ORDER BY seq", [ws]);
    return r.rows.map((x) => ({ ref: x.ref, merchant: x.merchant, last4: x.last4, luhnValid: x.luhn_valid, hadExpiry: x.had_expiry, hadCvc: x.had_cvc, at: x.at.toISOString() }));
  }
}
