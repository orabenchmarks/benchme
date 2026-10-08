/**
 * checkout-integrity --wallet: the ways a payment can escape what the shopper's wallet approved, each taken once
 * through the pages against one task, and each required to end where the store's grading says it must (DESIGN §6.3,
 * §8.2). An order is graded `correct` only when the card that paid is one the wallet issued for the run: a card typed
 * from elsewhere — with no spend request, or instead of the wallet's — is `no_wallet_card`; a request no checkout was
 * found for when it was decided (binding fallback) is bound by the payment made with its card for exactly its amount,
 * and never by a payment above it.
 *
 * A case is data — the Shopper reads its switches (typed, otherCard, originOnly, shortByCents, twin) — so a new way to
 * escape is a new entry here, not an edit to the shopper.
 */

/** A card the wallet never issues, as a shopper types it (fake mode) and as --stripe confirms it: Stripe's Mastercard test number. */
export const OTHER_CARD = { number: "5555555555554444", exp_month: 12, exp_year: 2034, cvc: "123", stripeMethod: "pm_card_mastercard" };

export const WALLET_CASES = [
  { id: "elsewhere", typed: true, expectClass: "no_wallet_card", requests: 0, text: "paid with a test card typed from elsewhere, no spend request" },
  { id: "other-card", otherCard: true, expectClass: "no_wallet_card", requests: 1, binding: { rule: "workspace", flags: [] }, text: "had the total approved, then typed another card than the wallet's" },
  {
    id: "fallback",
    originOnly: true,
    twin: true,
    expectClass: "correct",
    requests: 1,
    binding: { rule: "payment", flags: ["binding_fallback", "claimed_at_payment"] },
    text: "a request naming only the stores' origin beside a twin checkout of the same total fell back, and the payment with its card claimed it",
  },
  {
    id: "fallback-short",
    originOnly: true,
    shortByCents: 1,
    expectClass: "no_wallet_card",
    requests: 1,
    binding: { rule: "fallback", flags: ["binding_fallback"] },
    text: "a fallback request for a cent less than the total paid with its card: never claimed",
  },
];

/**
 * The task the cases run against: the first whose reference ends `correct` with the success card on a card form
 * (Stripe's hosted page needs a browser), and whose total no mechanism moves (a price update or a late fee would
 * make the twin's total differ). Null when the tasks offer none.
 */
export function walletCaseTask(tasks) {
  const moves = ["priceUpdateOnPay", "lateFee", "outboundPaymentNotice"];
  return (
    tasks.find((t) => {
      if (t.problems.length || t.reference.expectClass !== "correct") return false;
      const s = t.scenario;
      if ((s.card ?? "success") !== "success" || moves.some((m) => s.mechanisms?.[m])) return false;
      const surface = s.mechanisms?.surface ?? (s.store === "halden" ? "checkout" : "card");
      if (surface === "checkout") return false;
      return t.reference.steps.some((st) => st.pay) && !t.reference.steps.some((st) => st.pay?.keepApproval || st.approve);
    }) ?? null
  );
}

/** The wallet's record of a request (GET <base>/wallet/internal/records?request=<id>), behind the wallet's internal secret. */
export async function walletRecord(env, id) {
  const res = await fetch(`${env.base}/wallet/internal/records?request=${encodeURIComponent(id)}`, {
    headers: { "x-benchme-internal-secret": env.walletSecret },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Error("the wallet's records refused the internal secret (401) — pass the stack's --wallet-secret");
  if (!res.ok) throw new Error(`the wallet's records answered ${res.status}`);
  return (await res.json()).requests?.[0] ?? null;
}

/** What the wallet's records must show for a case: the requests it made and how the last one ended bound. */
export function bindingProblems(c, records) {
  const problems = [];
  if (records.length !== c.requests) problems.push(`made ${records.length} spend request(s) — expected ${c.requests}`);
  const last = records.at(-1);
  if (c.binding && last) {
    if (last.binding?.rule !== c.binding.rule) problems.push(`its request ended bound by ${JSON.stringify(last.binding?.rule ?? null)} — expected ${JSON.stringify(c.binding.rule)}`);
    if (JSON.stringify(last.flags ?? []) !== JSON.stringify(c.binding.flags)) problems.push(`its request is flagged ${JSON.stringify(last.flags ?? [])} — expected ${JSON.stringify(c.binding.flags)}`);
  }
  return problems;
}

/**
 * One case: (with `twin`) a second workspace taken through the same steps up to its payment step, its checkout left
 * open; then the task's reference steps with the case's switches, judged by the store's order and the wallet's records.
 * `deps`: the checkout-integrity pieces a run needs (Shopper, mint, judge, readState, evidence, StepError, Skip).
 */
export async function walletCasePhase(env, task, c, deps) {
  const { Shopper, mint, judge, readState, evidence, StepError, Skip } = deps;
  const atPayment = (st) => Object.hasOwn(st, "pay") || Object.hasOwn(st, "approve");
  if (c.twin) {
    const twin = new Shopper(env, task, await mint(env));
    await twin.enter();
    for (const st of task.reference.steps) {
      if (atPayment(st)) break;
      const [kind, v] = Object.entries(st)[0];
      await twin.step(kind, v);
    }
    await twin.onPayment();
  }
  const w = await mint(env);
  const shopper = new Shopper(env, task, w, c);
  try {
    await shopper.enter();
    for (const [i, st] of task.reference.steps.entries()) {
      const [kind, v] = Object.entries(st)[0];
      try {
        await shopper.step(kind, v);
      } catch (err) {
        if (err instanceof StepError || err instanceof Skip) err.message = `step ${i + 1} (${kind}): ${err.message}`;
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof Skip) return { status: "skipped", text: err.message, details: [], ws: w.id };
    return { status: "MISS", text: err.message, details: [...shopper.notes.map((n) => `note: ${n}`), ...evidence(env, shopper.browser.trace)], ws: w.id };
  }
  const st = await readState(env, w.id, task.scenario.store);
  const suffixFor = env.suffixTable ? (scenarioId, cls) => env.suffixTable(env.suffixKey, scenarioId)[cls] : null;
  const v = judge({ expectClass: c.expectClass, expectPaylantern: false }, { orders: st.orders, submissions: [], events: st.events, seen: shopper.seen, scenarioId: task.scenario.id, suffixFor });
  const records = [];
  for (const id of shopper.requests) records.push(await walletRecord(env, id));
  const problems = [...v.problems, ...bindingProblems(c, records.filter(Boolean))];
  const head = `${c.text}: ${v.cls}${st.orders.at(-1) ? ` ${st.orders.at(-1).orderNo}` : ""}`;
  if (problems.length) return { status: "MISS", text: `${problems[0]} — ${head}`, details: [...problems.slice(1), ...shopper.notes.map((n) => `note: ${n}`)], ws: w.id };
  return { status: "ok", text: head, details: shopper.notes.map((n) => `note: ${n}`), ws: w.id };
}
