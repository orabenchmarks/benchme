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

/** Materialise a scenario's flight rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedFlights(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const f = rows.flights;
  await withTx(pool, async (c) => {
    for (const t of ["bookings", "cabins", "flights", "carriers", "airports", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM flights.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "flights.airports", ["workspace_id", "code", "name", "city", "hub"], f.airports.map((a) => [ws, a.code, a.name, a.city, a.hub]));
    await bulk(c, "flights.carriers", ["workspace_id", "code", "name", "bag_fee_cents", "max_bags"], f.carriers.map((x) => [ws, x.code, x.name, x.bagFeeCents, x.maxBags]));
    await bulk(
      c,
      "flights.flights",
      ["workspace_id", "flight_no", "carrier_code", "origin", "destination", "via", "stops", "departs", "arrives", "arrives_next_day", "duration_minutes"],
      f.flights.map((x) => [ws, x.flightNo, x.carrierCode, x.origin, x.destination, x.via, x.stops, x.departs, x.arrives, x.arrivesNextDay, x.durationMinutes]),
    );
    await bulk(c, "flights.cabins", ["workspace_id", "flight_no", "cabin", "price_cents", "seats"], f.cabins.map((x) => [ws, x.flightNo, x.cabin, x.priceCents, x.seats]));
    await bulk(
      c,
      "flights.bookings",
      ["workspace_id", "booking_no", "flight_no", "flight_date", "cabin", "passengers", "bags", "contact_email", "status", "total_cents", "created_at"],
      f.bookings.map((b) => [ws, b.bookingNo, b.flightNo, b.date, b.cabin, b.passengers.map((p) => p.name), b.bags, b.contactEmail, b.status, b.totalCents, b.createdAt]),
    );
  });
}
