import type { Pool, PoolClient } from "@benchme/core";
import type { EventOffice, EventPerson, EventRegistration, EventRoom, OfficeEvent } from "@benchme/scenarios";
import { EVENT_SELECT, toEventRow, toEventView, toOffice, toPerson, toRoom, type ERow, type EventView, type ORow, type PRow, type RRow } from "./rows.js";

/**
 * The reads a write's rule check needs, run on the write's own transaction
 * client: the rules (@benchme/scenarios' events rules) take the slice of rows
 * they look at, so each write loads exactly that slice and nothing more.
 */
type Db = Pool | PoolClient;

export async function officeByCode(c: Db, ws: string, code: string): Promise<EventOffice | null> {
  const r = await c.query<ORow>("SELECT * FROM events.offices WHERE workspace_id = $1 AND code = $2", [ws, code]);
  return r.rows[0] ? toOffice(r.rows[0]) : null;
}

export async function allOffices(c: Db, ws: string): Promise<EventOffice[]> {
  return (await c.query<ORow>("SELECT * FROM events.offices WHERE workspace_id = $1 ORDER BY code", [ws])).rows.map(toOffice);
}

/** One room, locked for the rest of the transaction when `lock`: bookings of a room are serialised on it. */
export async function roomByCode(c: Db, ws: string, code: string, lock = false): Promise<EventRoom | null> {
  const r = await c.query<RRow>(`SELECT * FROM events.rooms WHERE workspace_id = $1 AND code = $2${lock ? " FOR UPDATE" : ""}`, [ws, code]);
  return r.rows[0] ? toRoom(r.rows[0]) : null;
}

export async function personByEmail(c: Db, ws: string, email: string): Promise<EventPerson | null> {
  const r = await c.query<PRow>("SELECT * FROM events.people WHERE workspace_id = $1 AND email = $2", [ws, email.trim().toLowerCase()]);
  return r.rows[0] ? toPerson(r.rows[0]) : null;
}

export async function eventViewsWhere(c: Db, where: string, params: unknown[], tail = "ORDER BY e.date, e.start_time, e.code"): Promise<EventView[]> {
  return (await c.query<ERow>(`${EVENT_SELECT} WHERE ${where} ${tail}`, params)).rows.map(toEventView);
}

/** The scheduled events holding any of the rooms on one date. */
export async function scheduledIn(c: Db, ws: string, roomCodes: string[], date: string): Promise<OfficeEvent[]> {
  if (roomCodes.length === 0) return [];
  return (await eventViewsWhere(c, "e.workspace_id = $1 AND e.room_code = ANY($2::text[]) AND e.date = $3::date AND e.status = 'scheduled'", [ws, roomCodes, date])).map(toEventRow);
}

type RegRow = { reg_no: string; event_code: string; name: string; email: string; status: EventRegistration["status"]; created_at: Date };
const toReg = (r: RegRow): EventRegistration => ({ regNo: r.reg_no, eventCode: r.event_code, name: r.name, email: r.email, status: r.status, createdAt: r.created_at.toISOString() });

/** Registrations of one event, plus every active registration of one person and the events they are for: what eventRegisterProblem reads. */
export async function registrationSlice(c: Db, ws: string, eventCode: string, email?: string): Promise<{ registrations: EventRegistration[]; events: OfficeEvent[] }> {
  const regs = (
    await c.query<RegRow>(
      "SELECT reg_no, event_code, name, email, status, created_at FROM events.registrations WHERE workspace_id = $1 AND (event_code = $2 OR (email = $3 AND status = 'registered'))",
      [ws, eventCode, email?.trim().toLowerCase() ?? null],
    )
  ).rows.map(toReg);
  const codes = [...new Set([eventCode, ...regs.map((r) => r.eventCode)])];
  const events = (await eventViewsWhere(c, "e.workspace_id = $1 AND e.code = ANY($2::text[])", [ws, codes])).map(toEventRow);
  return { registrations: regs, events };
}
