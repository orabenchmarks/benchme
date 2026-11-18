/**
 * The office events site (apps/events): offices with meeting rooms and
 * opening hours, a staff directory, events booked into rooms, and
 * registrations for the events that are open to them. Natural keys only
 * (`OF-VEL`, `VEL-R2`, `EV-1001`, `RG-3001`, an email for a person), no
 * database ids. Rules: ./rules.ts.
 */
export const EVENT_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type EventWeekday = (typeof EVENT_WEEKDAYS)[number];

export type EventOffice = {
  code: string;
  name: string;
  city: string;
  address: string;
  /** "HH:MM", 24-hour. An event must start at or after opensAt and end at or before closesAt. */
  opensAt: string;
  closesAt: string;
  /** The days the office is open, Monday first. */
  openDays: EventWeekday[];
};

export const EVENT_EQUIPMENT = ["projector", "video conferencing", "whiteboard"] as const;
export type EventEquipment = (typeof EVENT_EQUIPMENT)[number];

export type EventRoom = {
  code: string;
  officeCode: string;
  name: string;
  floor: number;
  /** How many people the room holds, the organiser included. */
  capacity: number;
  equipment: EventEquipment[];
  /** Step-free access. */
  accessible: boolean;
};

/** A member of staff in the directory. Only directory people can organise an event; anyone with a valid email can be invited or register. */
export type EventPerson = { email: string; name: string; officeCode: string; team: string };

export type EventRegistrationMode = "invite-only" | "open";
export type EventStatus = "scheduled" | "cancelled";

export type OfficeEvent = {
  code: string;
  title: string;
  description: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", 24-hour; the event holds its room from startTime up to endTime. */
  startTime: string;
  endTime: string;
  officeCode: string;
  roomCode: string;
  organiserEmail: string;
  /** Invited guests, lowercased, unique, sorted; never the organiser. */
  guestEmails: string[];
  registration: EventRegistrationMode;
  /** Places open to registration; null for an invitation-only event. */
  places: number | null;
  status: EventStatus;
  createdAt: string;
};

export type EventRegistrationStatus = "registered" | "cancelled";
export type EventRegistration = { regNo: string; eventCode: string; name: string; email: string; status: EventRegistrationStatus; createdAt: string };

export type EventRows = {
  offices: EventOffice[];
  rooms: EventRoom[];
  people: EventPerson[];
  events: OfficeEvent[];
  registrations: EventRegistration[];
};
