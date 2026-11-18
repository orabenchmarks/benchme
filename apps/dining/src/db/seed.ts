import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

async function bulk(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunk = Math.floor(60_000 / perRow);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map((_, r) => `(${columns.map((__, c) => `$${r * perRow + c + 1}`).join(",")})`).join(",");
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, slice.flat());
  }
}

/** Materialise a scenario's dining rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedDining(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const d = rows.dining;
  await withTx(pool, async (c) => {
    for (const t of ["reservations", "seating", "restaurants", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM dining.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(
      c,
      "dining.restaurants",
      ["workspace_id", "code", "name", "city", "cuisine", "price_level", "description", "menus", "closed_day", "hours", "deposit_per_guest_cents", "private_room_fee_cents"],
      d.restaurants.map((r) => [ws, r.code, r.name, r.city, r.cuisine, r.priceLevel, r.description, r.menus, r.closedDay, JSON.stringify(r.hours), r.depositPerGuestCents, r.privateRoomFeeCents]),
    );
    await bulk(
      c,
      "dining.seating",
      ["workspace_id", "restaurant_code", "area", "seats", "table_count"],
      d.seating.map((s) => [ws, s.restaurantCode, s.area, s.seats, s.tables]),
    );
    await bulk(
      c,
      "dining.reservations",
      ["workspace_id", "reservation_no", "restaurant_code", "area", "res_date", "res_time", "party_size", "guest_name", "guest_email", "guest_phone", "note", "status", "deposit_cents", "created_at"],
      d.reservations.map((b) => [ws, b.reservationNo, b.restaurantCode, b.area, b.date, b.time, b.partySize, b.guestName, b.guestEmail, b.guestPhone, b.note, b.status, b.depositCents, b.createdAt]),
    );
  });
}
