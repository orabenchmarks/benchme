const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.56" from integer cents. */
export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}

export function sumCents(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** cents × bp / 10 000, rounded half up (tax, discounts). */
export function applyBp(cents: number, bp: number): number {
  return Math.floor((cents * bp + 5000) / 10000);
}
