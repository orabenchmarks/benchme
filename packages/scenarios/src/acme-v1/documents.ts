import { type Rng, int, pick } from "../prng.js";
import type { CompanyFacts, Customer, Document, Location, Product, SlaPolicy } from "../scenario.js";
import { personName, word } from "./names.js";

/**
 * The vault: ~40 internal documents whose FACTS are derived from the seed
 * (prices, depots, SLAs, headcount) so a search task has a checkable answer,
 * plus filler memos that carry near-miss numbers to defeat keyword luck.
 */
export function documents(rng: Rng, input: { company: CompanyFacts; products: Product[]; locations: Location[]; customers: Customer[]; sla: SlaPolicy[] }): Document[] {
  const { company, products, locations, customers, sla } = input;
  const out: Document[] = [];
  let n = 0;
  const add = (kind: Document["kind"], title: string, body: string, tags: string[]) => {
    n++;
    const day = int(rng, 0, 300);
    out.push({ id: `doc-${String(100 + n)}`, title, kind, body, tags, updatedAt: new Date(Date.UTC(2025, 8, 1 + day)).toISOString() });
  };

  // Policies (facts: SLA hours, return window, discount tiers)
  const returnDays = 14 + int(rng, 0, 4) * 7;
  const goldPct = 5 + int(rng, 0, 5);
  const platinumPct = goldPct + 3 + int(rng, 0, 4);
  add("policy", "Returns and warranty policy", `Customers may return unused goods within ${returnDays} days of delivery for a full credit note. Warranty claims on ${pick(rng, products).category} items are handled by the ${pick(rng, locations).name}. Damaged deliveries must be reported through the helpdesk within 48 hours.`, ["policy", "returns"]);
  add("policy", "Customer tier discounts", `Standard customers pay list price. Gold customers receive ${goldPct}% off list on every order; platinum customers receive ${platinumPct}% off and free transfers between depots. Tier reviews happen each January.`, ["policy", "pricing"]);
  add("policy", "Support service levels", `Response and resolution targets by priority: ${sla.map((s) => `${s.priority} — respond within ${s.respondHours} h, resolve within ${s.resolveHours} h`).join("; ")}. Breaches are reviewed weekly by the support lead.`, ["policy", "support", "sla"]);
  add("policy", "Depot operating hours", `${locations.map((l) => `${l.name} (${l.code}, ${l.city}) receives goods 07:00–15:00 and dispatches until ${16 + int(rng, 0, 3)}:00`).join(". ")}. No dispatch on public holidays.`, ["policy", "logistics"]);

  // Product datasheets (facts: price, category, lead time)
  for (let i = 0; i < 12; i++) {
    const p = products[(i * 9) % products.length] as Product;
    const lead = 2 + int(rng, 0, 12);
    add("datasheet", `Datasheet: ${p.name} (${p.sku})`, `${p.name} is a ${p.category} item with a list price of $${(p.unitPriceCents / 100).toFixed(2)} per unit. Standard lead time from the supplier is ${lead} business days. Minimum order quantity: ${int(rng, 1, 5) * 5}. Store below 30 °C.`, ["datasheet", p.category]);
  }

  // Memos and meeting notes (facts: headcount, revenue, a depot opening; near-miss numbers elsewhere)
  add("memo", "FY2025 results summary", `${company.name} closed FY2025 with revenue of $${(company.fiscalYearRevenueCents / 100).toLocaleString("en-US")} and ${company.employees} employees. Headquarters remain in ${company.headquarters}. The board approved the ${pick(rng, locations).name} expansion.`, ["memo", "finance"]);
  add("memo", "Draft: FY2025 results (superseded)", `DRAFT — superseded by the final summary. Preliminary revenue was estimated at $${((company.fiscalYearRevenueCents / 100) * 0.97).toLocaleString("en-US", { maximumFractionDigits: 0 })} with ${company.employees + 12} employees on the preliminary count.`, ["memo", "finance", "draft"]);
  for (let i = 0; i < 10; i++) {
    const c = pick(rng, customers);
    add("meeting-notes", `Account review: ${c.name}`, `Attendees: ${personName(rng)}, ${personName(rng)}. ${c.name} (${c.code}, ${c.tier}) asked about ${word(rng)} pricing and the ${pick(rng, products).sku} lead time. Action: ${personName(rng)} to send the datasheet. Next review in ${int(rng, 1, 6)} months.`, ["meeting", c.tier]);
  }
  for (let i = 0; i < 8; i++) {
    add("memo", `Operations memo ${i + 1}: ${word(rng)} ${pick(rng, ["rollout", "audit", "retrospective", "checklist"])}`, `${word(rng)} ${word(rng)}. Reminder that transfers over ${int(rng, 10, 40) * 5} units need a second approval, and that stock counts at ${pick(rng, locations).code} are due on the ${int(rng, 1, 28)}th.`, ["memo", "operations"]);
  }
  add("faq", "Helpdesk FAQ", `How do I open a ticket? Sign in to the helpdesk and choose New ticket. What counts as urgent? Production is stopped or a safety issue. Who assigns tickets? The support lead, within the response SLA. Can a closed ticket be reopened? No — open a new one and reference the old number.`, ["faq", "support"]);
  return out;
}
