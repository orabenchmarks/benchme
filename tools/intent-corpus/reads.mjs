/**
 * Read tasks answerable on EVERY surface — the site's pages, its WebMCP/MCP
 * tools, and its NLWeb `/ask` index — so one task set compares all three
 * protocols. (intent-stock-01 / intent-lowstock-01 need per-depot quantities,
 * which NLWeb's schema.org items do not carry: a Product exposes price and
 * availability, not counts. They stay page/tool tasks.)
 *
 * Every answer is derived from the seeded rows, and every pick is checked for
 * uniqueness so the answer is unambiguous on all three surfaces.
 *
 *   deriveReads(rows, { seed, avoid }) → { problems, specs, tasks, md }
 */
import { documentsMatching } from "../../packages/scenarios/dist/index.js";

const rankPick = (arr, frac) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * frac)))];

export function deriveReads(rows, { seed, avoid }) {
  const problems = [];
  const products = rows.warehouse.products;
  const customers = rows.warehouse.customers;
  const tickets = rows.helpdesk.tickets;

  // price-01: a product whose NAME is unique, so the question names exactly one item.
  const uniqueNamed = products.filter((p) => products.filter((q) => q.name === p.name).length === 1 && !avoid.skus.includes(p.sku));
  const priced = rankPick(uniqueNamed, 0.3);
  if (!priced) problems.push("no uniquely-named product for intent-price-01");

  // customer-01: the ONLY customer with this (tier, city) pair.
  const uniquePair = customers.filter((c) => customers.filter((d) => d.tier === c.tier && d.city === c.city).length === 1);
  const customer = rankPick(uniquePair, 0.5);
  if (!customer) problems.push("no customer is alone in its (tier, city) pair — intent-customer-01 would be ambiguous");

  // reporter-01: a seeded ticket other than the one intent-ticket-01 mutates.
  const reported = rankPick(tickets.filter((t) => t.ticketNo !== avoid.ticketNo), 0.6);
  if (!reported) problems.push("no ticket for intent-reporter-01");

  // doc-02: a uniquely-titled document of a DIFFERENT kind than doc-01's.
  let doc = null;
  for (const kind of ["faq", "memo", "meeting-notes", "policy", "datasheet"]) {
    doc = rows.vault.documents.find((d) => d.kind === kind && d.id !== avoid.docId && documentsMatching(rows, d.title).length === 1 && documentsMatching(rows, d.title)[0] === d.id);
    if (doc) break;
  }
  if (!doc) problems.push("no second uniquely-titled vault document for intent-doc-02");
  if (problems.length) return { problems, specs: [], tasks: [], md: "", claims: [], answers: {} };

  const price = priced.unitPriceCents / 100;
  const phrase = doc.title.toLowerCase();
  const specs = [
    { id: "intent-price-01", blind: false, oracle: { kind: "json", expect: { price: { value: price, tolerance: 0.005 } } } },
    { id: "intent-customer-01", blind: false, oracle: { kind: "json", expect: { customerCode: customer.code } } },
    { id: "intent-reporter-01", blind: false, oracle: { kind: "json", expect: { requester: reported.requester } } },
    { id: "intent-doc-02", blind: false, oracle: { kind: "json", expect: { documentId: doc.id } } },
  ];
  const tasks = [
    {
      id: "intent-price-01",
      surfaces: ["pages", "tools", "nlweb"],
      app: "warehouse",
      intent: `What is the unit price of the ${priced.name}? Answer as JSON: {"price": <number, USD>}.`,
      oracle: "json",
      summary: `The unit price of ${priced.sku} (the only product named "${priced.name}").`,
    },
    {
      id: "intent-customer-01",
      surfaces: ["pages", "tools", "nlweb"],
      app: "warehouse",
      intent: `Which of our ${customer.tier}-tier customers is based in ${customer.city}? Answer as JSON: {"customerCode": "<code>"}.`,
      oracle: "json",
      summary: `${customer.code}, the only ${customer.tier}-tier customer in ${customer.city}.`,
    },
    {
      id: "intent-reporter-01",
      surfaces: ["pages", "tools", "nlweb"],
      app: "helpdesk",
      intent: `Which customer reported helpdesk ticket ${reported.ticketNo}? Answer as JSON: {"requester": "<customer code>"}.`,
      oracle: "json",
      summary: `The requester of ${reported.ticketNo}.`,
    },
    {
      id: "intent-doc-02",
      surfaces: ["pages", "tools", "nlweb"],
      app: "vaultdocs",
      intent: `Find the vault document about ${phrase} and report its document id as JSON: {"documentId": "<id>"}.`,
      oracle: "json",
      summary: `The id of the single vault document matching "${phrase}", derived by documentsMatching().`,
    },
  ];
  const md = `
## Read tasks answerable on every surface (pages, WebMCP/MCP tools, NLWeb)

These four exist so ONE task set can compare a site's three doors. Each
answer is present in the app's pages, its tools, AND its NLWeb \`/ask\`
index (schema.org items). intent-stock-01 and intent-lowstock-01 are not in
this set: NLWeb's Product items carry price and availability, not per-depot
quantities.

- **intent-price-01** — ${priced.sku} "${priced.name}" is the only product with that name; \`price\` = unitPriceCents / 100 = **${price}** (±0.005, a number).
- **intent-customer-01** — **${customer.code}** is the only ${customer.tier}-tier customer based in ${customer.city} (uniqueness checked over all ${customers.length} customers).
- **intent-reporter-01** — ticket ${reported.ticketNo} was reported by **${reported.requester}** (not ${avoid.ticketNo}, which intent-ticket-01 changes).
- **intent-doc-02** — \`documentsMatching(rows, "${phrase}")\` = [**${doc.id}**], a ${doc.kind} (a different kind than intent-doc-01's document).

All derived for seed ${seed}.
`;
  const claims = [`price-read:${priced.sku}`, `customer-read:${customer.code}`, `ticket-read:${reported.ticketNo}`, `doc-read:${doc.id}`];
  // Each answer read back from the LIVE apps the way the question asks it —
  // for tools/intent-integrity.mjs, which submits it to the verifier.
  const answers = {
    "intent-price-01": async (api) => ({ price: (await api.list("warehouse", "/api/v1/products")).find((p) => p.name === priced.name).unitPriceCents / 100 }),
    "intent-customer-01": async (api) => ({ customerCode: api.only((await api.list("warehouse", "/api/v1/customers")).filter((c) => c.tier === customer.tier && c.city === customer.city)).code }),
    "intent-reporter-01": async (api) => ({ requester: (await api.get("helpdesk", `/api/v1/tickets/${reported.ticketNo}`)).requester }),
    "intent-doc-02": async (api) => ({ documentId: await api.documentTitled(phrase) }),
  };
  return { problems, specs, tasks, md, claims, answers };
}
