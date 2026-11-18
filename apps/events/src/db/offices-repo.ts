import type { Pool } from "@benchme/core";
import { eventFreeRooms, eventOfficeOf, eventTimeProblem, type EventFreeRoom, type EventOffice, type EventPerson, type EventRoom, type EventRoomQuery } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { allOffices, personByEmail, roomByCode, scheduledIn } from "./load.js";
import { toPerson, toRoom, type OfficeView, type PRow, type RRow } from "./rows.js";

export type RoomFilter = { office?: string; minCapacity?: number; equipment?: string[]; accessible?: boolean };
export type PeopleFilter = { office?: string; team?: string; name?: string };
/** A room search names its office by code (OF-VEL) or by city. */
export type FreeRoomQuery = Omit<EventRoomQuery, "officeCode"> & { office: string };

/** Offices, their rooms and the staff directory: everything that is not an event. */
export interface OfficesRepo {
  listOffices(ws: string): Promise<OfficeView[]>;
  /** By code or city. */
  getOffice(ws: string, key: string): Promise<OfficeView | null>;
  listRooms(ws: string, f: RoomFilter): Promise<EventRoom[]>;
  getRoom(ws: string, code: string): Promise<EventRoom | null>;
  /** eventFreeRooms over the office's rooms and that day's events; a time the office cannot hold anything is a 422 with the reason. */
  freeRooms(ws: string, q: FreeRoomQuery): Promise<EventFreeRoom[]>;
  listPeople(ws: string, f: PeopleFilter): Promise<EventPerson[]>;
  getPerson(ws: string, email: string): Promise<EventPerson | null>;
}

export class PgOfficesRepo implements OfficesRepo {
  constructor(private readonly pool: Pool) {}

  async listOffices(ws: string): Promise<OfficeView[]> {
    const offices = await allOffices(this.pool, ws);
    const rooms = (await this.pool.query<RRow>("SELECT * FROM events.rooms WHERE workspace_id = $1 ORDER BY code", [ws])).rows.map(toRoom);
    return offices.map((o) => ({ ...o, rooms: rooms.filter((r) => r.officeCode === o.code) }));
  }

  async getOffice(ws: string, key: string): Promise<OfficeView | null> {
    return eventOfficeOf(await this.listOffices(ws), key) ?? null;
  }

  async listRooms(ws: string, f: RoomFilter): Promise<EventRoom[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.office) add("office_code = ?", (await this.officeOf(ws, f.office)).code);
    if (f.minCapacity) add("capacity >= ?", f.minCapacity);
    if (f.equipment?.length) add("equipment @> ?::text[]", f.equipment.map((e) => e.trim().toLowerCase()));
    if (f.accessible) where += " AND accessible";
    return (await this.pool.query<RRow>(`SELECT * FROM events.rooms WHERE ${where} ORDER BY office_code, capacity, code`, params)).rows.map(toRoom);
  }

  getRoom(ws: string, code: string): Promise<EventRoom | null> {
    return roomByCode(this.pool, ws, code);
  }

  async freeRooms(ws: string, q: FreeRoomQuery): Promise<EventFreeRoom[]> {
    const office = await this.officeOf(ws, q.office);
    const problem = eventTimeProblem(office, q);
    if (problem) throw new DomainError(problem.code, problem.message, 422);
    const rooms = (await this.pool.query<RRow>("SELECT * FROM events.rooms WHERE workspace_id = $1 AND office_code = $2", [ws, office.code])).rows.map(toRoom);
    const events = await scheduledIn(this.pool, ws, rooms.map((r) => r.code), q.date);
    const { office: _key, ...rest } = q;
    return eventFreeRooms({ offices: [office], rooms, people: [], events, registrations: [] }, { ...rest, officeCode: office.code });
  }

  async listPeople(ws: string, f: PeopleFilter): Promise<EventPerson[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.office) add("office_code = ?", (await this.officeOf(ws, f.office)).code);
    if (f.team) add("lower(team) = ?", f.team.trim().toLowerCase());
    if (f.name) add("lower(name) LIKE ?", `%${f.name.trim().toLowerCase()}%`);
    return (await this.pool.query<PRow>(`SELECT * FROM events.people WHERE ${where} ORDER BY name, email`, params)).rows.map(toPerson);
  }

  getPerson(ws: string, email: string): Promise<EventPerson | null> {
    return personByEmail(this.pool, ws, email);
  }

  private async officeOf(ws: string, key: string): Promise<EventOffice> {
    const office = eventOfficeOf(await allOffices(this.pool, ws), key);
    if (!office) throw new DomainError("UNKNOWN_OFFICE", `no office ${key}: use an office code (OF-…) or a city`, 404);
    return office;
  }
}
