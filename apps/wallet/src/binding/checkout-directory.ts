import { z } from "zod";
import { CARD_KINDS } from "../domain/cards.js";
import type { CardKind } from "../domain/types.js";

/**
 * Where the wallet looks up the store checkouts a spend request may pay for. The stores own their checkouts,
 * their totals and their scenarios; the wallet only asks (a port, so tests and other deployments supply their own).
 */
export type CheckoutMatch = {
  workspace: string;
  store: string;
  /** The open checkout it matched, or null for a workspace's store with none open yet. */
  checkout: string | null;
  payableCents: number | null;
  scenarioId: string | null;
  /** The card the store's scenario calls for. */
  card: CardKind;
};

export interface CheckoutDirectory {
  /** The stores of `workspace` (only `store`, when given) a shopper has visited, each with its newest open checkout. */
  inWorkspace(workspace: string, store: string | null): Promise<CheckoutMatch[]>;
  /** The open checkouts (of `store`, when given) started in the last `withinMinutes` whose workspace has paid no order there, that would charge exactly `amountCents`. */
  byAmount(amountCents: number, store: string | null, withinMinutes: number): Promise<CheckoutMatch[]>;
}

/** No stores to ask: every request falls back (a wallet deployed without the stores, or the Field study). */
export class NoCheckoutDirectory implements CheckoutDirectory {
  async inWorkspace(): Promise<CheckoutMatch[]> {
    return [];
  }
  async byAmount(): Promise<CheckoutMatch[]> {
    return [];
  }
}

const matchSchema = z.object({
  workspace: z.string(),
  store: z.string(),
  checkout: z.string().nullable(),
  payableCents: z.number().int().nullable(),
  scenarioId: z.string().nullable(),
  card: z.enum(CARD_KINDS as [CardKind, ...CardKind[]]),
});
const answerSchema = z.object({ matches: z.array(matchSchema) });

/** All stores at once: the shops app answers for every store on its paylantern site, as its state API does. */
const ALL_STORES = "paylantern";

/**
 * The shops app's internal API: GET <shopsUrl>/s/<store|paylantern>/internal/wallet-matches?workspace=… or
 * ?amountCents=…&withinMinutes=…, with the shops' internal secret. An answer it cannot read is an error.
 */
export class HttpCheckoutDirectory implements CheckoutDirectory {
  constructor(
    private readonly shopsUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  inWorkspace(workspace: string, store: string | null): Promise<CheckoutMatch[]> {
    return this.ask(store, new URLSearchParams({ workspace }));
  }

  byAmount(amountCents: number, store: string | null, withinMinutes: number): Promise<CheckoutMatch[]> {
    return this.ask(store, new URLSearchParams({ amountCents: String(amountCents), withinMinutes: String(withinMinutes) }));
  }

  private async ask(store: string | null, query: URLSearchParams): Promise<CheckoutMatch[]> {
    const url = `${this.shopsUrl.replace(/\/+$/, "")}/s/${encodeURIComponent(store ?? ALL_STORES)}/internal/wallet-matches?${query}`;
    const res = await this.fetchImpl(url, { headers: { "x-benchme-internal-secret": this.secret }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`the stores answered ${res.status} to ${url.replace(/\?.*$/, "")}`);
    return answerSchema.parse(await res.json()).matches;
  }
}
