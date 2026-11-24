import type { ClinicRows } from "./sites/clinic/types.js";
import type { EventRows } from "./sites/events/types.js";
import type { PizzaRows } from "./sites/pizza/types.js";
import type { SportsRows } from "./sites/sports/types.js";
import type { CinemaRows } from "./sites/cinema/types.js";
import type { FlightRows } from "./sites/flights/types.js";
import type { DiningRows } from "./sites/dining/types.js";
import type { HomeRows } from "./sites/homes/types.js";

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

export type DocumentKind = "policy" | "datasheet" | "memo" | "meeting-notes" | "faq";
export type Document = { id: string; title: string; kind: DocumentKind; body: string; tags: string[]; updatedAt: string };

/**
 * The hotel booking site (apps/hotels). Prices are per room per night; a
 * stay's total adds the hotel's pet fee (once per stay, when pets come) and
 * its late-checkout fee (when the guest asks for it). Rules: ./stays.ts.
 */
export type Hotel = {
  code: string;
  name: string;
  city: string;
  rating: number;
  description: string;
  amenities: string[];
  petsAllowed: boolean;
  /** One fee per stay with any number of pets; null where pets are not allowed. */
  petFeeCents: number | null;
  /** The latest checkout a guest can ask for, "HH:MM"; null where late checkout is not offered. */
  lateCheckoutUntil: string | null;
  lateCheckoutFeeCents: number | null;
};
export type RoomType = { hotelCode: string; code: string; name: string; maxAdults: number; maxKids: number; nightlyCents: number; rooms: number };
export type BookingStatus = "confirmed" | "cancelled";
export type Booking = {
  bookingNo: string;
  hotelCode: string;
  roomCode: string;
  guestName: string;
  guestEmail: string;
  /** The first night, "YYYY-MM-DD". */
  checkIn: string;
  nights: number;
  adults: number;
  kids: number;
  pets: number;
  lateCheckout: boolean;
  status: BookingStatus;
  totalCents: number;
  createdAt: string;
};
export type HotelRows = { hotels: Hotel[]; rooms: RoomType[]; bookings: Booking[] };

export type CompanyFacts = {
  name: string;
  founded: number;
  headquarters: string;
  employees: number;
  fiscalYearRevenueCents: number;
};

/** An account a site already has when a workspace starts: signed up and verified, with the password its owner types. */
export type SiteAccount = { email: string; name: string; password: string };
/** Accounts by site app (hotels, flights …); a site with none is left out. */
export type SiteAccounts = Partial<Record<"hotels" | "flights" | "dining" | "pizza" | "cinema" | "sports" | "homes" | "clinic" | "events", SiteAccount[]>>;

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
  vault: {
    documents: Document[];
  };
  hotels: HotelRows;
  homes: HomeRows;
  dining: DiningRows;
  flights: FlightRows;
  cinema: CinemaRows;
  sports: SportsRows;
  pizza: PizzaRows;
  events: EventRows;
  clinic: ClinicRows;
  /** Accounts the sites start with (cuj-v1); absent where a scenario seeds none, as every other does. */
  accounts?: SiteAccounts;
};

/**
 * How a workspace's mailboxes work, as the inbox (apps/mail) keeps them:
 * - `shared`: one inbox shows the mail to every address, so a site's sign-up code can be read whoever it was sent to;
 * - `private`: every address the workspace's rows already hold (a guest, an organiser, an account's owner) has a
 *   mailbox of its own, which the inbox never shows. Signing up in the name of someone who already exists cannot be
 *   finished, because their code goes to their own mailbox; mail to any other address (one the user makes up, a new
 *   person a task names) is shown as in a shared inbox.
 */
export const MAILBOXES = ["shared", "private"] as const;
export type Mailboxes = (typeof MAILBOXES)[number];

/** A scenario is a pure function of its seed: same seed, byte-identical rows. */
export interface Scenario {
  readonly key: string;
  readonly description: string;
  /**
   * The apps this scenario's workspaces advertise (their `urls`, their portal page), in this order — an app named
   * here is advertised even when the gateway lists it as UNLISTED, which keeps it out of every OTHER scenario's
   * workspaces. Absent: every listed app, as before.
   */
  readonly apps?: readonly string[];
  /** How its workspaces' mailboxes work (`Mailboxes`). Absent: `shared`, as every scenario's were before (`mailboxesOf`). */
  readonly mailboxes?: Mailboxes;
  generate(seed: number): ScenarioRows;
}

/** A scenario's mailboxes: what it declares, or `shared` when it says nothing — the one place that default lives. */
export const mailboxesOf = (scenario: Pick<Scenario, "mailboxes">): Mailboxes => scenario.mailboxes ?? "shared";

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
