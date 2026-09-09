import type { Mailer } from "./auth-service.js";

/** Delivers to the mail app's internal endpoint, authenticated by the shared internal secret. */
export class HttpMailer implements Mailer {
  constructor(
    private readonly mailUrl: string,
    private readonly secret: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(ws: string, msg: { to: string; subject: string; body: string }): Promise<void> {
    const res = await this.fetchImpl(`${this.mailUrl.replace(/\/+$/, "")}/internal/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-benchme-internal-secret": this.secret },
      body: JSON.stringify({ workspaceId: ws, from: this.from, ...msg }),
    });
    if (!res.ok) throw new Error(`mail delivery failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
