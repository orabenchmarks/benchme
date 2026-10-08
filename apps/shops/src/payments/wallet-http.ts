/**
 * The wallet stand-in's internal API as the stores call it (apps/wallet routes/internal.ts), behind the wallet's
 * internal secret: one request, tried again on a transient failure (`attempts` in all) — never after a refusal (4xx),
 * which asking again does not change. The last failure is thrown.
 */
export class WalletHttp {
  constructor(
    private readonly walletUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
    private readonly attempts = 3,
  ) {}

  async call(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<unknown> {
    const url = `${this.walletUrl.replace(/\/+$/, "")}${path}`;
    const headers: Record<string, string> = { "x-benchme-internal-secret": this.secret };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    let last: Error = new Error("the wallet was not asked");
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: init.method ?? "GET",
          headers,
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return await res.json();
        last = new Error(`the wallet answered ${res.status}`);
        if (res.status < 500) break; // refused, not failing: asking again changes nothing
      } catch (err) {
        last = err as Error;
      }
    }
    throw last;
  }
}
