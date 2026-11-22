import { about, read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { EventsRepo } from "./events-repo.js";
import type { OfficesRepo } from "./offices-repo.js";
import type { RegistrationsRepo } from "./registrations-repo.js";

/** What the events site's ledger keeps of its offices: the reads of one office, room or person. */
export const OFFICES_LEDGER: LedgerRules<OfficesRepo> = {
  listOffices: unrecorded,
  listRooms: unrecorded,
  freeRooms: unrecorded,
  listPeople: unrecorded,
  getOffice: read("office", ([key]) => key),
  getRoom: read("room", ([code]) => code),
  getPerson: read("person", ([email]) => email),
};

export const EVENTS_LEDGER: LedgerRules<EventsRepo> = {
  listEvents: unrecorded,
  getEvent: read("event", ([code]) => code),
  createEvent: write("event", "create", (_args, event) => event?.code, about("room", ([input]) => input.roomCode)),
  changeEvent: write("event", "change", ([code]) => code),
  cancelEvent: write("event", "cancel", ([code]) => code),
};

/** Cancelling by the event and the person names the registration only once it is found. */
export const REGISTRATIONS_LEDGER: LedgerRules<RegistrationsRepo> = {
  listRegistrations: unrecorded,
  getRegistration: read("registration", ([regNo]) => regNo),
  register: write("registration", "create", (_args, registration) => registration?.regNo, about("event", ([eventCode]) => eventCode)),
  cancelRegistration: write("registration", "cancel", ([regNo]) => regNo),
  cancelRegistrationFor: write("registration", "cancel", (_args, registration) => registration?.regNo, about("event", ([eventCode]) => eventCode)),
};
