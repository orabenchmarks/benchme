import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

async function bulk(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, table: string, columns: string[], rows: unknown[][], casts: Record<string, string> = {}) {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunk = Math.floor(60_000 / perRow);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map((_, r) => `(${columns.map((col, c) => `$${r * perRow + c + 1}${casts[col] ?? ""}`).join(",")})`).join(",");
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, slice.flat());
  }
}

/** Materialise a scenario's cinema rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedCinema(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const k = rows.cinema;
  await withTx(pool, async (c) => {
    for (const t of ["bookings", "showtimes", "prices", "screens", "films", "cinemas", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM cinema.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "cinema.cinemas", ["workspace_id", "code", "name", "city", "address", "booking_fee_cents", "premium_surcharge_cents"], k.cinemas.map((x) => [ws, x.code, x.name, x.city, x.address, x.bookingFeeCents, x.premiumSurchargeCents]));
    await bulk(c, "cinema.screens", ["workspace_id", "code", "cinema_code", "name", "kind", "seat_rows", "seats_per_row", "premium_rows"], k.screens.map((s) => [ws, s.code, s.cinemaCode, s.name, s.kind, s.rows, s.seatsPerRow, s.premiumRows]));
    await bulk(
      c,
      "cinema.films",
      ["workspace_id", "code", "title", "genre", "rating", "runtime_minutes", "language", "synopsis", "formats"],
      k.films.map((f) => [ws, f.code, f.title, f.genre, f.rating, f.runtimeMinutes, f.language, f.synopsis, f.formats]),
    );
    await bulk(c, "cinema.prices", ["workspace_id", "cinema_code", "format", "ticket_type", "price_cents"], k.prices.map((p) => [ws, p.cinemaCode, p.format, p.ticketType, p.priceCents]));
    await bulk(
      c,
      "cinema.showtimes",
      ["workspace_id", "code", "cinema_code", "screen_code", "film_code", "show_date", "start_time", "format"],
      k.showtimes.map((s) => [ws, s.code, s.cinemaCode, s.screenCode, s.filmCode, s.date, s.time, s.format]),
    );
    await bulk(
      c,
      "cinema.bookings",
      ["workspace_id", "booking_no", "showtime_code", "customer_name", "customer_email", "tickets", "fees_cents", "total_cents", "status", "created_at"],
      k.bookings.map((b) => [ws, b.bookingNo, b.showtimeCode, b.customerName, b.customerEmail, JSON.stringify(b.tickets), b.feesCents, b.totalCents, b.status, b.createdAt]),
      { tickets: "::jsonb" },
    );
  });
}
