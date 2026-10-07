/**
 * What the buyer's card statement calls a store: Stripe's statement_descriptor_suffix, which Stripe joins to the
 * account's prefix ("STRIPE* HALDEN AUDIO" in test mode). The statement alone: Stripe's 3-D Secure page names the
 * Stripe account the payment is made to, not the store.
 * Stripe takes 22 characters for the whole: the store's name is kept to MAX_DESCRIPTOR_LENGTH, so a prefix of up
 * to eight characters (the account's "ORA.AI", test mode's "STRIPE") and the "* " between still fit.
 */
export const MAX_DESCRIPTOR_LENGTH = 12;

/** Characters Stripe refuses in a statement descriptor. */
const REFUSED = /[<>\\'"*]/g;

/**
 * A store's brand name as its statement descriptor: upper case, Latin letters only (accents dropped), without the
 * characters Stripe refuses; trailing words dropped while it is too long ("Wrenfield Flowers" → "WRENFIELD"), a
 * single long word cut. It always holds a letter, as Stripe requires ("SHOP" stands in for a name with none).
 */
export function statementDescriptor(brandName: string): string {
  const words = brandName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(REFUSED, "")
    .replace(/[^A-Z0-9&.,\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && words.join(" ").length > MAX_DESCRIPTOR_LENGTH) words.pop();
  let name = words.join(" ").slice(0, MAX_DESCRIPTOR_LENGTH).replace(/[^A-Z0-9]+$/, "");
  if (!/[A-Z]/.test(name)) name = `SHOP ${name}`.trim().slice(0, MAX_DESCRIPTOR_LENGTH);
  return name;
}
