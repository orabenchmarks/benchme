/**
 * Where the suite runs and what it reads, from the environment (tools/shops-e2e/README.md lists every variable).
 */
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** tools/shops-e2e */
export const E2E_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The benchme checkout this suite lives in: its built packages give the catalogues and the expected suffixes. */
export const BENCHME_DIR = resolve(E2E_DIR, "..", "..");
/** Screenshots, the HTML report and Playwright's own output: OUT_DIR, else <tmp>/shops-e2e — never inside the repository. */
export const OUT_DIR = resolve(process.env.OUT_DIR?.trim() || join(tmpdir(), "shops-e2e"));

export type RunKind = "reference" | "wrong";

/**
 * How a test enters its store. "prompt" (the default) is exactly what every task's prompt tells an agent to
 * do: urls.apps.<store> with ?utm_campaign=<code> appended. "slash" puts a "/" before the "?" — the root
 * page itself, with no gateway redirect on the way.
 */
export type EntryStyle = "prompt" | "slash";

export type Env = {
  /** The benchme-hidden checkout: its shops/<ID>/ directories are the tasks. */
  hiddenDir: string;
  /** The gateway, e.g. http://localhost:18190. */
  baseUrl: string;
  /** The gateway's operator key (minting is not rate-limited with it). */
  operatorKey: string;
  /** The stores' SHOPS_SUFFIX_KEY: the expected order-number suffixes are computed from it. */
  suffixKey: string;
  /** ONLY=<ID>,<ID>: just these tasks (directory names under shops/). */
  only: string[] | null;
  /** RUN=wrong replays each task's wrong.json (the mistake it exists to catch) instead of reference.json. */
  run: RunKind;
  entry: EntryStyle;
  /**
   * STRIPE=1: the stack pays with Stripe test keys (dev-stack --payments stripe), so the card fields are Stripe's
   * Payment Element and the hosted surface is checkout.stripe.com; otherwise the stack's fake payments.
   */
  stripe: boolean;
};

const REQUIRED = ["HIDDEN_DIR", "BASE_URL", "OPERATOR_KEY", "SUFFIX_KEY"] as const;

/** STRIPE's value as on or off: 1/true on, 0/false/empty/unset off; anything else is refused. */
export function stripeOf(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true") return true;
  if (s === "" || s === "0" || s === "false") return false;
  throw new Error(`STRIPE must be 1 or 0 (on: the stack pays with Stripe test keys), not ${JSON.stringify(v)}`);
}

/** STRIPE=1, read once for the Playwright config (its timeouts); readEnv refuses a value that is neither. */
export const STRIPE = (() => {
  try {
    return stripeOf(process.env.STRIPE);
  } catch {
    return false;
  }
})();

/**
 * Playwright's trace setting. A trace records every page's DOM, scripts and requests, and with STRIPE=1 Stripe's frames
 * and requests carry the publishable key: those runs keep none. Fake mode keeps a failed test's (results/).
 */
export function traceFor(stripe: boolean): "off" | "retain-on-failure" {
  return stripe ? "off" : "retain-on-failure";
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED.filter((k) => !e[k]?.trim());
  if (missing.length) throw new Error(`shops-e2e needs ${missing.join(", ")} in the environment (see tools/shops-e2e/README.md)`);
  const run = (e.RUN?.trim() || "reference") as RunKind;
  if (run !== "reference" && run !== "wrong") throw new Error(`RUN must be "reference" or "wrong", not ${JSON.stringify(e.RUN)}`);
  const entry = (e.ENTRY?.trim() || "prompt") as EntryStyle;
  if (entry !== "prompt" && entry !== "slash") throw new Error(`ENTRY must be "prompt" or "slash", not ${JSON.stringify(e.ENTRY)}`);
  const suffixKey = (e.SUFFIX_KEY as string).trim();
  if (suffixKey.length < 16) throw new Error("SUFFIX_KEY must be the stores' SHOPS_SUFFIX_KEY (16 characters or more)");
  const only = e.ONLY?.trim()
    ? e.ONLY.split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
  return {
    hiddenDir: resolve((e.HIDDEN_DIR as string).trim()),
    baseUrl: (e.BASE_URL as string).trim().replace(/\/+$/, ""),
    operatorKey: (e.OPERATOR_KEY as string).trim(),
    suffixKey,
    only,
    run,
    entry,
    stripe: stripeOf(e.STRIPE),
  };
}
