/** The shape a site's sign-up takes for an email address (site-kit's AuthService), so anything a site would mail a code to is recognised. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address as a site keys an account by it, and as the held set stores it: trimmed, lower-cased. */
export const normalizeAddress = (address: string): string => address.trim().toLowerCase();

/**
 * Every address a scenario's rows hold, normalised, each once, sorted. Generic on purpose: it walks the rows
 * (objects and arrays, at any depth) for strings shaped like an email address, whatever their field is called, so
 * the people of a site added later (its guests, organisers, patients) are held without an edit here. It reads whole
 * values only: a sentence that mentions an address is not one, and no row today carries one.
 */
export function heldAddressesOf(rows: unknown): string[] {
  const held = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: unknown[] = [rows];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      const address = normalizeAddress(value);
      if (EMAIL.test(address)) held.add(address);
    } else if (typeof value === "object" && value !== null && !seen.has(value)) {
      seen.add(value);
      for (const child of Object.values(value)) pending.push(child);
    }
  }
  return [...held].sort();
}
