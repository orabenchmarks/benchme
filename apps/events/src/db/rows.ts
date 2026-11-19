import type { EventEquipment, EventOffice, EventPerson, EventRegistration, EventRegistrationMode, EventRegistrationStatus, EventRoom, EventStatus, EventWeekday, OfficeEvent } from "@benchme/scenarios";

/**
 * Row shapes as Postgres returns them, and the views the site serves. An event
 * is served with its guests (name where the directory has one), its organiser's
 * name, and its registration counts; a registration with its event's title and
 * time, so a person's list reads on its own.
 */
export type Guest = { email: string; name: string | null };
export type EventView = Omit<OfficeEvent, "guestEmails"> & {
  organiserName: string | null;
  guests: Guest[];
  guestCount: number;
  registeredCount: number;
  /** null for an invitation-only event. */
  placesLeft: number | null;
  updatedAt: string | null;
  cancelledAt: string | null;
};
export type RegistrationView = EventRegistration & { cancelledAt: string | null; eventTitle: string; eventDate: string; startTime: string; endTime: string; officeCode: string };
export type OfficeView = EventOffice & { rooms: EventRoom[] };

export type ORow = { code: string; name: string; city: string; address: string; opens_at: string; closes_at: string; open_days: string[] };
export type RRow = { code: string; office_code: string; name: string; floor: number; capacity: number; equipment: string[]; accessible: boolean };
export type PRow = { email: string; name: string; office_code: string; team: string };
export type ERow = {
  code: string; title: string; description: string; date: string; start_time: string; end_time: string; office_code: string; room_code: string; organiser_email: string;
  registration: EventRegistrationMode; places: number | null; status: EventStatus; created_at: Date; updated_at: Date | null; cancelled_at: Date | null;
  organiser_name: string | null; guests: Guest[]; registered: number;
};
export type GRow = { reg_no: string; event_code: string; name: string; email: string; status: EventRegistrationStatus; created_at: Date; cancelled_at: Date | null; title: string; date: string; start_time: string; end_time: string; office_code: string };

export const toOffice = (r: ORow): EventOffice => ({ code: r.code, name: r.name, city: r.city, address: r.address, opensAt: r.opens_at, closesAt: r.closes_at, openDays: r.open_days as EventWeekday[] });
export const toRoom = (r: RRow): EventRoom => ({ code: r.code, officeCode: r.office_code, name: r.name, floor: r.floor, capacity: r.capacity, equipment: r.equipment as EventEquipment[], accessible: r.accessible });
export const toPerson = (r: PRow): EventPerson => ({ email: r.email, name: r.name, officeCode: r.office_code, team: r.team });

export const toEventView = (r: ERow): EventView => ({
  code: r.code, title: r.title, description: r.description, date: r.date, startTime: r.start_time, endTime: r.end_time, officeCode: r.office_code, roomCode: r.room_code,
  organiserEmail: r.organiser_email, organiserName: r.organiser_name, registration: r.registration, places: r.places, status: r.status,
  guests: r.guests, guestCount: r.guests.length, registeredCount: r.registered, placesLeft: r.places === null ? null : Math.max(0, r.places - r.registered),
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at?.toISOString() ?? null, cancelledAt: r.cancelled_at?.toISOString() ?? null,
});
/** The rules' row shape, guest list included: what eventDraftProblem and eventRegisterProblem read. */
export const toEventRow = (v: EventView): OfficeEvent => ({
  code: v.code, title: v.title, description: v.description, date: v.date, startTime: v.startTime, endTime: v.endTime, officeCode: v.officeCode, roomCode: v.roomCode,
  organiserEmail: v.organiserEmail, guestEmails: v.guests.map((g) => g.email), registration: v.registration, places: v.places, status: v.status, createdAt: v.createdAt,
});
export const toRegistration = (r: GRow): RegistrationView => ({
  regNo: r.reg_no, eventCode: r.event_code, name: r.name, email: r.email, status: r.status, createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null,
  eventTitle: r.title, eventDate: r.date, startTime: r.start_time, endTime: r.end_time, officeCode: r.office_code,
});

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const EVENT_SELECT = `SELECT e.code, e.title, e.description, to_char(e.date, 'YYYY-MM-DD') AS date, e.start_time, e.end_time, e.office_code, e.room_code, e.organiser_email,
  e.registration, e.places, e.status, e.created_at, e.updated_at, e.cancelled_at,
  (SELECT p.name FROM events.people p WHERE p.workspace_id = e.workspace_id AND p.email = e.organiser_email) AS organiser_name,
  COALESCE((SELECT json_agg(json_build_object('email', g.email, 'name', p.name) ORDER BY g.email) FROM events.event_guests g
    LEFT JOIN events.people p ON p.workspace_id = g.workspace_id AND p.email = g.email WHERE g.workspace_id = e.workspace_id AND g.event_code = e.code), '[]'::json) AS guests,
  (SELECT count(*) FROM events.registrations r WHERE r.workspace_id = e.workspace_id AND r.event_code = e.code AND r.status = 'registered')::int AS registered
  FROM events.events e`;
export const REGISTRATION_SELECT = `SELECT r.reg_no, r.event_code, r.name, r.email, r.status, r.created_at, r.cancelled_at, e.title, to_char(e.date, 'YYYY-MM-DD') AS date, e.start_time, e.end_time, e.office_code
  FROM events.registrations r JOIN events.events e ON e.workspace_id = r.workspace_id AND e.code = r.event_code`;

const CONFLICT = new Set(["ROOM_TAKEN", "FULL", "ALREADY_REGISTERED", "ALREADY_CANCELLED"]);
const NOT_FOUND = new Set(["UNKNOWN_OFFICE", "UNKNOWN_ROOM", "UNKNOWN_EVENT", "UNKNOWN_REGISTRATION", "NOT_REGISTERED"]);
/** Problems a person can fix by asking for something else are 422; a room that is taken, an event that is full or a repeat are 409; an unknown key is 404. */
export const statusOf = (code: string): number => (CONFLICT.has(code) ? 409 : NOT_FOUND.has(code) ? 404 : 422);
