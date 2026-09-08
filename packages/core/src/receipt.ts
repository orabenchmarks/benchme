import { createHmac, timingSafeEqual } from "node:crypto";

export type Verdict = "OK" | "FAIL";

/**
 * A receipt is the only thing an agent can quote to prove an oracle accepted its
 * work: RCPT-<scope>-<verdict>-<12 hex>. The hex is an HMAC over everything the
 * verifier stored (scope, verdict, nonce, timestamp), so a receipt can only be
 * produced by the verifier and is checked offline against its log.
 */
export interface ReceiptSigner {
  sign(scope: string, verdict: Verdict, nonce: string, ts: number): string;
  verify(receipt: string, nonce: string, ts: number): boolean;
}

const RECEIPT = /^RCPT-(.+)-(OK|FAIL)-([0-9a-f]{12})$/;

export function parseReceipt(receipt: string): { scope: string; verdict: Verdict; hex: string } | null {
  const m = RECEIPT.exec(receipt);
  if (!m) return null;
  return { scope: m[1] as string, verdict: m[2] as Verdict, hex: m[3] as string };
}

export class HmacReceiptSigner implements ReceiptSigner {
  constructor(private readonly secret: string) {
    if (secret.length < 16) throw new Error("receipt secret must be at least 16 characters");
  }

  private digest(scope: string, verdict: Verdict, nonce: string, ts: number): string {
    return createHmac("sha256", this.secret)
      .update(`${scope} ${verdict} ${nonce} ${ts}`)
      .digest("hex")
      .slice(0, 12);
  }

  sign(scope: string, verdict: Verdict, nonce: string, ts: number): string {
    if (scope.includes("-OK-") || scope.includes("-FAIL-")) {
      throw new Error("scope must not embed a verdict marker");
    }
    return `RCPT-${scope}-${verdict}-${this.digest(scope, verdict, nonce, ts)}`;
  }

  verify(receipt: string, nonce: string, ts: number): boolean {
    const parsed = parseReceipt(receipt);
    if (!parsed) return false;
    const expected = Buffer.from(this.digest(parsed.scope, parsed.verdict, nonce, ts));
    const given = Buffer.from(parsed.hex);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
