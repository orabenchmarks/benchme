/**
 * Vault intent templates: find a document, and answer from what the
 * documents say — datasheets, policies, account reviews, the FY2025 results
 * (json). The vault is read-only. See ./index.mjs for the template contract.
 *
 * Document facts are generated INTO the body text (packages/scenarios/src/
 * acme-v1/documents.ts), so an answer is read out of the seeded body with the
 * sentence's own pattern — a changed sentence fails the build (numberIn
 * throws), never a silent null. Several documents carry near-miss numbers on
 * purpose (a superseded draft, eight operations memos), which is what these
 * questions test.
 */
import { documentsMatching } from "../../../packages/scenarios/dist/index.js";
import { numberIn, unique } from "../kit.mjs";

const PAGES_AND_TOOLS = ["pages", "tools"];
const EVERY_SURFACE = ["pages", "tools", "nlweb"];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The live body of a document the question names by title — the integrity check's read. */
const bodyOf = async (api, title) => (await api.get("vaultdocs", `/api/v1/documents/${await api.documentTitled(title.toLowerCase())}`)).body;

const docTitled = (ctx, title) => ctx.rows.vault.documents.find((d) => d.title === title);
const skuOfDatasheet = (d) => /\(([A-Z]+-\d+)\)$/.exec(d.title)[1];

/** One number a document states, as a template: `fact` names the pattern and the question. */
function documentFact({ key, count, about, candidates, claim, fact }) {
  return {
    key,
    app: "vaultdocs",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count,
    about,
    candidates,
    claims: (pick) => [`${key}:${claim(pick)}`],
    build(pick, ctx) {
      const { doc, pattern, field, intent, summary } = fact(pick, ctx);
      const value = numberIn(doc.body, pattern);
      return {
        intent: `${intent} Answer as JSON: {"${field}": <number>}.`,
        summary,
        oracle: { kind: "json", expect: { [field]: value } },
        note: `${doc.id} "${doc.title}" → ${value}`,
        answer: async (api) => ({ [field]: numberIn(await bodyOf(api, doc.title), pattern) }),
      };
    },
  };
}

