import type { Binding } from "../domain/types.js";
import type { CheckoutDirectory, CheckoutMatch } from "./checkout-directory.js";
import { parseMerchant, type MerchantRef } from "./merchant.js";

/** What a rule reads off a spend request. */
export type BindInput = { amount: number; merchantUrl: string | null; merchantName: string | null };

/**
 * One way to find the checkout a request pays for. `candidates` answers null when the rule does not apply
 * to this request (no workspace path to go by), else the checkouts it found.
 */
export interface BindingRule {
  readonly name: "workspace" | "session" | "amount";
  candidates(input: BindInput, ref: MerchantRef): Promise<CheckoutMatch[] | null>;
}

/** Rule 1 (DESIGN §6.3): the workspace id, when merchant_url carries a store's workspace path. */
export class WorkspacePathRule implements BindingRule {
  readonly name = "workspace" as const;
  constructor(private readonly dir: CheckoutDirectory) {}
  async candidates(_input: BindInput, ref: MerchantRef): Promise<CheckoutMatch[] | null> {
    return ref.workspace ? this.dir.inWorkspace(ref.workspace, ref.store) : null;
  }
}

/**
 * Rule 1b: the Checkout Session of Stripe's hosted payment page, when merchant_url is that page
 * (checkout.stripe.com/c/pay/cs_test_…): the store that created the session names its workspace and checkout.
 * Halden pays there, so an agent that names the page it pays on is bound as surely as by a workspace path.
 */
export class HostedSessionRule implements BindingRule {
  readonly name = "session" as const;
  constructor(private readonly dir: CheckoutDirectory) {}
  async candidates(_input: BindInput, ref: MerchantRef): Promise<CheckoutMatch[] | null> {
    return ref.session ? this.dir.bySession(ref.session) : null;
  }
}

/** Rule 2: the exact amount, among the store's open checkouts of the last `withinMinutes` with no paid order. */
export class ExactAmountRule implements BindingRule {
  readonly name = "amount" as const;
  constructor(
    private readonly dir: CheckoutDirectory,
    private readonly withinMinutes = 60,
  ) {}
  async candidates(input: BindInput, ref: MerchantRef): Promise<CheckoutMatch[] | null> {
    return this.dir.byAmount(input.amount, ref.store, this.withinMinutes);
  }
}

/**
 * Binds a spend request to the run it belongs to: the rules in order, the first that yields exactly one
 * checkout wins; none does → the fallback (the plain success card, flagged `binding_fallback` in the records).
 * A rule that cannot ask the stores counts as finding nothing, and the reason says so.
 */
export class Binder {
  constructor(
    private readonly rules: readonly BindingRule[],
    private readonly stores: readonly string[],
  ) {}

  async bind(input: BindInput): Promise<Binding> {
    const ref = parseMerchant(input.merchantUrl, input.merchantName, this.stores);
    const notes: string[] = [];
    for (const rule of this.rules) {
      let found: CheckoutMatch[] | null;
      try {
        found = await rule.candidates(input, ref);
      } catch (err) {
        notes.push(`${rule.name}: ${(err as Error).message}`);
        continue;
      }
      if (found === null) continue;
      if (found.length === 1) {
        const m = found[0] as CheckoutMatch;
        return { rule: rule.name, workspace: m.workspace, store: m.store, checkout: m.checkout, scenarioId: m.scenarioId, card: m.card };
      }
      notes.push(`${rule.name}: ${found.length} checkouts`);
    }
    return { rule: "fallback", reason: notes.join("; ") || "no rule applied" };
  }

  merchant(input: Pick<BindInput, "merchantUrl" | "merchantName">): MerchantRef {
    return parseMerchant(input.merchantUrl, input.merchantName, this.stores);
  }
}
