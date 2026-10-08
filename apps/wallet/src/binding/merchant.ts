/**
 * What a spend request's merchant fields say about where it pays: the merchant URL's origin, the workspace
 * and app of a benchme path (/w/<workspaceId>/<app>/…; without a workspace, the app is the path's first
 * segment), which store it names — by that app, by a store id anywhere in the path, or by the merchant name
 * ("Halden Audio" names halden) — and the Stripe Checkout Session of a hosted payment page
 * (checkout.stripe.com/c/pay/cs_test_…). An agent may write the URL without its scheme; it is read as https.
 */
export type MerchantRef = {
  origin: string | null;
  workspace: string | null;
  app: string | null;
  store: string | null;
  /** A Checkout Session id in the URL's path (case kept: Stripe's ids are case-sensitive), or null. */
  session: string | null;
};

const WORKSPACE_ID = /^ws_[0-9a-f]{12}$/;
/** A Checkout Session id as Stripe mints it (cs_test_…, cs_live_…) and as the stores' fake processor does (cs_fake_…). */
const SESSION_ID = /^cs_[a-z]+_[A-Za-z0-9]+$/;

function parseUrl(raw: string | null): URL | null {
  if (!raw) return null;
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const u = new URL(candidate);
      if (u.protocol === "http:" || u.protocol === "https:") return u;
    } catch {
      // try the next reading
    }
  }
  return null;
}

/** `stores`: the store ids a request may name (lowercase). */
export function parseMerchant(merchantUrl: string | null, merchantName: string | null, stores: readonly string[]): MerchantRef {
  const url = parseUrl(merchantUrl?.trim() ?? null);
  const raw = url ? url.pathname.split("/").filter(Boolean).map(decodeURIComponentSafe) : [];
  const segments = raw.map((s) => s.toLowerCase());
  let workspace: string | null = null;
  let app: string | null = null;
  if (segments[0] === "w") {
    // A workspace path names its app third, even when the id between is mistyped.
    if (WORKSPACE_ID.test(segments[1] ?? "")) workspace = segments[1] as string;
    app = segments[2] ?? null;
  } else {
    const at = segments.indexOf("w");
    if (at >= 0 && WORKSPACE_ID.test(segments[at + 1] ?? "")) {
      workspace = segments[at + 1] as string;
      app = segments[at + 2] ?? null;
    } else {
      app = segments[0] ?? null;
    }
  }
  const named = (text: string) => stores.find((s) => new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`).test(text)) ?? null;
  const store =
    (app && stores.includes(app) ? app : null) ??
    segments.find((s) => stores.includes(s)) ??
    (url ? named(url.hostname.toLowerCase()) : null) ??
    (merchantName ? named(merchantName.toLowerCase()) : null);
  const session = raw.find((s) => SESSION_ID.test(s)) ?? null;
  return { origin: url ? url.origin : null, workspace, app, store, session };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
