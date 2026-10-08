/**
 * WALLET=1: the shopper's card comes from the stack's wallet stand-in through the REAL @stripe/link-cli — the
 * same unmodified CLI an agent is given — pointed at <base>/wallet/api and <base>/wallet/auth. One CLI login per
 * test (its own credential file in a temporary directory), one spend request per approval, the card read through
 * `--output-file` so no card number reaches stdout or the test log.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LINK_CLI_VERSION = "0.26.0";

/** A card as the card form takes it. */
export type WalletCard = { number: string; expiry: string; cvc: string; brand: string; billingPostalCode: string | null };
export type Approval = { id: string; amountCents: number; card: WalletCard };

type CliCard = { number: string; cvc: string; exp_month: number; exp_year: number; brand: string; billing_address?: { postal_code?: string } };

const CONTEXT =
  "Buying the items in my cart at this store exactly as I asked, paying the total the checkout shows; please approve this one-time card for the purchase.";

export class LinkWallet {
  private readonly home = mkdtempSync(join(tmpdir(), "shops-e2e-link-"));
  private loggedIn = false;
  private requests = 0;
  /** The approval the shopper holds: the last one granted. */
  held: Approval | null = null;

  private readonly o: { walletUrl: string; cli: string[]; log: (line: string) => void };

  constructor(o: { walletUrl: string; cli: string[]; log: (line: string) => void }) {
    this.o = o;
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      LINK_API_BASE_URL: `${this.o.walletUrl}/api`,
      LINK_AUTH_BASE_URL: `${this.o.walletUrl}/auth`,
      LINK_AUTH_FILE: join(this.home, "auth.json"),
      LINK_CLI_SKIP_SKILL_INSTALL: "1",
      NO_UPDATE_NOTIFIER: "1",
    };
  }

  /** One CLI command with --format json: its last JSON value (a polling command streams several). */
  private run(args: string[]): Promise<Record<string, unknown>> {
    const [cmd, ...pre] = this.o.cli;
    return new Promise((resolve, reject) => {
      const p = spawn(cmd as string, [...pre, ...args, "--format", "json"], { env: this.env(), stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        if (code !== 0) return reject(new Error(`link-cli ${args.slice(0, 2).join(" ")} exited ${code}: ${(out + err).trim().slice(0, 400)}`));
        try {
          const j = JSON.parse(out) as unknown;
          resolve((Array.isArray(j) ? j[j.length - 1] : j) as Record<string, unknown>);
        } catch {
          reject(new Error(`link-cli ${args.slice(0, 2).join(" ")} printed no JSON: ${out.slice(0, 200)}`));
        }
      });
    });
  }

  async login(): Promise<void> {
    if (this.loggedIn) return;
    await this.run(["auth", "login", "--client-name", "shops-e2e"]);
    const s = await this.run(["auth", "status", "--interval", "1", "--max-attempts", "30"]);
    if (s.authenticated !== true) throw new Error("link-cli: the wallet never approved the device login");
    this.loggedIn = true;
    this.o.log("link-cli: logged in to the wallet");
  }

  /** A spend request for `amountCents`, approved (or the test fails), and its card. */
  async approve(amountCents: number, merchantUrl: string, merchantName: string): Promise<Approval> {
    await this.login();
    const created = await this.run(["spend-request", "create", "--merchant-name", merchantName, "--merchant-url", merchantUrl, "--context", CONTEXT, "--amount", String(amountCents)]);
    const id = String(created.id);
    const decided = await this.run(["spend-request", "retrieve", id, "--interval", "1", "--max-attempts", "60"]);
    if (decided.status !== "approved") throw new Error(`link-cli: spend request ${id} for ${amountCents} cents ended ${String(decided.status)}`);
    const file = join(this.home, `card-${++this.requests}.json`);
    await this.run(["spend-request", "retrieve", id, "--include", "card", "--output-file", file]);
    const c = (JSON.parse(readFileSync(file, "utf8")) as { card: CliCard }).card;
    rmSync(file);
    const card: WalletCard = {
      number: c.number,
      expiry: `${String(c.exp_month).padStart(2, "0")}/${String(c.exp_year).slice(-2)}`,
      cvc: c.cvc,
      brand: c.brand,
      billingPostalCode: c.billing_address?.postal_code ?? null,
    };
    this.held = { id, amountCents, card };
    this.o.log(`link-cli: ${id} approved for ${(amountCents / 100).toFixed(2)} USD — a ${c.brand} card ending ${c.number.slice(-4)}`);
    return this.held;
  }

  close(): void {
    rmSync(this.home, { recursive: true, force: true });
  }
}
