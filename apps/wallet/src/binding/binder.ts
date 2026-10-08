import type { Binding, CardKind } from "../domain/types.js";
import type { CheckoutDirectory, CheckoutMatch } from "./checkout-directory.js";
import { parseMerchant, type MerchantRef } from "./merchant.js";

/** What a rule reads off a spend request: its amount and merchant fields, and the link-cli login that made it (null: none known). */
export type BindInput = { amount: number; merchantUrl: string | null; merchantName: string | null; sessionId?: string | null };

/**
 * One way to find the checkout a request pays for. `candidates` answers null when the rule does not apply
 * to this request (no workspace path to go by), else the checkouts it found.
 */
export interface BindingRule {
  readonly name: "workspace" | "session" | "login" | "amount";
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

/** Where a login's approved requests were bound by what they named: the workspace and store of its latest such request, or null. */
export interface LoginBindings {
  boundOf(sessionId: string): Promise<{ workspace: string; store: string } | null>;
}

/**
 * Rule 1c: the workspace another request of the same link-cli login was bound to by what it named (a workspace path, a
 * hosted page's Checkout Session, a unique amount — never a payment's claim): a login is one run's, so a later request
 * that names only the stores' origin binds as surely as the first — at the store it names, else the one bound before.
 */
export class LoginSessionRule implements BindingRule {
  readonly name = "login" as const;
  constructor(
    private readonly dir: CheckoutDirectory,
    private readonly logins: LoginBindings,
  ) {}
  async candidates(input: BindInput, ref: MerchantRef): Promise<CheckoutMatch[] | null> {
    if (!input.sessionId) return null;
    const bound = await this.logins.boundOf(input.sessionId);
    return bound ? this.dir.inWorkspace(bound.workspace, ref.store ?? bound.store) : null;
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
 * Binds a spend request to the run it belongs to: the rules in order, the first that yields exactly one checkout
 * wins. None does → the fallback (flagged `binding_fallback` in the records), carrying the card every checkout of
 * the first rule that found several calls for, when they all call for the same one: those are the runs of one task
 * (one total at one store), so its 3-D Secure or decline card holds for whichever run the request is — never the
 * plain success card in its place. A rule that cannot ask the stores leaves the request unbound for that reason
 * (`unavailable`), unless another rule binds it: a card is never issued on a guess the stores could have corrected.
 */
export class Binder {
  constructor(
    private readonly rules: readonly BindingRule[],
    private readonly stores: readonly string[],
  ) {}

  async bind(input: BindInput): Promise<Binding> {
    const ref = parseMerchant(input.merchantUrl, input.merchantName, this.stores);
    const notes: string[] = [];
    let failed = false;
    let agreed: CardKind | null = null;
    for (const rule of this.rules) {
      let found: CheckoutMatch[] | null;
      try {
        found = await rule.candidates(input, ref);
      } catch (err) {
        failed = true;
        notes.push(`${rule.name}: ${(err as Error).message}`);
        continue;
      }
      if (found === null) continue;
      if (found.length === 1) {
        const m = found[0] as CheckoutMatch;
        return { rule: rule.name, workspace: m.workspace, store: m.store, checkout: m.checkout, scenarioId: m.scenarioId, card: m.card };
      }
      notes.push(`${rule.name}: ${found.length} checkouts`);
      if (agreed === null && found.length > 1) agreed = unanimous(found);
    }
    const reason = notes.join("; ") || "no rule applied";
    if (failed) return { rule: "unavailable", reason };
    return agreed === null ? { rule: "fallback", reason } : { rule: "fallback", reason, card: agreed };
  }

  merchant(input: Pick<BindInput, "merchantUrl" | "merchantName">): MerchantRef {
    return parseMerchant(input.merchantUrl, input.merchantName, this.stores);
  }
}

/** The card every match calls for, when they all call for the same one; null otherwise. */
function unanimous(found: readonly CheckoutMatch[]): CardKind | null {
  const kinds = new Set(found.map((m) => m.card));
  return kinds.size === 1 ? ((found[0] as CheckoutMatch).card) : null;
}
