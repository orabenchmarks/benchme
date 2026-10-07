import { withTx, type Pool } from "@benchme/core";
import { lineKey, type CartLine } from "@benchme/storefront";

export type Cart = { lines: CartLine[]; promo: string | null };

/** shops.carts: one cart per workspace and store, its lines as JSONB. A store never visited has an empty cart. */
export class CartsRepo {
  constructor(private readonly pool: Pool) {}

  async get(ws: string, store: string): Promise<Cart> {
    const r = await this.pool.query<{ lines: CartLine[]; promo: string | null }>("SELECT lines, promo FROM shops.carts WHERE workspace_id = $1 AND store = $2", [ws, store]);
    const row = r.rows[0];
    return { lines: row?.lines ?? [], promo: row?.promo ?? null };
  }

  /** Replaces the lines. `promo` omitted keeps the applied code; null removes it. */
  async put(ws: string, store: string, lines: CartLine[], promo?: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO shops.carts (workspace_id, store, lines, promo) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, store) DO UPDATE SET
         lines = EXCLUDED.lines,
         promo = CASE WHEN $5::boolean THEN EXCLUDED.promo ELSE shops.carts.promo END,
         updated_at = now()`,
      [ws, store, JSON.stringify(lines), promo ?? null, promo !== undefined],
    );
  }

  /** Empties the cart, code and all (after an order is placed). */
  async clear(ws: string, store: string): Promise<void> {
    await this.pool.query("DELETE FROM shops.carts WHERE workspace_id = $1 AND store = $2", [ws, store]);
  }

  /**
   * Takes out what a payment paid for — each of `paid`'s lines, matched by product, options, purchase mode and
   * interval, up to its quantity — and keeps everything added since (with the code applied). A cart left with
   * nothing is emptied, code and all, as clear() does. One short transaction holding the cart's row.
   */
  async removeLines(ws: string, store: string, paid: readonly CartLine[]): Promise<void> {
    await withTx(this.pool, async (db) => {
      const r = await db.query<{ lines: CartLine[] }>("SELECT lines FROM shops.carts WHERE workspace_id = $1 AND store = $2 FOR UPDATE", [ws, store]);
      const row = r.rows[0];
      if (!row) return;
      const owed = new Map<string, number>();
      for (const l of paid) owed.set(lineKey(l), (owed.get(lineKey(l)) ?? 0) + l.qty);
      const left: CartLine[] = [];
      for (const l of row.lines) {
        const key = lineKey(l);
        const take = Math.min(l.qty, owed.get(key) ?? 0);
        owed.set(key, (owed.get(key) ?? 0) - take);
        if (l.qty - take > 0) left.push({ ...l, qty: l.qty - take });
      }
      if (!left.length) await db.query("DELETE FROM shops.carts WHERE workspace_id = $1 AND store = $2", [ws, store]);
      else await db.query("UPDATE shops.carts SET lines = $3::jsonb, updated_at = now() WHERE workspace_id = $1 AND store = $2", [ws, store, JSON.stringify(left)]);
    });
  }
}
