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

/** Materialise a scenario's event-site rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedEvents(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const e = rows.events;
  await withTx(pool, async (c) => {
    for (const t of ["registrations", "event_guests", "events", "people", "rooms", "offices", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM events.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "events.offices", ["workspace_id", "code", "name", "city", "address", "opens_at", "closes_at", "open_days"], e.offices.map((o) => [ws, o.code, o.name, o.city, o.address, o.opensAt, o.closesAt, o.openDays]));
    await bulk(c, "events.rooms", ["workspace_id", "code", "office_code", "name", "floor", "capacity", "equipment", "accessible"], e.rooms.map((r) => [ws, r.code, r.officeCode, r.name, r.floor, r.capacity, r.equipment, r.accessible]));
    await bulk(c, "events.people", ["workspace_id", "email", "name", "office_code", "team"], e.people.map((p) => [ws, p.email, p.name, p.officeCode, p.team]));
    await bulk(
      c,
      "events.events",
      ["workspace_id", "code", "title", "description", "date", "start_time", "end_time", "office_code", "room_code", "organiser_email", "registration", "places", "status", "created_at"],
      e.events.map((x) => [ws, x.code, x.title, x.description, x.date, x.startTime, x.endTime, x.officeCode, x.roomCode, x.organiserEmail, x.registration, x.places, x.status, x.createdAt]),
    );
    await bulk(c, "events.event_guests", ["workspace_id", "event_code", "email"], e.events.flatMap((x) => x.guestEmails.map((g) => [ws, x.code, g])));
    await bulk(c, "events.registrations", ["workspace_id", "reg_no", "event_code", "name", "email", "status", "created_at"], e.registrations.map((r) => [ws, r.regNo, r.eventCode, r.name, r.email, r.status, r.createdAt]));
  });
}
