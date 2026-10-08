/**
 * The ZIP a run types into the card form's ZIP (fake mode) or Stripe's postal code (STRIPE=1): the card's billing ZIP.
 * The Link wallet's card carries its own billing address, so it is never the delivery address's ZIP — a florist
 * delivers to someone else, and a buyer's card need not be billed where the parcel goes.
 */

import type { PayStep } from "./hidden.js";

/** A pay step's billing ZIP when it names none: it stands for the billing ZIP the Link card carries. */
export const DEFAULT_BILLING_ZIP = "94107";

/** The ZIP a pay step's card is billed to: its billingZip (`{ "pay": { "card", "billingZip" } }`), else DEFAULT_BILLING_ZIP. */
export function billingZipOf(pay: PayStep): string {
  return pay.billingZip?.trim() || DEFAULT_BILLING_ZIP;
}
