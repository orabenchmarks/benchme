import { describe, expect, it } from "vitest";
import { HmacReceiptSigner, parseReceipt } from "./receipt.js";

const signer = new HmacReceiptSigner("a-secret-that-is-long-enough");

describe("HmacReceiptSigner", () => {
  it("round-trips a signed receipt", () => {
    const r = signer.sign("t-code-m-03", "OK", "nonce-1", 1_700_000_000);
    expect(r).toMatch(/^RCPT-t-code-m-03-OK-[0-9a-f]{12}$/);
    expect(signer.verify(r, "nonce-1", 1_700_000_000)).toBe(true);
  });
  it("rejects a flipped verdict, a different nonce, and a different secret", () => {
    const r = signer.sign("t-code-m-03", "FAIL", "n", 1);
    expect(signer.verify(r.replace("-FAIL-", "-OK-"), "n", 1)).toBe(false);
    expect(signer.verify(r, "other", 1)).toBe(false);
    expect(new HmacReceiptSigner("another-secret-that-is-long").verify(r, "n", 1)).toBe(false);
  });
  it("parses and refuses malformed receipts", () => {
    expect(parseReceipt("RCPT-x-OK-0123456789ab")).toEqual({ scope: "x", verdict: "OK", hex: "0123456789ab" });
    expect(parseReceipt("RCPT-x-MAYBE-0123456789ab")).toBeNull();
    expect(signer.verify("garbage", "n", 1)).toBe(false);
  });
  it("refuses a short secret", () => {
    expect(() => new HmacReceiptSigner("short")).toThrow();
  });
});
