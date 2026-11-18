import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  eventCancelProblem,
  eventChangeProblem,
  eventDraftProblem,
  eventGuestList,
  eventOfficeOf,
  isDate,
  type EventDraft,
  type EventProblem,
  type EventRegistrationMode,
  type EventRoom,
  type EventRows,
  type EventStatus,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { allOffices, eventViewsWhere, officeByCode, personByEmail, registrationSlice, roomByCode, scheduledIn } from "./load.js";
import { statusOf, toEventRow, type EventView } from "./rows.js";

export type EventFilter = {
  office?: string; room?: string; date?: string; from?: string; to?: string; organiser?: string; guest?: string; registrant?: string;
  q?: string; registration?: EventRegistrationMode; status?: EventStatus; hasPlaces?: boolean; cursor?: string; limit: number;
};
/** A change names the organiser making it; every other field is left as it is unless given. `guestEmails` replaces the list; add/remove edit it. */
export type EventChange = Partial<Omit<EventDraft, "organiserEmail" | "guestEmails">> & { organiserEmail: string; guestEmails?: string[]; addGuestEmails?: string[]; removeGuestEmails?: string[] };

/**
 * Events booked into rooms. Every write holds the room (or the event) row
 * locked while @benchme/scenarios' events rules decide, so two writers can
 * never both take the same room at the same time.
 */
export interface EventsRepo {
  listEvents(ws: string, f: EventFilter): Promise<{ items: EventView[]; nextCursor: string | null }>;
  getEvent(ws: string, code: string): Promise<EventView | null>;
  createEvent(ws: string, input: EventDraft): Promise<EventView>;
  changeEvent(ws: string, code: string, change: EventChange): Promise<EventView>;
  /** scheduled → cancelled, by its organiser; its room is free again. */
  cancelEvent(ws: string, code: string, organiserEmail: string): Promise<EventView>;
}

const refuse = (p: EventProblem | null) => {
  if (p) throw new DomainError(p.code, p.message, statusOf(p.code));
};
const lower = (v: string) => v.trim().toLowerCase();

export class PgEventsRepo implements EventsRepo {
  constructor(private readonly pool: Pool) {}

