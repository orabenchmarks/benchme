/**
 * Row shapes carry NATURAL keys (sku, code, orderNo) and no database ids, so
 * every app can insert them under any workspace_id.
 */
export type Product = { sku: string; name: string; category: string; unitPriceCents: number };
export type Location = { code: string; name: string; city: string };
export type Stock = { sku: string; locationCode: string; qty: number };
export type Customer = { code: string; name: string; tier: "standard" | "gold" | "platinum"; city: string };
export type OrderStatus = "open" | "shipped" | "cancelled";
export type Order = { orderNo: string; customerCode: string; status: OrderStatus; placedAt: string };
export type OrderLine = { orderNo: string; sku: string; qty: number };
export type TransferStatus = "pending" | "completed";
export type Transfer = { transferNo: string; sku: string; fromCode: string; toCode: string; qty: number; status: TransferStatus };

export type Agent = { code: string; name: string; team: string };
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type Ticket = {
  ticketNo: string;
  subject: string;
  body: string;
  requester: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeCode: string | null;
  openedAt: string;
  resolvedAt: string | null;
};
export type Comment = { ticketNo: string; seq: number; author: string; body: string; internal: boolean; createdAt: string };
export type SlaPolicy = { priority: TicketPriority; respondHours: number; resolveHours: number };

export type CompanyFacts = {
  name: string;
  founded: number;
  headquarters: string;
  employees: number;
  fiscalYearRevenueCents: number;
};

export type ScenarioRows = {
  company: CompanyFacts;
  warehouse: {
    products: Product[];
    locations: Location[];
    stock: Stock[];
    customers: Customer[];
    orders: Order[];
    orderLines: OrderLine[];
    transfers: Transfer[];
  };
  helpdesk: {
    agents: Agent[];
    tickets: Ticket[];
    comments: Comment[];
    slaPolicies: SlaPolicy[];
  };
};

/** A scenario is a pure function of its seed: same seed, byte-identical rows. */
export interface Scenario {
  readonly key: string;
  readonly description: string;
  generate(seed: number): ScenarioRows;
}

export class UnknownScenarioError extends Error {
  constructor(key: string) {
    super(`unknown scenario: ${key}`);
    this.name = "UnknownScenarioError";
  }
}

/** Registry (Open/Closed): a new scenario is registered, never switched on. */
export class ScenarioRegistry {
  private readonly byKey = new Map<string, Scenario>();

  register(scenario: Scenario): this {
    if (this.byKey.has(scenario.key)) throw new Error(`scenario already registered: ${scenario.key}`);
    this.byKey.set(scenario.key, scenario);
    return this;
  }

  get(key: string): Scenario {
    const s = this.byKey.get(key);
    if (!s) throw new UnknownScenarioError(key);
    return s;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  list(): Scenario[] {
    return [...this.byKey.values()];
  }
}
