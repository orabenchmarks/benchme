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

/** Materialise a scenario's hotel rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedHotels(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const h = rows.hotels;
  await withTx(pool, async (c) => {
    for (const t of ["bookings", "room_types", "hotels", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM hotels.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(
      c,
      "hotels.hotels",
      ["workspace_id", "code", "name", "city", "rating", "description", "amenities", "pets_allowed", "pet_fee_cents", "late_checkout_until", "late_checkout_fee_cents"],
      h.hotels.map((x) => [ws, x.code, x.name, x.city, x.rating, x.description, x.amenities, x.petsAllowed, x.petFeeCents, x.lateCheckoutUntil, x.lateCheckoutFeeCents]),
    );
    await bulk(
      c,
      "hotels.room_types",
      ["workspace_id", "code", "hotel_code", "name", "max_adults", "max_kids", "nightly_cents", "rooms"],
      h.rooms.map((r) => [ws, r.code, r.hotelCode, r.name, r.maxAdults, r.maxKids, r.nightlyCents, r.rooms]),
    );
    await bulk(
      c,
      "hotels.bookings",
      ["workspace_id", "booking_no", "hotel_code", "room_code", "guest_name", "guest_email", "check_in", "nights", "adults", "kids", "pets", "late_checkout", "status", "total_cents", "created_at"],
      h.bookings.map((b) => [ws, b.bookingNo, b.hotelCode, b.roomCode, b.guestName, b.guestEmail, b.checkIn, b.nights, b.adults, b.kids, b.pets, b.lateCheckout, b.status, b.totalCents, b.createdAt]),
    );
  });
}