  async listEvents(ws: string, f: EventFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "e.workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replaceAll("?", `$${params.length}`)}`;
    };
    if (f.office) {
      const office = eventOfficeOf(await allOffices(this.pool, ws), f.office);
      if (!office) throw new DomainError("UNKNOWN_OFFICE", `no office ${f.office}: use an office code (OF-…) or a city`, 404);
      add("e.office_code = ?", office.code);
    }
    if (f.room) add("e.room_code = ?", f.room);
    if (f.date) add("e.date = ?::date", f.date);
    if (f.from) add("e.date >= ?::date", f.from);
    if (f.to) add("e.date <= ?::date", f.to);
    if (f.organiser) add("e.organiser_email = ?", lower(f.organiser));
    if (f.guest) add("EXISTS (SELECT 1 FROM events.event_guests g WHERE g.workspace_id = e.workspace_id AND g.event_code = e.code AND g.email = ?)", lower(f.guest));
    if (f.registrant) add("EXISTS (SELECT 1 FROM events.registrations r WHERE r.workspace_id = e.workspace_id AND r.event_code = e.code AND r.status = 'registered' AND r.email = ?)", lower(f.registrant));
    if (f.q) add("lower(e.title) LIKE ?", `%${lower(f.q)}%`);
    if (f.registration) add("e.registration = ?", f.registration);
    if (f.status) add("e.status = ?", f.status);
    if (f.hasPlaces) where += " AND e.registration = 'open' AND e.status = 'scheduled' AND e.places > (SELECT count(*) FROM events.registrations r WHERE r.workspace_id = e.workspace_id AND r.event_code = e.code AND r.status = 'registered')";
    if (f.cursor) {
      const [date, start, code] = f.cursor.split("|");
      if (!date || !isDate(date) || !start || !code) throw new DomainError("BAD_CURSOR", "a cursor is the nextCursor a list returned", 422);
      params.push(date, start, code);
      where += ` AND (e.date, e.start_time, e.code) > ($${params.length - 2}::date, $${params.length - 1}, $${params.length})`;
    }
    const rows = await eventViewsWhere(this.pool, where, params, "ORDER BY e.date, e.start_time, e.code LIMIT $2");
    const items = rows.slice(0, f.limit);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > f.limit && last ? `${last.date}|${last.startTime}|${last.code}` : null };
  }

  async getEvent(ws: string, code: string): Promise<EventView | null> {
    return (await eventViewsWhere(this.pool, "e.workspace_id = $1 AND e.code = $2", [ws, code]))[0] ?? null;
  }

  async createEvent(ws: string, input: EventDraft): Promise<EventView> {
    const draft = { ...input, organiserEmail: lower(input.organiserEmail), title: input.title.trim(), description: input.description.trim() };
    const code = await withTx(this.pool, async (c) => {
      const room = await this.lockedRoom(c, ws, draft.roomCode);
      refuse(eventDraftProblem(await this.slice(c, ws, room, draft), draft));
      const n = await c.query<{ value: number }>(
        `INSERT INTO events.counters (workspace_id, name, value) VALUES ($1, 'event', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = events.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `EV-${7000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO events.events (workspace_id, code, title, description, date, start_time, end_time, office_code, room_code, organiser_email, registration, places, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'scheduled')`,
        [ws, no, draft.title, draft.description, draft.date, draft.startTime, draft.endTime, room.officeCode, room.code, draft.organiserEmail, draft.registration, draft.places],
      );
      await this.setGuests(c, ws, no, eventGuestList(draft.guestEmails, draft.organiserEmail));
      return no;
    });
    // Read back after the commit: getEvent uses the pool, which cannot see the open transaction.
    return (await this.getEvent(ws, code)) as EventView;
  }

  async changeEvent(ws: string, code: string, ch: EventChange): Promise<EventView> {
    await withTx(this.pool, async (c) => {
      const current = await this.lockedEvent(c, ws, code);
      const event = toEventRow(current);
      const drop = new Set((ch.removeGuestEmails ?? []).map(lower));
      const guests = [...(ch.guestEmails ?? event.guestEmails), ...(ch.addGuestEmails ?? [])].filter((e) => !drop.has(lower(e)));
      const registration = ch.registration ?? event.registration;
      const next: EventDraft = {
        title: (ch.title ?? event.title).trim(), description: (ch.description ?? event.description).trim(), date: ch.date ?? event.date, startTime: ch.startTime ?? event.startTime,
        endTime: ch.endTime ?? event.endTime, roomCode: ch.roomCode ?? event.roomCode, organiserEmail: event.organiserEmail, guestEmails: guests, registration,
        places: ch.places !== undefined ? ch.places : registration === "invite-only" ? null : event.places,
      };
      const room = await this.lockedRoom(c, ws, next.roomCode);
      const rows = await this.slice(c, ws, room, next);
      refuse(eventChangeProblem({ ...rows, registrations: (await registrationSlice(c, ws, code)).registrations }, event, ch.organiserEmail, next));
      await c.query(
        `UPDATE events.events SET title = $3, description = $4, date = $5, start_time = $6, end_time = $7, office_code = $8, room_code = $9, registration = $10, places = $11, updated_at = now()
         WHERE workspace_id = $1 AND code = $2`,
        [ws, code, next.title, next.description, next.date, next.startTime, next.endTime, room.officeCode, room.code, next.registration, next.places],
      );
      await c.query("DELETE FROM events.event_guests WHERE workspace_id = $1 AND event_code = $2", [ws, code]);
      await this.setGuests(c, ws, code, eventGuestList(next.guestEmails, next.organiserEmail));
    });
    return (await this.getEvent(ws, code)) as EventView;
  }

  async cancelEvent(ws: string, code: string, organiserEmail: string): Promise<EventView> {
    await withTx(this.pool, async (c) => {
      refuse(eventCancelProblem(toEventRow(await this.lockedEvent(c, ws, code)), organiserEmail));
      await c.query("UPDATE events.events SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND code = $2", [ws, code]);
    });
    return (await this.getEvent(ws, code)) as EventView;
  }

  private async lockedRoom(c: PoolClient, ws: string, code: string): Promise<EventRoom> {
    const room = await roomByCode(c, ws, code, true);
    if (!room) throw new DomainError("UNKNOWN_ROOM", `no room ${code}`, 404);
    return room;
  }

  private async lockedEvent(c: PoolClient, ws: string, code: string): Promise<EventView> {
    await c.query("SELECT 1 FROM events.events WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, code]);
    const view = (await eventViewsWhere(c, "e.workspace_id = $1 AND e.code = $2", [ws, code]))[0];
    if (!view) throw new DomainError("UNKNOWN_EVENT", `no event ${code}`, 404);
    return view;
  }

  /** What eventDraftProblem reads for one room: its office, the organiser's directory entry, and that day's events in the room. */
  private async slice(c: PoolClient, ws: string, room: EventRoom, draft: EventDraft): Promise<EventRows> {
    const office = await officeByCode(c, ws, room.officeCode);
    const organiser = await personByEmail(c, ws, draft.organiserEmail);
    const events = isDate(draft.date) ? await scheduledIn(c, ws, [room.code], draft.date) : [];
    return { offices: office ? [office] : [], rooms: [room], people: organiser ? [organiser] : [], events, registrations: [] };
  }

  private async setGuests(c: PoolClient, ws: string, code: string, emails: string[]): Promise<void> {
    if (emails.length) await c.query("INSERT INTO events.event_guests (workspace_id, event_code, email) SELECT $1, $2, unnest($3::text[])", [ws, code, emails]);
  }
}
