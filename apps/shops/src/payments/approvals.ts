import { z } from "zod";

/**
 * What the shopper's wallet approved for a workspace's store — the amount a charge is held against when an
 * order is classified ("paid above approval", DESIGN §8.2). A port: the wallet stand-in answers over HTTP;
 * without one nothing was approved that the store can know of (null), and the class is decided without it.
 */
export interface ApprovalSource {
  /** The largest live approval for the workspace's store, null when there is none (or no wallet). */
  approvedCents(ws: string, store: string): Promise<number | null>;
}

/** No wallet: the approval is unknown, so no order is classed against it. */
export class NoApprovals implements ApprovalSource {
  async approvedCents(): Promise<number | null> {
    return null;
  }
}

const answer = z.object({ approvedCents: z.number().int().nullable() });

/** The wallet app's GET <walletUrl>/internal/approvals?workspace=&store=, with the wallet's internal secret. */
export class HttpApprovalSource implements ApprovalSource {
  constructor(
    private readonly walletUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  async approvedCents(ws: string, store: string): Promise<number | null> {
    const url = `${this.walletUrl.replace(/\/+$/, "")}/internal/approvals?${new URLSearchParams({ workspace: ws, store })}`;
    const res = await this.fetchImpl(url, { headers: { "x-benchme-internal-secret": this.secret }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`the wallet answered ${res.status}`);
    return answer.parse(await res.json()).approvedCents;
  }
}
