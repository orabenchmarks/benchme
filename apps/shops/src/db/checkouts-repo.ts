import type { Pool } from "@benchme/core";
import { DomainError } from "@benchme/site-kit";
import { randomInt } from "node:crypto";
import type { Db } from "./lock.js";

/**
 * The buyer's contact. `name`: the sender's name a florist asks for (its delivery address is the
 * recipient's) — absent when not given, and at the other stores, whose address is the buyer's own.
 */
export type Contact = { email: string; phone: string; marketing: boolean; name?: string };
export type Address = { firstName: string; lastName: string; line1: string; line2: string; city: string; state: string; zip: string };
export type Delivery = { date: string; sameDay: boolean; message: string; signature: string };

/**
 * A checkout started from a store's cart. It does not copy the cart: totals are
 * recomputed from the live cart at every step, so an edit after checkout started
 * is what gets paid (Review Focus 5). `token` is unique within a workspace only —
 * a route serving it must also check `store` against the site it runs on.
 */
export type Checkout = {
  token: string;
  store: string;
  status: "open" | "paid";
  contact: Contact | null;
  address: Address | null;
  delivery: Delivery | null;
  shippingId: string | null;
  addOns: string[];
  flags: Record<string, unknown>;
  paymentRef: string | null;
};

export type CheckoutPatch = Partial<Omit<Checkout, "token" | "store" | "status">>;

type Row = {
  token: string;
  store: string;
  status: Checkout["status"];
  contact: Contact | null;
  address: Address | null;
  delivery: Delivery | null;
  shipping_id: string | null;
  add_ons: string[];
  flags: Record<string, unknown>;
  payment_ref: string | null;
};

const toCheckout = (r: Row): Checkout => ({
  token: r.token,
  store: r.store,
  status: r.status,
  contact: r.contact,
  address: r.address,
  delivery: r.delivery,
  shippingId: r.shipping_id,
  addOns: r.add_ons,
  flags: r.flags,
  paymentRef: r.payment_ref,
});

const ALPHANUMERIC = "0123456789abcdefghijklmnopqrstuvwxyz";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * A new checkout token: 24 characters of [0-9a-z], uniformly random, with a letter at every sixth place
 * (about 122 bits). A token sits in every checkout URL and PayLantern `ref` an agent sees, and a run of
 * 13–19 digits there could pass a card-leak scan's Luhn check; here no run of digits is longer than five.
 */
/** What a route accepts as a checkout token: the tokens newCheckoutToken mints, and the 24-hex ones minted before. */
export const CHECKOUT_TOKEN = /^[0-9a-z]{24}$/;

export function newCheckoutToken(): string {
  let token = "";
  for (let i = 0; i < 24; i++) {
    const alphabet = i % 6 === 5 ? LETTERS : ALPHANUMERIC;
    token += alphabet[randomInt(alphabet.length)];
  }
  return token;
}

/** JSONB parameters are sent as JSON text: node-pg would turn a JS array into a Postgres array literal. */
const jsonb = (v: unknown): string | null => (v === null ? null : JSON.stringify(v));
const unknownCheckout = (token: string) => new DomainError("UNKNOWN_CHECKOUT", `no checkout ${token}`, 404);
const COLUMNS = "token, store, status, contact, address, delivery, shipping_id, add_ons, flags, payment_ref";

/** shops.checkouts. Every method is workspace-scoped. */
export class CheckoutsRepo {
  constructor(private readonly pool: Pool) {}

  async create(ws: string, store: string, init: { addOns: string[] }, db: Db = this.pool): Promise<Checkout> {
    const r = await db.query<Row>(
      `INSERT INTO shops.checkouts (workspace_id, store, token, add_ons) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${COLUMNS}`,
      [ws, store, newCheckoutToken(), jsonb(init.addOns)],
    );
    return toCheckout(r.rows[0] as Row);
  }

  /** The store's newest checkout that is still open (not paid), or null. */
  async latestOpen(ws: string, store: string, db: Db = this.pool): Promise<Checkout | null> {
    const r = await db.query<Row>(
      `SELECT ${COLUMNS} FROM shops.checkouts WHERE workspace_id = $1 AND store = $2 AND status = 'open' ORDER BY created_at DESC, token DESC LIMIT 1`,
      [ws, store],
    );
    return r.rows[0] ? toCheckout(r.rows[0]) : null;
  }

  async get(ws: string, token: string): Promise<Checkout | null> {
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM shops.checkouts WHERE workspace_id = $1 AND token = $2`, [ws, token]);
    return r.rows[0] ? toCheckout(r.rows[0]) : null;
  }

  /**
   * Sets only the fields present in `patch` (null clears a nullable one). `flags`
   * merge into the stored flags — a patch adds or overwrites keys, never drops one —
   * so two steps recording different flags cannot erase each other.
   */
  async update(ws: string, token: string, patch: CheckoutPatch): Promise<Checkout> {
    const params: unknown[] = [ws, token];
    const sets: string[] = [];
    const set = (column: string, value: unknown, json = false) => {
      params.push(json ? jsonb(value) : value);
      sets.push(`${column} = ${json ? `$${params.length}::jsonb` : `$${params.length}`}`);
    };
    if (patch.contact !== undefined) set("contact", patch.contact, true);
    if (patch.address !== undefined) set("address", patch.address, true);
    if (patch.delivery !== undefined) set("delivery", patch.delivery, true);
    if (patch.shippingId !== undefined) set("shipping_id", patch.shippingId);
    if (patch.addOns !== undefined) set("add_ons", patch.addOns, true);
    if (patch.paymentRef !== undefined) set("payment_ref", patch.paymentRef);
    if (patch.flags !== undefined) {
      params.push(jsonb(patch.flags));
      sets.push(`flags = shops.checkouts.flags || $${params.length}::jsonb`);
    }
    if (sets.length === 0) {
      const current = await this.get(ws, token);
      if (!current) throw unknownCheckout(token);
      return current;
    }
    const r = await this.pool.query<Row>(
      `UPDATE shops.checkouts SET ${sets.join(", ")}, updated_at = now() WHERE workspace_id = $1 AND token = $2 RETURNING ${COLUMNS}`,
      params,
    );
    if (!r.rows[0]) throw unknownCheckout(token);
    return toCheckout(r.rows[0]);
  }

  /** Idempotent: a second completion of the same payment finds it already paid. */
  async markPaid(ws: string, token: string): Promise<void> {
    const r = await this.pool.query("UPDATE shops.checkouts SET status = 'paid', updated_at = now() WHERE workspace_id = $1 AND token = $2", [ws, token]);
    if (!r.rowCount) throw unknownCheckout(token);
  }
}
