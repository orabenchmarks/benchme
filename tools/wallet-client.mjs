/**
 * wallet-client — the wallet stand-in's HTTP API spoken directly, the way @stripe/link-cli speaks it (device
 * login, then spend requests), for tools that need a shopper's card without spawning the CLI per step
 * (tools/checkout-integrity.mjs --wallet). The CLI itself is proven against the same API by
 * tools/link-cli-contract.mjs.
 *
 *   const w = new WalletClient("http://localhost:8080/wallet");
 *   const a = await w.approve({ amountCents, merchantUrl, merchantName });   // { id, status, amountCents, card | null }
 */
const TIMEOUT_MS = 30_000;
const CONTEXT =
  "The shopper is buying the items in their cart at this store, exactly as they asked, and pays the total the checkout shows with a card from their wallet.";

export class WalletClient {
  constructor(walletUrl, { pollMs = 250, maxWaitMs = 30_000 } = {}) {
    this.url = walletUrl.replace(/\/+$/, "");
    this.pollMs = pollMs;
    this.maxWaitMs = maxWaitMs;
    this.token = null;
  }

  /** The device login (approved by the wallet's policy): an access token for this client. */
  async login() {
    if (this.token) return;
    const form = (fields) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const code = await (await fetch(`${this.url}/auth/device/code`, form({ client_id: "wallet-client", client_hint: "benchme tools" }))).json();
    const until = Date.now() + this.maxWaitMs;
    for (;;) {
      const res = await fetch(`${this.url}/auth/device/token`, form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code }));
      const j = await res.json();
      if (res.ok) {
        this.token = j.access_token;
        return;
      }
      if (j.error !== "authorization_pending" || Date.now() > until) throw new Error(`the wallet's login answered ${res.status} ${j.error ?? ""}`);
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  async api(method, path, body) {
    await this.login();
    const res = await fetch(`${this.url}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`the wallet answered ${res.status} to ${method} ${path}: ${j?.error?.message ?? JSON.stringify(j)}`);
    return j;
  }

  /**
   * A spend request for `amountCents` at the merchant, approval requested and waited for: the decision, and the
   * card when approved (number, cvc, exp_month, exp_year, billing_address).
   */
  async approve({ amountCents, merchantUrl, merchantName, context = CONTEXT }) {
    const created = await this.api("POST", "/spend_requests", { amount: amountCents, currency: "usd", merchant_name: merchantName, merchant_url: merchantUrl, context, request_approval: true });
    const until = Date.now() + this.maxWaitMs;
    let r = created;
    while (r.status === "pending_approval" || r.status === "created") {
      if (Date.now() > until) throw new Error(`spend request ${created.id} still ${r.status} after ${this.maxWaitMs} ms`);
      await new Promise((res) => setTimeout(res, this.pollMs));
      r = await this.api("GET", `/spend_requests/${created.id}`);
    }
    const card = r.status === "approved" ? (await this.api("GET", `/spend_requests/${created.id}?include=card`)).card : null;
    return { id: created.id, status: r.status, amountCents, card };
  }
}