export const vaultTemplates = [
  {
    key: "doc",
    app: "vaultdocs",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 4,
    about: "The id of the one document a phrase finds (intent-doc-01's shape): the phrase is a document's own title, used only when `documentsMatching(rows, title)` returns that document alone. Datasheets are left to their own questions.",
    candidates: (ctx) => ctx.rows.vault.documents.filter((d) => d.kind !== "datasheet" && documentsMatching(ctx.rows, d.title).join() === d.id),
    claims: (d) => [`doc-read:${d.id}`],
    build(d) {
      const phrase = d.title.toLowerCase();
      return {
        intent: `Find the vault document about ${phrase} and report its document id as JSON: {"documentId": "<id>"}.`,
        summary: `The id of the single vault document matching "${phrase}", derived by documentsMatching().`,
        oracle: { kind: "json", expect: { documentId: d.id } },
        note: `"${phrase}" → ${d.id}`,
        answer: async (api) => ({ documentId: await api.documentTitled(phrase) }),
      };
    },
  },
  documentFact({
    key: "lead-time",
    count: 4,
    about: "A product's standard supplier lead time, in business days, as its datasheet states it.",
    candidates: (ctx) => ctx.rows.vault.documents.filter((d) => d.kind === "datasheet"),
    claim: (d) => d.id,
    fact: (d, ctx) => {
      const p = ctx.product.get(skuOfDatasheet(d));
      return {
        doc: d,
        pattern: /Standard lead time from the supplier is (\d+) business days/,
        field: "days",
        intent: `According to the vault's datasheet for the ${p.name} (SKU ${p.sku}), what is the standard supplier lead time in business days?`,
        summary: `The lead time on ${p.sku}'s datasheet.`,
      };
    },
  }),
  documentFact({
    key: "moq",
    count: 3,
    about: "A product's minimum order quantity, as its datasheet states it.",
    candidates: (ctx) => ctx.rows.vault.documents.filter((d) => d.kind === "datasheet"),
    claim: (d) => d.id,
    fact: (d, ctx) => {
      const p = ctx.product.get(skuOfDatasheet(d));
      return {
        doc: d,
        pattern: /Minimum order quantity: (\d+)/,
        field: "moq",
        intent: `According to the vault's datasheet for the ${p.name} (SKU ${p.sku}), what is its minimum order quantity?`,
        summary: `The minimum order quantity on ${p.sku}'s datasheet.`,
      };
    },
  }),
  documentFact({
    key: "policy",
    count: 3,
    about: "A number from a policy document: the return window, and the gold and platinum discounts.",
    candidates: () => [
      { key: "returns", title: "Returns and warranty policy", pattern: /within (\d+) days of delivery/, field: "days", intent: "According to the vault's returns and warranty policy, within how many days of delivery may customers return unused goods?" },
      { key: "gold", title: "Customer tier discounts", pattern: /Gold customers receive (\d+)% off/, field: "percent", intent: "According to the vault's customer tier discounts policy, what percentage off list price do gold customers receive?" },
      { key: "platinum", title: "Customer tier discounts", pattern: /platinum customers receive (\d+)% off/, field: "percent", intent: "According to the vault's customer tier discounts policy, what percentage off list price do platinum customers receive?" },
    ],
    claim: (f) => f.key,
    fact: (f, ctx) => ({ doc: docTitled(ctx, f.title), pattern: f.pattern, field: f.field, intent: f.intent, summary: `The ${f.key} figure in "${f.title}".` }),
  }),
  documentFact({
    key: "dispatch",
    count: 2,
    about: "Until what hour a depot dispatches, from the depot operating hours policy (each depot's own sentence).",
    candidates: (ctx) => ctx.rows.warehouse.locations,
    claim: (l) => l.code,
    fact: (l, ctx) => ({
      doc: docTitled(ctx, "Depot operating hours"),
      pattern: new RegExp(`${escape(l.name)} \\(${escape(l.code)}, [^)]+\\) receives goods 07:00–15:00 and dispatches until (\\d+):00`),
      field: "hour",
      intent: `According to the vault's depot operating hours policy, until what hour does ${l.name} (${l.code}) dispatch goods? Give the hour on a 24-hour clock.`,
      summary: `The dispatch cut-off of ${l.code}.`,
    }),
  }),
  documentFact({
    key: "review",
    count: 2,
    about: "When a customer's next account review is due, from the only account-review note about that customer.",
    candidates: (ctx) => unique(ctx.rows.vault.documents.filter((d) => d.kind === "meeting-notes"), (d) => d.title),
    claim: (d) => d.id,
    fact: (d) => ({
      doc: d,
      pattern: /Next review in (\d+) months/,
      field: "months",
      intent: `According to the vault's account review notes for ${d.title.replace(/^Account review: /, "")}, in how many months is their next review?`,
      summary: `The review interval in "${d.title}".`,
    }),
  }),
  documentFact({
    key: "results",
    count: 2,
    about: "A figure from the FINAL FY2025 results summary — the vault also holds a superseded draft with near-miss numbers.",
    candidates: () => [
      { key: "employees", pattern: /and (\d+) employees/, field: "employees", intent: "According to the vault's final FY2025 results summary (not the superseded draft), how many employees did the company have?" },
      { key: "revenue", pattern: /revenue of \$([\d,]+)/, field: "revenue", intent: "According to the vault's final FY2025 results summary (not the superseded draft), what was the company's FY2025 revenue in US dollars?" },
    ],
    claim: (f) => f.key,
    fact: (f, ctx) => ({ doc: docTitled(ctx, "FY2025 results summary"), pattern: f.pattern, field: f.field, intent: f.intent, summary: `The final FY2025 ${f.key} figure.` }),
  }),
];
