import type { ScenarioRows } from "./scenario.js";

/**
 * Ground truths derived by CODE from generated rows — never transcribed. The
 * corpus build calls these to write answers.json; the apps' own queries must
 * agree with them (a test asserts it per query).
 */
export function stockOf(rows: ScenarioRows, sku: string, locationCode?: string): number {
  return rows.warehouse.stock
    .filter((s) => s.sku === sku && (locationCode === undefined || s.locationCode === locationCode))
    .reduce((sum, s) => sum + s.qty, 0);
}

export function openOrdersFor(rows: ScenarioRows, customerCode: string): string[] {
  return rows.warehouse.orders
    .filter((o) => o.customerCode === customerCode && o.status === "open")
    .map((o) => o.orderNo)
    .sort();
}

export function orderTotalCents(rows: ScenarioRows, orderNo: string): number {
  const price = new Map(rows.warehouse.products.map((p) => [p.sku, p.unitPriceCents]));
  return rows.warehouse.orderLines
    .filter((l) => l.orderNo === orderNo)
    .reduce((sum, l) => sum + l.qty * (price.get(l.sku) ?? 0), 0);
}

/**
 * SKUs whose total stock across every location is below `threshold`. A product
 * with NO stock rows has a total of 0 and therefore counts — the answer key
 * once skipped those and graded seven of eight agents wrong for listing them.
 */
export function lowStock(rows: ScenarioRows, threshold: number): string[] {
  const totals = new Map<string, number>(rows.warehouse.products.map((p) => [p.sku, 0]));
  for (const s of rows.warehouse.stock) totals.set(s.sku, (totals.get(s.sku) ?? 0) + s.qty);
  return [...totals.entries()]
    .filter(([, qty]) => qty < threshold)
    .map(([sku]) => sku)
    .sort();
}

/** Open (or pending) tickets currently assigned to one agent, sorted. */
export function openTicketsFor(rows: ScenarioRows, agentCode: string): string[] {
  return rows.helpdesk.tickets
    .filter((t) => t.assigneeCode === agentCode && (t.status === "open" || t.status === "pending"))
    .map((t) => t.ticketNo)
    .sort();
}

/** Tickets whose resolution took longer than their priority's SLA (resolved ones only). */
export function slaBreaches(rows: ScenarioRows): string[] {
  const hours = new Map(rows.helpdesk.slaPolicies.map((p) => [p.priority, p.resolveHours]));
  return rows.helpdesk.tickets
    .filter((t) => t.resolvedAt !== null)
    .filter((t) => (new Date(t.resolvedAt as string).getTime() - new Date(t.openedAt).getTime()) / 3_600_000 > (hours.get(t.priority) ?? Infinity))
    .map((t) => t.ticketNo)
    .sort();
}

/** Documents whose title or body contains every word of the query (case-insensitive), by id. */
export function documentsMatching(rows: ScenarioRows, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.vault.documents
    .filter((d) => {
      const hay = `${d.title} ${d.body}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((d) => d.id)
    .sort();
}
